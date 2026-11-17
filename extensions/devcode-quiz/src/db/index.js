/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Banco de Dados (estilo DBeaver): conexões, árvore do banco, editor SQL e resultados.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const path = require('path');
const { connect, splitStatements, TYPES } = require('./drivers');
const { ResultsPanel } = require('./results');

const STORE_KEY = 'devcode.db.connections';
const ICON = { firebird: 'flame', mysql: 'database', postgres: 'database' };

class DbManager {
	constructor(context) {
		this.context = context;
		this.open = new Map(); // id -> conexão aberta
		this.activeId = context.workspaceState.get('devcode.db.active');
		this._onChange = new vscode.EventEmitter();
		this.onChange = this._onChange.event;
	}
	list() { return this.context.globalState.get(STORE_KEY, []); }
	async save(list) { await this.context.globalState.update(STORE_KEY, list); this._onChange.fire(); }
	get(id) { return this.list().find(c => c.id === id); }
	async password(id) { return (await this.context.secrets.get(`devcode.db.pw.${id}`)) ?? ''; }

	async add() {
		const type = await vscode.window.showQuickPick([
			{ label: '$(flame) Firebird', description: 'escolha o arquivo .fdb', id: 'firebird' },
			{ label: '$(database) MySQL', description: 'servidor, usuário e senha', id: 'mysql' },
			{ label: '$(database) PostgreSQL', description: 'servidor, usuário e senha', id: 'postgres' },
		], { title: 'Nova conexão: qual banco?', ignoreFocusOut: true });
		if (!type) { return; }
		const ask = (title, value, opts = {}) => vscode.window.showInputBox({ title, value, ignoreFocusOut: true, ...opts });
		const cfg = { id: Math.random().toString(36).slice(2, 10), type: type.id };
		let password;
		if (type.id === 'firebird') {
			const pick = await vscode.window.showQuickPick([
				{ label: '$(folder-opened) Abrir um arquivo .fdb existente', id: 'open' },
				{ label: '$(new-file) Criar um banco novo (.fdb)', id: 'create' },
			], { title: 'Firebird', ignoreFocusOut: true });
			if (!pick) { return; }
			const base = vscode.workspace.workspaceFolders?.[0]?.uri;
			let file;
			if (pick.id === 'open') {
				file = (await vscode.window.showOpenDialog({ title: 'Escolha o banco Firebird', defaultUri: base, canSelectMany: false, filters: { 'Banco Firebird': ['fdb', 'gdb'] } }))?.[0];
			} else {
				file = await vscode.window.showSaveDialog({ title: 'Onde criar o banco Firebird?', defaultUri: base ? vscode.Uri.joinPath(base, 'banco.fdb') : undefined, filters: { 'Banco Firebird': ['fdb'] } });
			}
			if (!file) { return; }
			cfg.database = file.fsPath;
			cfg.user = await ask('Usuário do Firebird', 'SYSDBA'); if (cfg.user === undefined) { return; }
			password = await ask('Senha do Firebird', 'masterkey', { password: true }); if (password === undefined) { return; }
			cfg.host = '127.0.0.1'; cfg.port = 3050;
			if (pick.id === 'create') {
				try { await createFirebird(cfg, password); } catch (err) { return vscode.window.showErrorMessage(`Não foi possível criar o banco: ${err.message}`); }
			}
			cfg.name = path.basename(cfg.database);
		} else {
			const defaults = type.id === 'mysql' ? { port: '3306', user: 'root' } : { port: '5432', user: 'postgres' };
			cfg.host = await ask('Servidor (host)', '127.0.0.1'); if (cfg.host === undefined) { return; }
			const port = await ask('Porta', defaults.port, { validateInput: v => /^\d+$/.test(v) ? undefined : 'Digite um número' }); if (port === undefined) { return; }
			cfg.port = +port;
			cfg.user = await ask('Usuário', defaults.user); if (cfg.user === undefined) { return; }
			password = await ask('Senha', '', { password: true, placeHolder: type.id === 'mysql' ? '(vazio = sem senha)' : '' }); if (password === undefined) { return; }
			cfg.database = await ask('Banco de dados (database)', type.id === 'postgres' ? 'postgres' : '', { placeHolder: type.id === 'mysql' ? 'deixe vazio para escolher depois' : '' });
			if (cfg.database === undefined) { return; }
			if (type.id === 'mysql' && !cfg.database) {
				try {
					const tmp = await connect({ ...cfg, password });
					const dbs = (await tmp.databases()).filter(d => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(d));
					await tmp.close();
					const chosen = await vscode.window.showQuickPick([...dbs.map(d => ({ label: d })), { label: '$(add) Criar um banco novo…', create: true }], { title: 'Escolha o banco', ignoreFocusOut: true });
					if (!chosen) { return; }
					if (chosen.create) {
						const name = await ask('Nome do banco novo', 'escola', { validateInput: v => /^\w+$/.test(v) ? undefined : 'Use letras, números e _' });
						if (!name) { return; }
						const c2 = await connect({ ...cfg, password }); await c2.query(`CREATE DATABASE \`${name}\``); await c2.close();
						cfg.database = name;
					} else { cfg.database = chosen.label; }
				} catch (err) { return vscode.window.showErrorMessage(`Não foi possível conectar: ${err.message}`); }
			}
			cfg.name = `${cfg.database || TYPES[cfg.type]} @ ${cfg.host}`;
		}
		// testa antes de salvar
		try {
			const c = await connect({ ...cfg, password }); await c.close();
		} catch (err) {
			const again = await vscode.window.showErrorMessage(`Não foi possível conectar: ${err.message}`, 'Salvar mesmo assim');
			if (!again) { return; }
		}
		await this.context.secrets.store(`devcode.db.pw.${cfg.id}`, password);
		await this.save([...this.list(), cfg]);
		await this.setActive(cfg.id);
		vscode.window.setStatusBarMessage(`$(check) Conexão "${cfg.name}" adicionada.`, 4000);
	}

