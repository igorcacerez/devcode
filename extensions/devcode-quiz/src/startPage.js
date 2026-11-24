/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Tela Inicial.
 *  Aparece ao abrir a IDE sem projeto: criar projeto (por categoria, com busca), baixar do Git,
 *  reabrir projetos recentes e abrir as ferramentas (API, Banco de Dados, GitHub, Android).
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const path = require('path');
const { runProjectAction, recentProjects } = require('./project');
const gh = require('./githubAuth');

let panel;

const CATEGORIES = [
	{ id: 'prog', title: 'Programação', desc: 'Lógica, algoritmos e back-end' },
	{ id: 'web', title: 'Web', desc: 'Sites e aplicações para o navegador' },
	{ id: 'mobile', title: 'Mobile', desc: 'Apps para celular' },
	{ id: 'design', title: 'Design e Qualidade', desc: 'Planejar as telas e testar o que foi feito' },
];

const CARDS = [
	{ id: 'python', cat: 'prog', icon: '🐍', title: 'Python', desc: 'Projeto com ambiente virtual (.venv) pronto, estilo PyCharm.', tags: ['Python'] },
	{ id: 'colab', cat: 'prog', icon: '📓', title: 'Colab', desc: 'Notebook com células e o resultado embaixo, como no Google Colab. Ideal para lógica.', tags: ['Python', 'Notebook'] },
	{ id: 'branco', cat: 'prog', icon: '📂', title: 'Projeto em branco', desc: 'Só a pasta. Você cria todos os arquivos do zero, em qualquer linguagem.', tags: ['Livre'] },
	{ id: 'html', cat: 'web', icon: '🌐', title: 'HTML, CSS e JavaScript', desc: 'Site com Live Server: a página recarrega sozinha ao salvar.', tags: ['HTML', 'CSS', 'JS'] },
	{ id: 'react', cat: 'web', icon: '⚛️', title: 'React', desc: 'Vite + React, mínimo e sem TypeScript.', tags: ['React', 'Vite'] },
	{ id: 'expo', cat: 'mobile', icon: '📱', title: 'React Native (Expo)', desc: 'App de celular que abre no emulador Android ou no Expo Go.', tags: ['React Native', 'Android'] },
	{ id: 'prototipo', cat: 'design', icon: '🎨', title: 'Protótipo (telas)', desc: 'Desenhe as telas antes de programar: frames, camadas e estilos.', tags: ['Figma'] },
	{ id: 'diagrama', cat: 'design', icon: '🧩', title: 'Diagramas', desc: 'Fluxogramas, diagrama de classes (UML), modelagem de banco (DER) e casos de uso.', tags: ['Visio', 'UML', 'DER'] },
	{ id: 'teste', cat: 'design', icon: '🧪', title: 'Teste de Sites', desc: 'Grave testes clicando no site e veja o relatório de sucessos e falhas.', tags: ['Selenium'] },
];

const TOOLS = [
	{ cmd: 'workbench.view.extension.devcode-api', icon: '🔌', title: 'Cliente de API', desc: 'Teste requisições (estilo Postman)' },
	{ cmd: 'workbench.view.extension.devcode-db', icon: '🗄️', title: 'Banco de Dados', desc: 'Firebird, MySQL, PostgreSQL, SQLite' },
	{ cmd: 'workbench.view.extension.devcode-github', icon: '🐙', title: 'GitHub', desc: 'Commits, envio e repositórios' },
	{ cmd: 'devcode.android.start', icon: '🤖', title: 'Emulador Android', desc: 'Ligar o celular virtual' },
];

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

