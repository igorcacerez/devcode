/*---------------------------------------------------------------------------------------------
 *  DEV CODE - painel GitHub (estilo GitHub Desktop) na barra lateral.
 *    - Conta: entrar / sair.
 *    - Projeto aberto: alterações, mensagem + Commit, Enviar (push), Atualizar (pull), histórico.
 *    - Repositórios: lista da conta, Baixar (clone), Criar novo (do projeto aberto).
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const path = require('path');
const gh = require('./githubAuth');
const git = require('./git');
const authorship = require('./authorship');

const STATUS = { M: 'modificado', A: 'novo', D: 'apagado', R: 'renomeado', '?': 'novo', U: 'conflito' };

class GithubPanel {
	constructor(context, trustFolder, rescan) {
		this.context = context;
		this.trustFolder = trustFolder;
		this.rescan = rescan;
		this.repos = undefined;
	}

	resolveWebviewView(view) {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.html();
		view.webview.onDidReceiveMessage(m => this.onMessage(m).catch(err => vscode.window.showErrorMessage(`DEV CODE: ${err.message || err}`)));
		view.onDidChangeVisibility(() => view.visible && this.refresh());
		this.refresh();
	}

	async state() {
		const repo = git.currentRepo();
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const s = { account: gh.account(), folder: folder && path.basename(folder), hasRepo: !!repo, repos: this.repos };
		if (repo) {
			const [branch, status, log, remote, ahead] = await Promise.all([
				git.run(repo, ['rev-parse', '--abbrev-ref', 'HEAD']),
				git.run(repo, ['status', '--porcelain', '-uall'], 300000, true),
				git.run(repo, ['log', '-20', '--date=format:%d/%m/%Y %H:%M', '--pretty=format:%h\x1f%s\x1f%an\x1f%ad']),
				git.run(repo, ['remote', 'get-url', 'origin']),
				git.run(repo, ['rev-list', '--count', '@{u}..HEAD']),
			]);
			s.identity = await git.getIdentity(repo);
			s.branch = branch.out || 'main';
			s.remote = remote.ok ? remote.out.replace(/\.git$/, '') : '';
			s.ahead = ahead.ok ? Number(ahead.out) : (log.out ? -1 : 0);
			s.changes = status.out.split(/\r?\n/).filter(Boolean).map(l => {
				const code = l.slice(0, 2).trim()[0] || '?';
				return { file: l.slice(3).replace(/^"|"$/g, '').replace(/^.* -> /, ''), status: STATUS[code] || code };
			});
			s.changes = s.changes.filter(c => !/^\.devcode\//.test(c.file));
			s.log = log.out ? log.out.split('\n').map(l => { const [hash, msg, author, when] = l.split('\x1f'); return { hash, msg, author, when }; }) : [];
		}
		if (!repo) { s.identity = await git.getIdentity(undefined); }
		s.busy = this.busy || '';
		return s;
	}

	async refresh() {
		if (!this.view?.visible) { return; }
		this.view.webview.postMessage({ type: 'state', state: await this.state() });
	}

	async onMessage(m) {
		const heavy = { commit: m.push ? 'Fazendo commit e enviando…' : 'Fazendo commit…', push: 'Enviando…', pull: 'Atualizando…' }[m.type];
		if (!heavy) { return this.handle(m); }
		if (this.busy || git.isBusy()) { return; }
		this.busy = heavy;
		await this.refresh();
		try { await git.exclusive(() => this.handle(m)); } finally { this.busy = ''; git.updateStatusBar(); await this.refresh(); }
	}

	async handle(m) {
		const repo = git.currentRepo();
		switch (m.type) {
			case 'identity': {
				const name = String(m.name || '').trim(), email = String(m.email || '').trim();
				if (!name || !/.+@.+\..+/.test(email)) { vscode.window.showWarningMessage('DEV CODE: preencha seu nome e um e-mail válido.'); return; }
				await git.setIdentity(repo, name, email);
				vscode.window.setStatusBarMessage(`$(check) DEV CODE: commits agora saem como ${name}`, 4000);
				break;
			}
			case 'refresh': break;
			case 'login': await gh.login(); this.repos = undefined; break;
			case 'logout': await gh.logout(); this.repos = undefined; break;
			case 'loadRepos': this.repos = (await gh.listRepos()).map(r => ({ name: r.full_name, private: r.private, desc: r.description || '', url: r.clone_url, html: r.html_url, updated: r.updated_at })); break;
			case 'clone': await git.cloneProject(this.trustFolder, m.url); return;
			case 'cloneOther': await git.cloneProject(this.trustFolder); return;
			case 'openRepo': vscode.env.openExternal(vscode.Uri.parse(m.url)); return;
			case 'create': await git.connectRemote(); break;
			case 'openFile': if (repo) { vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(repo, m.file))); } return;
			case 'diff': if (repo) { vscode.commands.executeCommand('git.openChange', vscode.Uri.file(path.join(repo, m.file))).then(undefined, () => vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(repo, m.file)))); } return;
			case 'commit': {
				if (!repo || !(await git.gitAvailable()) || !(await git.ensureIdentity(repo))) { return; }
				await vscode.workspace.saveAll(false);
				await git.untrackDevcode(repo);
				const files = (m.files || []).filter(f => !/^\.devcode\//.test(f));
				if (!files.length) { vscode.window.showWarningMessage('DEV CODE: marque pelo menos um arquivo para o commit.'); return; }
				const add = await git.run(repo, ['add', '-A', '--', ...files]);
				const c = add.ok ? await git.run(repo, ['commit', '-m', m.message.trim(), '--', ...files, ...(await this.devcodeStaged(repo))]) : add;
				if (!c.ok) { vscode.window.showErrorMessage(`DEV CODE: falha no commit.\n${c.err || c.out}`, { modal: true }); break; }
				if (!(await authorship.signHeadCommit(repo))) {
					vscode.window.showErrorMessage('DEV CODE: o commit foi criado, mas não foi possível assinar suas alterações. O envio foi cancelado.', { modal: true });
					break;
				}
				vscode.window.setStatusBarMessage('$(check) DEV CODE: commit feito!', 3000);
				if (m.push) { await git.push(repo, 'Enviando para o GitHub…'); }
				break;
			}
			case 'push': if (repo) { await git.push(repo, 'Enviando para o GitHub…'); } break;
			case 'pull': await git.pull(this.rescan); break;
		}
		git.updateStatusBar();
		await this.refresh();
	}

	/** Inclui a remoção do .devcode/ no commit, se estiver no índice. */
	async devcodeStaged(repo) {
		const r = await git.run(repo, ['diff', '--cached', '--name-only', '--', '.devcode']);
		return r.ok && r.out ? ['.devcode'] : [];
	}

	html() {
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root{--r:6px;--gap:8px;--h:28px}
*{box-sizing:border-box}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:4px 12px 20px;margin:0}
.sec-h{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-descriptionForeground);margin:18px 0 8px;display:flex;justify-content:space-between;align-items:center;gap:6px}
.sec-h .count{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:9px;padding:0 6px;font-size:10px;letter-spacing:0}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:var(--h);background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:1px solid transparent;padding:0 10px;border-radius:var(--r);cursor:pointer;font:inherit;white-space:nowrap}
button:hover{background:var(--vscode-button-hoverBackground)}
button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button.sec:hover{background:var(--vscode-button-secondaryHoverBackground)}
button.link{background:none;color:var(--vscode-textLink-foreground);padding:0 2px;height:auto;border:0}
button.link:hover{text-decoration:underline;background:none}
button.icon{background:none;color:var(--vscode-foreground);height:22px;width:22px;padding:0;opacity:.8}
button.icon:hover{background:var(--vscode-toolbar-hoverBackground);opacity:1}
button:disabled{opacity:.5;cursor:default;pointer-events:none}
.row{display:flex;gap:var(--gap);margin-top:var(--gap)}.row>button{flex:1;min-width:0}
.card{border:1px solid var(--vscode-panel-border,rgba(128,128,128,.3));border-radius:var(--r);padding:10px 12px;background:var(--vscode-sideBar-background)}
.card+.card{margin-top:6px}
.title{display:flex;align-items:center;gap:8px;min-width:0}.title b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.muted{color:var(--vscode-descriptionForeground);font-size:12px}
.sub{margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-size:10px;line-height:16px;padding:0 6px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);flex:none}
.tag.st-novo{background:#2E7D32;color:#fff}.tag.st-apagado{background:#C62828;color:#fff}.tag.st-conflito{background:#E65100;color:#fff}
.list{border:1px solid var(--vscode-panel-border,rgba(128,128,128,.3));border-radius:var(--r);overflow:hidden;max-height:240px;overflow-y:auto}
.item{display:flex;align-items:center;gap:8px;padding:5px 10px;min-height:28px}
.list .item+.item{border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.15))}
.item:hover{background:var(--vscode-list-hoverBackground)}
.item.head{background:var(--vscode-sideBar-background);font-weight:600}
.item .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.item .dir{color:var(--vscode-descriptionForeground);font-size:11px;margin-left:4px}
input[type=checkbox]{margin:0;width:14px;height:14px;flex:none;accent-color:var(--vscode-button-background)}
textarea,input[type=text],input[type=email]{width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,rgba(128,128,128,.35));padding:6px 8px;font:inherit;border-radius:var(--r);outline:none}
textarea:focus,input:focus{border-color:var(--vscode-focusBorder)}
input[type=text],input[type=email]{height:var(--h)}
textarea{min-height:56px;resize:vertical;margin-top:var(--gap);display:block}
label.fld{display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin:8px 0 3px}
.who{display:flex;align-items:center;gap:8px}.who .av{width:26px;height:26px;border-radius:50%;background:var(--vscode-button-background);color:var(--vscode-button-foreground);display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.who .txt{flex:1;min-width:0}.who .txt div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.warn{color:var(--vscode-editorWarning-foreground)}
.busy{display:flex;align-items:center;gap:8px;padding:8px 10px;margin-top:8px;border-radius:var(--r);background:var(--vscode-inputValidation-infoBackground,rgba(0,120,212,.15));font-size:12px}
.spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
.log{position:relative;padding-left:14px}
.log .c{position:relative;padding:4px 0 8px}
.log .c::before{content:'';position:absolute;left:-11px;top:9px;width:7px;height:7px;border-radius:50%;background:var(--vscode-button-background)}
.log::before{content:'';position:absolute;left:4px;top:8px;bottom:8px;width:1px;background:var(--vscode-panel-border,rgba(128,128,128,.4))}
.log .msg{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{color:var(--vscode-descriptionForeground);padding:8px 2px;font-size:12px}
</style></head><body><div id="app">Carregando…</div><script>
const vscode = acquireVsCodeApi();
let S = {}; let filter = ''; let unchecked = new Set(); let draft = ''; let editWho = false;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const send = (type, extra) => vscode.postMessage({ type, ...extra });
window.addEventListener('message', e => { if (e.data.type === 'state') { S = e.data.state; render(); } });
const dis = () => S.busy ? ' disabled' : '';
function whoCard() {
	const id = S.identity || {};
	const missing = !id.name || !id.email;
	if (editWho || missing) {
		return '<div class="card">' + (missing ? '<div class="muted warn">Informe seu nome e e-mail antes do primeiro commit.</div>' : '<div class="muted">Use o seu nome e o e-mail da sua conta do GitHub.</div>') +
			'<label class="fld" for="gname">Nome</label><input type="text" id="gname" value="' + esc(id.name) + '" placeholder="Seu nome completo">' +
			'<label class="fld" for="gemail">E-mail</label><input type="email" id="gemail" value="' + esc(id.email) + '" placeholder="voce@exemplo.com">' +
			'<div class="row"><button data-a="saveWho">Salvar</button>' + (missing ? '' : '<button class="sec" data-a="cancelWho">Cancelar</button>') + '</div></div>';
	}
	return '<div class="card who"><div class="av">' + esc((id.name || '?').trim()[0].toUpperCase()) + '</div><div class="txt"><div><b>' + esc(id.name) + '</b></div><div class="muted">' + esc(id.email) + '</div></div><button class="sec" data-a="editWho" title="Não é você? Troque o nome e o e-mail dos commits">Trocar</button></div>';
}
function render() {
	const a = [];
	a.push('<div class="sec-h">Conta do GitHub</div>');
	a.push(S.account
		? '<div class="card who"><div class="av">🐙</div><div class="txt"><div><b>' + esc(S.account) + '</b></div><div class="muted">conectado</div></div><button class="sec" data-a="logout">Sair</button></div>'
		: '<div class="card"><div class="muted">Entre para ver seus repositórios, baixar e enviar projetos.</div><div class="row"><button data-a="login">Entrar no GitHub</button></div></div>');
	a.push('<div class="sec-h">Quem está fazendo os commits</div>');
	a.push(whoCard());
	a.push('<div class="sec-h">Projeto aberto <button class="icon" data-a="refresh" title="Atualizar">⟳</button></div>');
	if (!S.folder) a.push('<div class="empty">Nenhum projeto aberto.</div>');
	else if (!S.hasRepo) a.push('<div class="card"><div class="title"><b>' + esc(S.folder) + '</b></div><div class="muted sub">Este projeto ainda não está no GitHub.</div><div class="row"><button data-a="create">Publicar no GitHub</button></div></div>');
	else {
		a.push('<div class="card"><div class="title"><b>' + esc(S.folder) + '</b><span class="tag">⎇ ' + esc(S.branch) + '</span></div>' +
			(S.remote ? '<div class="sub"><button class="link" data-a="openRepo" data-url="' + esc(S.remote) + '">' + esc(S.remote.replace(/^https?:\\/\\//, '')) + '</button></div>' : '<div class="muted sub">Sem repositório no GitHub. <button class="link" data-a="create">Conectar</button></div>') +
			'<div class="row"><button class="sec" data-a="pull"' + dis() + '>⬇ Atualizar</button><button class="sec" data-a="push"' + dis() + '>⬆ Enviar' + (S.ahead > 0 ? ' (' + S.ahead + ')' : '') + '</button></div>' +
			(S.busy ? '<div class="busy"><span class="spin"></span>' + esc(S.busy) + '</div>' : '') + '</div>');
		a.push('<div class="sec-h">Alterações <span class="count">' + S.changes.length + '</span></div>');
		if (!S.changes.length) a.push('<div class="empty">Nenhuma alteração desde o último commit.</div>');
		else {
			a.push('<div class="list"><div class="item head"><input type="checkbox" id="all" ' + (unchecked.size ? '' : 'checked') + '><label for="all" class="name">Selecionar todos</label></div>');
			for (const c of S.changes) {
				const i = c.file.lastIndexOf('/');
				const base = c.file.slice(i + 1), dir = i >= 0 ? c.file.slice(0, i) : '';
				a.push('<div class="item"><input type="checkbox" data-file="' + esc(c.file) + '" ' + (unchecked.has(c.file) ? '' : 'checked') + '><span class="name" data-a="diff" data-file="' + esc(c.file) + '" title="' + esc(c.file) + ' (ver diferenças)">' + esc(base) + (dir ? '<span class="dir">' + esc(dir) + '</span>' : '') + '</span><span class="tag st-' + esc(c.status) + '">' + esc(c.status) + '</span></div>');
			}
			a.push('</div><textarea id="msg" placeholder="Resumo do que você fez (obrigatório)">' + esc(draft) + '</textarea>');
			a.push('<div class="row"><button class="sec" data-a="commit"' + dis() + '>✔ Commit</button><button data-a="commitPush"' + dis() + '>⬆ Commit e enviar</button></div>');
		}
		a.push('<div class="sec-h">Histórico</div>');
		if (!S.log.length) a.push('<div class="empty">Nenhum commit ainda.</div>');
		else {
			a.push('<div class="log">');
			for (const l of S.log) a.push('<div class="c"><div class="msg" title="' + esc(l.msg) + '">' + esc(l.msg) + '</div><div class="muted">' + esc(l.author) + ' · ' + esc(l.when) + ' · ' + esc(l.hash) + '</div></div>');
			a.push('</div>');
		}
	}
	a.push('<div class="sec-h">Meus repositórios</div>');
	if (!S.account) a.push('<div class="empty">Entre no GitHub para ver.</div>');
	else if (!S.repos) { a.push('<div class="empty">Carregando…</div>'); send('loadRepos'); S.repos = []; }
	else {
		a.push('<input type="text" id="filter" placeholder="Filtrar repositórios" value="' + esc(filter) + '">');
		const list = S.repos.filter(r => r.name.toLowerCase().includes(filter.toLowerCase()));
		if (!list.length) a.push('<div class="empty">Nenhum repositório.</div>');
		else {
			a.push('<div class="list" style="margin-top:8px">');
			for (const r of list) a.push('<div class="item"><span>' + (r.private ? '🔒' : '📁') + '</span><span class="name" data-a="openRepo" data-url="' + esc(r.html) + '" title="' + esc(r.desc || 'Abrir no navegador') + '">' + esc(r.name) + '</span><button class="link" data-a="clone" data-url="' + esc(r.url) + '">Baixar</button></div>');
			a.push('</div>');
		}
	}
	a.push('<div class="row"><button class="sec" data-a="cloneOther">Baixar por link…</button></div>');
	document.getElementById('app').innerHTML = a.join('');
	const f = document.getElementById('filter');
	if (f) f.oninput = () => { filter = f.value; const pos = f.selectionStart; render(); const g = document.getElementById('filter'); g.focus(); g.setSelectionRange(pos, pos); };
	const m = document.getElementById('msg');
	if (m) m.oninput = () => { draft = m.value; };
}
document.addEventListener('change', e => {
	if (e.target.id === 'all') { unchecked = e.target.checked ? new Set() : new Set(S.changes.map(c => c.file)); render(); }
	else if (e.target.dataset.file) { e.target.checked ? unchecked.delete(e.target.dataset.file) : unchecked.add(e.target.dataset.file); }
});
document.addEventListener('click', e => {
	const el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
	const act = el.dataset.a;
	if (act === 'editWho') { editWho = true; render(); return; }
	if (act === 'cancelWho') { editWho = false; render(); return; }
	if (act === 'saveWho') {
		const name = document.getElementById('gname').value.trim(), email = document.getElementById('gemail').value.trim();
		if (!name) { document.getElementById('gname').focus(); return; }
		if (!/.+@.+\\..+/.test(email)) { document.getElementById('gemail').focus(); return; }
		editWho = false; send('identity', { name, email }); return;
	}
	if (act === 'commit' || act === 'commitPush') {
		if (S.busy) return;
		const id = S.identity || {};
		if (!id.name || !id.email) { editWho = true; render(); document.getElementById('gname').focus(); return; }
		if (draft.trim().length < 3) { const t = document.getElementById('msg'); t.focus(); t.placeholder = 'Escreva uma mensagem com pelo menos 3 letras'; return; }
		const files = S.changes.map(c => c.file).filter(f => !unchecked.has(f));
		if (!files.length) return;
		S.busy = act === 'commitPush' ? 'Fazendo commit e enviando…' : 'Fazendo commit…';
		send('commit', { message: draft, push: act === 'commitPush', files });
		draft = ''; unchecked = new Set(); render();
		return;
	}
	if ((act === 'push' || act === 'pull') && S.busy) return;
	if (act === 'push' || act === 'pull') { S.busy = act === 'push' ? 'Enviando…' : 'Atualizando…'; render(); }
	send(act, { url: el.dataset.url, file: el.dataset.file });
});
send('refresh');
</script></body></html>`;
	}
}

function registerGithubPanel(context, trustFolder, rescan) {
	const panel = new GithubPanel(context, trustFolder, rescan);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('devcode.github.panel', panel, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.workspace.onDidSaveTextDocument(() => panel.refresh()),
		vscode.workspace.onDidCreateFiles(() => panel.refresh()),
		vscode.workspace.onDidDeleteFiles(() => panel.refresh()),
	);
	gh.onDidChange(() => { panel.repos = undefined; panel.refresh(); });
}

module.exports = { registerGithubPanel, GithubPanel };