	async remove(id) {
		const c = this.get(id); if (!c) { return; }
		const ok = await vscode.window.showWarningMessage(`Remover a conexão "${c.name}"? (o banco não é apagado)`, { modal: true }, 'Remover');
		if (ok !== 'Remover') { return; }
		await this.disconnect(id);
		await this.context.secrets.delete(`devcode.db.pw.${id}`);
		await this.save(this.list().filter(x => x.id !== id));
	}

	async conn(id) {
		if (this.open.has(id)) { return this.open.get(id); }
		const cfg = this.get(id);
		if (!cfg) { throw new Error('Conexão não encontrada.'); }
		const c = await connect({ ...cfg, password: await this.password(id) });
		this.open.set(id, c);
		this._onChange.fire();
		return c;
	}
	async disconnect(id) { const c = this.open.get(id); this.open.delete(id); if (c) { await c.close(); } this._onChange.fire(); }
	async setActive(id) { this.activeId = id; await this.context.workspaceState.update('devcode.db.active', id); this._onChange.fire(); }
	dispose() { for (const c of this.open.values()) { c.close(); } }
}

async function createFirebird(cfg, password) {
	const Firebird = require('node-firebird');
	await new Promise((resolve, reject) => Firebird.create({ host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, password, pageSize: 8192 }, (err, db) => err ? reject(err) : db.detach(resolve)));
}

// ================================================================== árvore
class Node extends vscode.TreeItem {
	constructor(label, collapsible, extra) { super(label, collapsible); Object.assign(this, extra); }
}

