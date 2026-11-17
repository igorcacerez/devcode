/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Tela Inicial.
 *  Aparece ao abrir a IDE sem projeto: criar projeto (Python, HTML, React, React Native),
 *  baixar do Git (com login no GitHub) e reabrir projetos recentes.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const path = require('path');
const { runProjectAction, recentProjects } = require('./project');
const gh = require('./githubAuth');

let panel;

const CARDS = [
	{ id: 'python', icon: '🐍', title: 'Python', desc: 'Com ambiente virtual (.venv) pronto, estilo PyCharm.' },
	{ id: 'colab', icon: '📓', title: 'Colab (notebook Python)', desc: 'Células de código com o resultado embaixo, igual ao Google Colab. Ideal para lógica.' },
	{ id: 'html', icon: '🌐', title: 'HTML, CSS e JavaScript', desc: 'Site com Live Server: a página recarrega sozinha ao salvar.' },
	{ id: 'react', icon: '⚛️', title: 'React', desc: 'Vite + React, mínimo, sem TypeScript.' },
	{ id: 'expo', icon: '📱', title: 'React Native (Expo)', desc: 'App de celular, template blank. Teste no Expo Go.' },
];

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

function html(webview, extensionUri) {
	const logo = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'logo.png'));
	const nonce = Math.random().toString(36).slice(2);
	const recent = recentProjects();
	const logged = gh.isLoggedIn();
	const cards = CARDS.map(c => `
		<button class="card" data-action="${c.id}">
			<span class="card-icon" aria-hidden="true">${c.icon}</span>
			<span class="card-title">${escapeHtml(c.title)}</span>
			<span class="card-desc">${escapeHtml(c.desc)}</span>
		</button>`).join('');
	const recentList = recent.length
		? recent.map(r => `
			<button class="recent" data-action="open" data-root="${escapeHtml(r.root)}">
				<span class="recent-name">📁 ${escapeHtml(path.basename(r.root))}</span>
				<span class="recent-path">${escapeHtml(r.root)}</span>
			</button>`).join('')
		: '<p class="empty">Nenhum projeto ainda. Crie o seu primeiro ao lado! 👈</p>';

	return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
	:root { --red: #D10A0A; --red-hover: #B00000; --red-soft: #D10A0A12; }
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 40px 48px 56px;
		font-family: var(--vscode-font-family); color: var(--vscode-foreground);
		background: var(--vscode-editor-background);
	}
	.wrap { max-width: 1040px; margin: 0 auto; }
	header { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-bottom: 36px; }
	header img { height: 92px; }
	.account { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--vscode-descriptionForeground); }
	h2 { font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin: 0 0 14px; }
	.cols { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 40px; }
	@media (max-width: 820px) { .cols { grid-template-columns: 1fr; } }
	.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
	@media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
	button { font: inherit; color: inherit; cursor: pointer; text-align: left; }
	.card {
		display: flex; flex-direction: column; gap: 6px; padding: 18px;
		background: var(--vscode-editorWidget-background, #fff); border: 1px solid var(--vscode-widget-border, #e5e5e5);
		border-radius: 12px; transition: border-color .15s, box-shadow .15s, transform .15s;
	}
	.card:hover, .card:focus-visible { border-color: var(--red); box-shadow: 0 4px 16px var(--red-soft); transform: translateY(-1px); outline: none; }
	.card-icon { font-size: 26px; }
	.card-title { font-size: 15px; font-weight: 600; }
	.card-desc { font-size: 12.5px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
	.git {
		margin-top: 22px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
		padding: 18px 20px; border-radius: 12px; background: var(--red-soft); border: 1px solid #D10A0A33;
	}
	.git-text strong { display: block; font-size: 15px; margin-bottom: 3px; }
	.git-text span { font-size: 12.5px; color: var(--vscode-descriptionForeground); }
	.btn { border: none; border-radius: 8px; padding: 9px 16px; font-weight: 600; background: var(--red); color: #fff; }
	.btn:hover, .btn:focus-visible { background: var(--red-hover); outline: none; }
	.btn.secondary { background: transparent; color: var(--red); border: 1px solid var(--red); }
	.btn.secondary:hover { background: var(--red-soft); }
	.recent-box { display: flex; flex-direction: column; gap: 6px; }
	.recent {
		display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 8px;
		background: transparent; border: 1px solid transparent;
	}
	.recent:hover, .recent:focus-visible { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-widget-border, #e5e5e5); outline: none; }
	.recent-name { font-weight: 600; font-size: 13.5px; }
	.recent-path { font-size: 11.5px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.empty { font-size: 13px; color: var(--vscode-descriptionForeground); }
	.tip { margin-top: 28px; font-size: 12.5px; color: var(--vscode-descriptionForeground); line-height: 1.6; border-left: 3px solid var(--red); padding-left: 12px; }
	kbd { font-family: var(--vscode-editor-font-family); font-size: 11.5px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--vscode-widget-border, #ddd); }
</style>
</head>
<body>
<div class="wrap">
	<header>
		<img src="${logo}" alt="DEV CODE">
		<div class="account">
			${logged
		? `<span>✔ Conectado ao GitHub</span><button class="btn secondary" data-action="logout">Sair</button>`
		: `<span>Use sua conta do GitHub para baixar e enviar projetos</span><button class="btn secondary" data-action="login">Entrar no GitHub</button>`}
		</div>
	</header>
	<div class="cols">
		<section>
			<h2>Criar novo projeto</h2>
			<div class="grid">${cards}</div>
			<div class="git">
				<div class="git-text">
					<strong>🐙 Projeto do Git</strong>
					<span>Baixe um projeto seu (ou do professor) do GitHub e continue de onde parou.</span>
				</div>
				<button class="btn" data-action="git">Baixar do Git</button>
			</div>
		</section>
		<section>
			<h2>Projetos recentes</h2>
			<div class="recent-box">${recentList}</div>
			<p class="tip">Para executar seu código, use o botão <strong>▶</strong> ou <kbd>F5</kbd>.<br>Antes de rodar, o DEV CODE faz uma pergunta sobre o seu código. 😉</p>
		</section>
	</div>
</div>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	document.addEventListener('click', e => {
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
			default: return runProjectAction(msg.action, msg.root);
		}
	});
}

function registerStartPage(context) {
	context.subscriptions.push(vscode.commands.registerCommand('devcode.startPage', () => showStartPage(context)));
	context.subscriptions.push(vscode.authentication.onDidChangeSessions(() => setTimeout(() => render(context), 300)));
}

module.exports = { registerStartPage, showStartPage };
