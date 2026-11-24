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
				git.run(repo, ['status', '--porcelain', '-uall']),
				git.run(repo, ['log', '-20', '--date=format:%d/%m/%Y %H:%M', '--pretty=format:%h\x1f%s\x1f%an\x1f%ad']),
				git.run(repo, ['remote', 'get-url', 'origin']),
				git.run(repo, ['rev-list', '--count', '@{u}..HEAD']),
			]);
			s.branch = branch.out || 'main';
			s.remote = remote.ok ? remote.out.replace(/\.git$/, '') : '';
			s.ahead = ahead.ok ? Number(ahead.out) : (log.out ? -1 : 0);
			s.changes = status.out.split(/\r?\n/).filter(Boolean).map(l => {
				const code = l.slice(0, 2).trim()[0] || '?';
				return { file: l.slice(3).replace(/^"|"$/g, '').replace(/^.* -> /, ''), status: STATUS[code] || code };
			});
			s.log = log.out ? log.out.split('\n').map(l => { const [hash, msg, author, when] = l.split('\x1f'); return { hash, msg, author, when }; }) : [];
		}
		return s;
	}

	async refresh() {
		if (!this.view?.visible) { return; }
		this.view.webview.postMessage({ type: 'state', state: await this.state() });
	}

	async onMessage(m) {
		const repo = git.currentRepo();
		switch (m.type) {
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
				const files = m.files || [];
				if (!files.length) { vscode.window.showWarningMessage('DEV CODE: marque pelo menos um arquivo para o commit.'); return; }
				const add = await git.run(repo, ['add', '-A', '--', ...files]);
				const c = add.ok ? await git.run(repo, ['commit', '-m', m.message.trim(), '--', ...files]) : add;
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

	html() {
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:0 10px 16px}
h3{font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.8;margin:16px 0 6px;display:flex;justify-content:space-between;align-items:center}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:5px 10px;border-radius:2px;cursor:pointer;font:inherit}
button:hover{background:var(--vscode-button-hoverBackground)}
button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button.link{background:none;color:var(--vscode-textLink-foreground);padding:0}
button:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.row button{flex:1}
.card{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:8px;margin:6px 0}
.muted{opacity:.7;font-size:12px}
.item{display:flex;align-items:center;gap:6px;padding:3px 2px;border-radius:2px}
.item:hover{background:var(--vscode-list-hoverBackground)}
.item .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.tag{font-size:10px;padding:0 5px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
textarea,input[type=text]{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:5px;font:inherit;border-radius:2px}
textarea{min-height:48px;resize:vertical}
.log .msg{font-weight:600}.empty{opacity:.7;padding:6px 0}
</style></head><body><div id="app">Carregando…</div><script>
const vscode = acquireVsCodeApi();
let S = {}; let filter = ''; let unchecked = new Set(); let draft = '';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const send = (type, extra) => vscode.postMessage({ type, ...extra });
window.addEventListener('message', e => { if (e.data.type === 'state') { S = e.data.state; render(); } });
function render() {
	const a = [];
	a.push('<h3>Conta</h3>');
	a.push(S.account
		? '<div class="item"><span class="name">👤 <b>' + esc(S.account) + '</b></span><button class="link" data-a="logout">Sair</button></div>'
		: '<div class="card"><div class="muted">Entre na sua conta para ver seus repositórios, baixar e enviar projetos.</div><div class="row"><button data-a="login">Entrar no GitHub</button></div></div>');
	a.push('<h3>Projeto aberto <button class="link" data-a="refresh" title="Atualizar">⟳</button></h3>');
	if (!S.folder) a.push('<div class="empty">Nenhum projeto aberto.</div>');
	else if (!S.hasRepo) a.push('<div class="card"><b>' + esc(S.folder) + '</b><div class="muted">Este projeto ainda não está no GitHub.</div><div class="row"><button data-a="create">Publicar no GitHub</button></div></div>');
	else {
		a.push('<div class="card"><b>' + esc(S.folder) + '</b> <span class="tag">⎇ ' + esc(S.branch) + '</span>' +
			(S.remote ? '<div class="muted"><button class="link" data-a="openRepo" data-url="' + esc(S.remote) + '">' + esc(S.remote.replace(/^https?:\\/\\//, '')) + '</button></div>' : '<div class="muted">Sem repositório no GitHub. <button class="link" data-a="create">Conectar</button></div>') +
			'<div class="row"><button class="sec" data-a="pull">⬇ Atualizar (pull)</button><button class="sec" data-a="push">⬆ Enviar (push)' + (S.ahead > 0 ? ' · ' + S.ahead : '') + '</button></div></div>');
		a.push('<h3>Alterações (' + S.changes.length + ')</h3>');
		if (!S.changes.length) a.push('<div class="empty">Nenhuma alteração desde o último commit.</div>');
		else {
			a.push('<div class="item"><input type="checkbox" id="all" ' + (unchecked.size ? '' : 'checked') + '><label for="all" class="name">Selecionar todos</label></div>');
			for (const c of S.changes) a.push('<div class="item"><input type="checkbox" data-file="' + esc(c.file) + '" ' + (unchecked.has(c.file) ? '' : 'checked') + '><span class="name" data-a="diff" data-file="' + esc(c.file) + '" title="Ver diferenças">' + esc(c.file) + '</span><span class="tag">' + esc(c.status) + '</span></div>');
			a.push('<textarea id="msg" placeholder="Resumo do que você fez (obrigatório)">' + esc(draft) + '</textarea>');
			a.push('<div class="row"><button id="commit" data-a="commit">✔ Commit</button><button id="commitPush" data-a="commitPush">✔ Commit e enviar</button></div>');
		}
		a.push('<h3>Histórico</h3><div class="log">');
		if (!S.log.length) a.push('<div class="empty">Nenhum commit ainda.</div>');
		for (const l of S.log) a.push('<div class="card"><div class="msg">' + esc(l.msg) + '</div><div class="muted">' + esc(l.author) + ' · ' + esc(l.when) + ' · ' + esc(l.hash) + '</div></div>');
		a.push('</div>');
	}
	a.push('<h3>Meus repositórios</h3>');
	if (!S.account) a.push('<div class="empty">Entre no GitHub para ver.</div>');
	else if (!S.repos) { a.push('<div class="empty">Carregando…</div>'); send('loadRepos'); S.repos = []; }
	else {
		a.push('<input type="text" id="filter" placeholder="Filtrar repositórios" value="' + esc(filter) + '">');
		const list = S.repos.filter(r => r.name.toLowerCase().includes(filter.toLowerCase()));
		if (!list.length) a.push('<div class="empty">Nenhum repositório.</div>');
		for (const r of list) a.push('<div class="item"><span>' + (r.private ? '🔒' : '📁') + '</span><span class="name" data-a="openRepo" data-url="' + esc(r.html) + '" title="' + esc(r.desc || 'Abrir no navegador') + '">' + esc(r.name) + '</span><button class="link" data-a="clone" data-url="' + esc(r.url) + '">Baixar</button></div>');
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
	const el = e.target.closest('[data-a]'); if (!el) return;
	const act = el.dataset.a;
	if (act === 'commit' || act === 'commitPush') {
		if (draft.trim().length < 3) { document.getElementById('msg').focus(); document.getElementById('msg').placeholder = 'Escreva uma mensagem com pelo menos 3 letras'; return; }
		send('commit', { message: draft, push: act === 'commitPush', files: S.changes.map(c => c.file).filter(f => !unchecked.has(f)) });
		draft = ''; unchecked = new Set();
		return;
	}
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