class DbTree {
	constructor(mgr) {
		this.mgr = mgr;
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
		mgr.onChange(() => this._onDidChangeTreeData.fire());
	}
	refresh() { this._onDidChangeTreeData.fire(); }
	getTreeItem(n) { return n; }
	async getChildren(n) {
		const C = vscode.TreeItemCollapsibleState;
		try {
			if (!n) {
				return this.mgr.list().map(c => {
					const isOpen = this.mgr.open.has(c.id);
					const active = this.mgr.activeId === c.id;
					return new Node(c.name, C.Collapsed, {
						kind: 'conn', connId: c.id, contextValue: isOpen ? 'conn-open' : 'conn',
						description: `${TYPES[c.type]}${active ? ' · ativa' : ''}`, tooltip: `${TYPES[c.type]}\n${c.database || ''}\n${c.host || ''}`,
						iconPath: new vscode.ThemeIcon(ICON[c.type], active ? new vscode.ThemeColor('charts.red') : undefined),
					});
				});
			}
			const db = await this.mgr.conn(n.connId);
			if (n.kind === 'conn') {
				const groups = [['tables', 'Tabelas', 'table'], ['views', 'Views', 'eye'], ['triggers', 'Triggers', 'zap'], ['procedures', 'Procedures / Funções', 'symbol-method'], ['sequences', db.type === 'firebird' ? 'Generators' : 'Sequences', 'symbol-number']];
				if (db.type === 'mysql') { groups.pop(); }
				return groups.map(([g, label, icon]) => new Node(label, C.Collapsed, { kind: 'group', group: g, connId: n.connId, iconPath: new vscode.ThemeIcon(icon) }));
			}
			if (n.kind === 'group') {
				const names = await db[n.group]();
				if (n.group === 'triggers') {
					return names.map(t => new Node(t.name, C.None, { kind: 'trigger', connId: n.connId, data: t, description: `${t.timing} · ${t.table}${t.active ? '' : ' (inativa)'}`, iconPath: new vscode.ThemeIcon('zap'), command: { command: 'devcode.db.showSource', title: 'Ver código', arguments: [{ kind: 'trigger', data: t }] } }));
				}
				const icon = { tables: 'table', views: 'eye', procedures: 'symbol-method', sequences: 'symbol-number' }[n.group];
				return names.map(name => new Node(name, n.group === 'tables' || n.group === 'views' ? C.Collapsed : C.None, {
					kind: n.group.slice(0, -1), name, connId: n.connId, contextValue: n.group === 'tables' ? 'table' : n.group, iconPath: new vscode.ThemeIcon(icon),
					command: n.group === 'procedures' || n.group === 'views' ? { command: 'devcode.db.showSource', title: 'Ver código', arguments: [{ kind: n.group.slice(0, -1), name, connId: n.connId }] } : undefined,
				}));
			}
			if (n.kind === 'table' || n.kind === 'view') {
				const out = [new Node('Colunas', C.Expanded, { kind: 'columns', name: n.name, connId: n.connId, iconPath: new vscode.ThemeIcon('symbol-field') })];
				if (n.kind === 'table') {
					out.push(new Node('Chaves estrangeiras', C.Collapsed, { kind: 'fks', name: n.name, connId: n.connId, iconPath: new vscode.ThemeIcon('link') }));
					out.push(new Node('Índices', C.Collapsed, { kind: 'idx', name: n.name, connId: n.connId, iconPath: new vscode.ThemeIcon('list-ordered') }));
					out.push(new Node('Triggers', C.Collapsed, { kind: 'ttrg', name: n.name, connId: n.connId, iconPath: new vscode.ThemeIcon('zap') }));
				}
				return out;
			}
			if (n.kind === 'columns') {
				const [cols, pk, fks] = await Promise.all([db.columns(n.name), db.primaryKey(n.name).catch(() => []), db.foreignKeys(n.name).catch(() => [])]);
				const fkCols = new Map(); fks.forEach(f => f.columns.forEach((c, i) => fkCols.set(c, `${f.refTable}.${f.refColumns[i]}`)));
				return cols.map(c => new Node(c.name, C.None, {
					kind: 'column', description: `${c.type}${c.nullable ? '' : ' · NOT NULL'}${pk.includes(c.name) ? ' · PK' : ''}${fkCols.has(c.name) ? ` · FK → ${fkCols.get(c.name)}` : ''}`,
					tooltip: `${c.name} ${c.type}${c.default ? `\nDEFAULT ${c.default}` : ''}`,
					iconPath: new vscode.ThemeIcon(pk.includes(c.name) ? 'key' : fkCols.has(c.name) ? 'link' : 'symbol-field', pk.includes(c.name) ? new vscode.ThemeColor('charts.yellow') : undefined),
				}));
			}
			if (n.kind === 'fks') {
				return (await db.foreignKeys(n.name)).map(f => new Node(f.name, C.None, { kind: 'fk', description: `(${f.columns.join(', ')}) → ${f.refTable} (${f.refColumns.join(', ')})`, tooltip: `ON UPDATE ${f.onUpdate}\nON DELETE ${f.onDelete}`, iconPath: new vscode.ThemeIcon('link') }));
			}
			if (n.kind === 'idx') {
				return (await db.indexes(n.name)).map(i => new Node(i.name, C.None, { kind: 'index', description: `${i.unique ? 'ÚNICO · ' : ''}${i.columns.join(', ')}`, iconPath: new vscode.ThemeIcon('list-ordered') }));
			}
			if (n.kind === 'ttrg') {
				return (await db.tableTriggers(n.name)).map(t => new Node(t.name, C.None, { kind: 'trigger', description: t.timing, iconPath: new vscode.ThemeIcon('zap'), command: { command: 'devcode.db.showSource', title: 'Ver código', arguments: [{ kind: 'trigger', data: t }] } }));
			}
		} catch (err) {
			return [new Node(`Erro: ${err.message}`, C.None, { iconPath: new vscode.ThemeIcon('error') })];
		}
		return [];
	}
}