function html(webview, extensionUri) {
	const logo = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'logo.png'));
	const nonce = Math.random().toString(36).slice(2);
	const recent = recentProjects();
	const logged = gh.isLoggedIn();
	const hour = new Date().getHours();
	const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
	const card = c => `
		<button class="card" data-action="${c.id}" data-search="${escapeHtml((c.title + ' ' + c.desc + ' ' + c.tags.join(' ')).toLowerCase())}">
			<span class="card-icon" aria-hidden="true">${c.icon}</span>
			<span class="card-body">
				<span class="card-title">${escapeHtml(c.title)}</span>
				<span class="card-desc">${escapeHtml(c.desc)}</span>
				<span class="tags">${c.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span>
			</span>
		</button>`;
	const sections = CATEGORIES.map(cat => `
		<section class="cat" data-cat="${cat.id}">
			<div class="cat-head"><h3>${escapeHtml(cat.title)}</h3><span>${escapeHtml(cat.desc)}</span></div>
			<div class="grid">${CARDS.filter(c => c.cat === cat.id).map(card).join('')}</div>
		</section>`).join('');
	const chips = [['all', 'Todos'], ...CATEGORIES.map(c => [c.id, c.title])]
		.map(([id, t], i) => `<button class="chip${i ? '' : ' on'}" data-chip="${id}">${escapeHtml(t)}</button>`).join('');
	const tools = TOOLS.map(t => `
		<button class="tool" data-cmd="${t.cmd}">
			<span class="tool-icon" aria-hidden="true">${t.icon}</span>
			<span class="tool-text"><span class="tool-title">${escapeHtml(t.title)}</span><span class="tool-desc">${escapeHtml(t.desc)}</span></span>
		</button>`).join('');
	const recentList = recent.length
		? recent.map(r => `
			<button class="recent" data-action="open" data-root="${escapeHtml(r.root)}" data-search="${escapeHtml(r.root.toLowerCase())}">
				<span class="recent-icon" aria-hidden="true">📁</span>
				<span class="recent-text"><span class="recent-name">${escapeHtml(path.basename(r.root))}</span>
				<span class="recent-path">${escapeHtml(r.root)}</span></span>
			</button>`).join('')
		: '<p class="empty">Nenhum projeto ainda. Escolha um tipo ao lado e crie o seu primeiro! 🚀</p>';

	return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
	:root { --red: #D10A0A; --red-hover: #B00000; --red-soft: #D10A0A14; --line: var(--vscode-widget-border, #e3e3e3); --muted: var(--vscode-descriptionForeground); --panel: var(--vscode-editorWidget-background, #fff); }
	* { box-sizing: border-box; }
	body { margin: 0; padding: 28px 40px 56px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
	.wrap { max-width: 1180px; margin: 0 auto; }
	button { font: inherit; color: inherit; cursor: pointer; text-align: left; background: none; border: 0; }
	header { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
	header img { height: 64px; }
	.account { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--muted); }
	.hero { margin: 24px 0 16px; padding: 26px 28px; border-radius: 16px; border: 1px solid #D10A0A30; background: linear-gradient(120deg, #D10A0A1f, #D10A0A08 55%, transparent); }
	.hero h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; }
	.hero p { margin: 0 0 16px; color: var(--muted); font-size: 13.5px; }
	.search { width: 100%; max-width: 540px; padding: 11px 14px; border-radius: 10px; font: inherit; font-size: 14px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--line); outline: none; }
	.search:focus { border-color: var(--red); box-shadow: 0 0 0 3px var(--red-soft); }
	.chips { display: flex; gap: 8px; flex-wrap: wrap; }
	.chip { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
	.chip:hover { border-color: var(--red); color: var(--vscode-foreground); }
	.chip.on { background: var(--red); border-color: var(--red); color: #fff; }
	.cols { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 36px; }
	@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
	.cat { margin-top: 22px; }
	.cat-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
	.cat-head h3 { margin: 0; font-size: 15px; }
	.cat-head span { font-size: 12px; color: var(--muted); }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
	.card { display: flex; gap: 14px; padding: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; transition: border-color .15s, box-shadow .15s, transform .15s; }
	.card:hover, .card:focus-visible { border-color: var(--red); box-shadow: 0 6px 20px var(--red-soft); transform: translateY(-2px); outline: none; }
	.card-icon { font-size: 22px; width: 44px; height: 44px; flex: none; display: grid; place-items: center; border-radius: 10px; background: var(--red-soft); }
	.card-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.card-title { font-size: 14.5px; font-weight: 600; }
	.card-desc { font-size: 12.5px; color: var(--muted); line-height: 1.45; }
	.tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
	.tag { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
	.git { margin-top: 26px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 16px 20px; border-radius: 12px; border: 1px dashed #D10A0A66; }
	.git strong { display: block; font-size: 14.5px; margin-bottom: 2px; }
	.git span { font-size: 12.5px; color: var(--muted); }
	.btn { border-radius: 8px; padding: 8px 16px; font-weight: 600; background: var(--red); color: #fff; white-space: nowrap; }
	.btn:hover, .btn:focus-visible { background: var(--red-hover); outline: none; }
	.btn.secondary { background: transparent; color: var(--red); border: 1px solid var(--red); }
	.btn.secondary:hover { background: var(--red-soft); }
	aside h2 { font-size: 11.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin: 22px 0 10px; }
	.box { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 6px; }
	.recent, .tool { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 8px; }
	.recent:hover, .tool:hover, .recent:focus-visible, .tool:focus-visible { background: var(--vscode-list-hoverBackground); outline: none; }
	.recent-text, .tool-text { display: flex; flex-direction: column; min-width: 0; }
	.recent-name, .tool-title { font-weight: 600; font-size: 13px; }
	.recent-path, .tool-desc { font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tool-icon, .recent-icon { font-size: 18px; width: 30px; text-align: center; flex: none; }
	.empty { font-size: 13px; color: var(--muted); padding: 8px 10px; margin: 0; }
	.tip { margin-top: 22px; font-size: 12.5px; color: var(--muted); line-height: 1.6; border-left: 3px solid var(--red); padding-left: 12px; }
	.none { display: none; color: var(--muted); font-size: 13px; margin-top: 22px; }
	kbd { font-family: var(--vscode-editor-font-family); font-size: 11.5px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--line); }
	.hidden { display: none !important; }
</style>
</head>
<body>
<div class="wrap">
	<header>
		<img src="${logo}" alt="DEV CODE">
		<div class="account">
			${logged
		? '<span>✔ Conectado ao GitHub</span><button class="btn secondary" data-action="logout">Sair</button>'
		: '<span>Entre para baixar e enviar projetos</span><button class="btn secondary" data-action="login">Entrar no GitHub</button>'}
		</div>
	</header>
	<div class="hero">
		<h1>${hello}! O que vamos criar hoje?</h1>
		<p>Escolha um tipo de projeto, abra um recente ou use as ferramentas. Tudo dentro do DEV CODE.</p>
		<input class="search" id="search" type="text" placeholder="🔍 Buscar projeto, linguagem ou recente (ex.: python, site, app)" autofocus>
	</div>
	<div class="chips">${chips}</div>
	<div class="cols">
		<main>
			${sections}
			<p class="none" id="none">Nada encontrado para essa busca.</p>
			<div class="git">
				<div><strong>🐙 Projeto do Git</strong><span>Baixe um projeto seu (ou do professor) do GitHub e continue de onde parou.</span></div>
				<button class="btn" data-action="git">Baixar do Git</button>
			</div>
		</main>
		<aside>
			<h2>Projetos recentes</h2>
			<div class="box">${recentList}</div>
			<h2>Ferramentas</h2>
			<div class="box">${tools}</div>
			<p class="tip">Para executar seu código, use o botão <strong>▶</strong> ou <kbd>F5</kbd>.<br>Antes de rodar, o DEV CODE faz uma pergunta sobre o seu código. 😉</p>
		</aside>
	</div>
</div>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	let chip = 'all';
	const search = document.getElementById('search');
	function apply() {
		const q = search.value.trim().toLowerCase();
		let any = false;
		document.querySelectorAll('.cat').forEach(sec => {
			let shown = 0;
			sec.querySelectorAll('.card').forEach(c => {
				const ok = (chip === 'all' || sec.dataset.cat === chip) && (!q || c.dataset.search.includes(q));
				c.classList.toggle('hidden', !ok);
				if (ok) { shown++; }
			});
			sec.classList.toggle('hidden', !shown);
			if (shown) { any = true; }
		});
		document.querySelectorAll('.recent').forEach(r => r.classList.toggle('hidden', !!q && !r.dataset.search.includes(q)));
		document.getElementById('none').style.display = any ? 'none' : 'block';
	}
	search.addEventListener('input', apply);
	search.addEventListener('keydown', e => {
		if (e.key === 'Enter') { const first = document.querySelector('.card:not(.hidden), .recent:not(.hidden)'); if (first) { first.click(); } }
	});
	document.addEventListener('click', e => {
		const c = e.target.closest('[data-chip]');
		if (c) { chip = c.dataset.chip; document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); apply(); return; }
		const t = e.target.closest('[data-cmd]');
		if (t) { vscode.postMessage({ action: 'command', cmd: t.dataset.cmd }); return; }
		const el = e.target.closest('[data-action]');
		if (el) { vscode.postMessage({ action: el.dataset.action, root: el.dataset.root }); }
	});
</script>
</body>
</html>`;
}

function render(context) {
	if (panel) {
		panel.webview.html = html(panel.webview, context.extensionUri);
	}
}

function showStartPage(context) {
	if (panel) {
		render(context);
		panel.reveal(vscode.ViewColumn.One);
		return;
	}
	panel = vscode.window.createWebviewPanel('devcode.start', 'Início', vscode.ViewColumn.One, {
		enableScripts: true,
		retainContextWhenHidden: false,
		localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
	});
	panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
	render(context);
	panel.onDidDispose(() => { panel = undefined; });
	panel.webview.onDidReceiveMessage(async msg => {
		switch (msg.action) {
			case 'login': await vscode.commands.executeCommand('devcode.github.login'); return render(context);
			case 'logout': await vscode.commands.executeCommand('devcode.github.logout'); return render(context);
			case 'command': return vscode.commands.executeCommand(msg.cmd);
			default: return runProjectAction(msg.action, msg.root);
		}
	});
}

function registerStartPage(context) {
	context.subscriptions.push(vscode.commands.registerCommand('devcode.startPage', () => showStartPage(context)));
	context.subscriptions.push(vscode.authentication.onDidChangeSessions(() => setTimeout(() => render(context), 300)));
}

module.exports = { registerStartPage, showStartPage, html };