// ================================================================== executar SQL
function dialectOf(mgr) { return mgr.get(mgr.activeId)?.type || 'firebird'; }

async function ensureActive(mgr) {
	if (mgr.activeId && mgr.get(mgr.activeId)) { return mgr.activeId; }
	const list = mgr.list();
	if (!list.length) {
		const ok = await vscode.window.showInformationMessage('Nenhuma conexão de banco. Criar uma agora?', 'Nova conexão');
		if (ok) { await mgr.add(); }
		return mgr.activeId;
	}
	const pick = await vscode.window.showQuickPick(list.map(c => ({ label: c.name, description: TYPES[c.type], id: c.id })), { title: 'Executar em qual banco?' });
	if (pick) { await mgr.setActive(pick.id); }
	return mgr.activeId;
}

async function runSql(mgr, panel, mode) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) { return; }
	const id = await ensureActive(mgr); if (!id) { return; }
	const doc = editor.document;
	const text = doc.getText();
	const all = splitStatements(text, dialectOf(mgr));
	let list;
	if (mode === 'all') { list = all; }
	else if (!editor.selection.isEmpty) { list = splitStatements(doc.getText(editor.selection), dialectOf(mgr)); }
	else {
		const off = doc.offsetAt(editor.selection.active);
		const cur = all.find(s => off >= s.start && off <= s.end + 1) || all.filter(s => s.start <= off).pop();
		list = cur ? [cur] : [];
		if (cur?.start !== undefined) {
			const range = new vscode.Range(doc.positionAt(cur.start), doc.positionAt(cur.end));
			editor.setDecorations(flash, [range]); setTimeout(() => editor.setDecorations(flash, []), 600);
		}
	}
	if (!list.length) { vscode.window.showInformationMessage('Nenhuma instrução SQL para executar.'); return; }
	const db = await mgr.conn(id).catch(err => { vscode.window.showErrorMessage(`Não foi possível conectar: ${err.message}`); });
	if (!db) { return; }
	const results = [];
	for (const s of list) {
		const t0 = Date.now();
		try {
			const r = await db.query(s.sql);
			results.push({ sql: s.sql, ...r, ms: Date.now() - t0 });
		} catch (err) {
			results.push({ sql: s.sql, error: err.message, ms: Date.now() - t0 });
			if (mode === 'all') { break; }
		}
	}
	panel.show(mgr.get(id).name, results);
	if (results.some(r => !r.error && /^\s*(CREATE|ALTER|DROP|RECREATE)\b/i.test(r.sql))) { tree?.refresh(); }
}
const flash = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground') });
let tree;

// ================================================================== registro
function registerDatabase(context) {
	const mgr = new DbManager(context);
	const panel = new ResultsPanel(context);
	tree = new DbTree(mgr);
	const view = vscode.window.createTreeView('devcode.db.explorer', { treeDataProvider: tree, showCollapseAll: true });

	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
	const updateStatus = () => {
		const ed = vscode.window.activeTextEditor;
		const c = mgr.get(mgr.activeId);
		if (ed?.document.languageId === 'sql') { status.text = `$(database) ${c ? c.name : 'Escolher banco'}`; status.tooltip = 'Banco onde o SQL é executado (clique para trocar)'; status.command = 'devcode.db.pickActive'; status.show(); }
		else { status.hide(); }
	};
	mgr.onChange(updateStatus); vscode.window.onDidChangeActiveTextEditor(updateStatus); updateStatus();

	const newSqlEditor = async (connId, content) => {
		if (connId) { await mgr.setActive(connId); }
		const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: content ?? `-- ${mgr.get(mgr.activeId)?.name || ''}\n-- Ctrl+Enter: executa a instrução onde está o cursor · Alt+X: executa tudo\n\n` });
		const ed = await vscode.window.showTextDocument(doc);
		ed.selection = new vscode.Selection(doc.lineCount, 0, doc.lineCount, 0);
	};

	context.subscriptions.push(view, status, mgr, flash,
		vscode.commands.registerCommand('devcode.db.add', () => mgr.add()),
		vscode.commands.registerCommand('devcode.db.refresh', () => tree.refresh()),
		vscode.commands.registerCommand('devcode.db.remove', n => mgr.remove(n.connId)),
		vscode.commands.registerCommand('devcode.db.disconnect', n => mgr.disconnect(n.connId)),
		vscode.commands.registerCommand('devcode.db.setActive', n => mgr.setActive(n.connId)),
		vscode.commands.registerCommand('devcode.db.pickActive', async () => {
			const pick = await vscode.window.showQuickPick([...mgr.list().map(c => ({ label: c.name, description: TYPES[c.type], id: c.id })), { label: '$(add) Nova conexão…', add: true }], { title: 'Executar o SQL em qual banco?' });
			if (pick?.add) { await mgr.add(); } else if (pick) { await mgr.setActive(pick.id); }
		}),
		vscode.commands.registerCommand('devcode.db.newSql', n => newSqlEditor(n?.connId)),
		vscode.commands.registerCommand('devcode.db.runStatement', () => runSql(mgr, panel, 'statement')),
		vscode.commands.registerCommand('devcode.db.runAll', () => runSql(mgr, panel, 'all')),
		vscode.commands.registerCommand('devcode.db.openTable', async n => {
			const db = await mgr.conn(n.connId);
			const t0 = Date.now();
			try {
				const [r, count] = await Promise.all([db.query(db.limitSql(n.name, 500)), db.query(db.countSql(n.name)).catch(() => null)]);
				panel.show(mgr.get(n.connId).name, [{ sql: db.limitSql(n.name, 500), ...r, ms: Date.now() - t0, info: count ? `${count.rows[0][0]} registro(s) na tabela${+count.rows[0][0] > 500 ? ' · mostrando os 500 primeiros' : ''}` : '' }]);
			} catch (err) { vscode.window.showErrorMessage(err.message); }
		}),
		vscode.commands.registerCommand('devcode.db.tableInfo', async n => {
			const db = await mgr.conn(n.connId);
			const [cols, pk, fks, idx, trg, ddl] = await Promise.all([db.columns(n.name), db.primaryKey(n.name), db.foreignKeys(n.name), db.indexes(n.name), db.tableTriggers(n.name), db.ddl(n.name)]);
			panel.showDictionary(mgr.get(n.connId).name, n.name, { cols, pk, fks, idx, trg, ddl });
		}),
		vscode.commands.registerCommand('devcode.db.showSource', async item => {
			let src = '';
			if (item.kind === 'trigger') { src = item.data.source; }
			else {
				const db = await mgr.conn(item.connId);
				src = item.kind === 'procedure' ? await db.procedureSource(item.name) : item.kind === 'view' ? await db.viewSource(item.name) : await db.ddl(item.name);
			}
			await newSqlEditor(undefined, `${src}\n`);
		}),
		vscode.commands.registerCommand('devcode.db.selectTable', async n => {
			const db = await mgr.conn(n.connId);
			await newSqlEditor(n.connId, `${db.limitSql(n.name, 100)};\n`);
		}),
	);
}

module.exports = { registerDatabase };
