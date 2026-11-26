'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fileGuard = require('./fileGuard');
const authorship = require('./authorship');
const { requireAdmin } = require('./adminAuth');

const SCHEME = 'devcode-quarentena';
const OPEN_BUTTON = { iconPath: new vscode.ThemeIcon('go-to-file'), tooltip: 'Abrir (somente leitura)', location: vscode.QuickInputButtonLocation.Inline };
const RELEASE_BUTTON = { iconPath: new vscode.ThemeIcon('shield'), tooltip: 'Liberar (professor)', location: vscode.QuickInputButtonLocation.Inline };
const DISCARD_BUTTON = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Descartar', location: vscode.QuickInputButtonLocation.Inline };
const LANGUAGE_BY_EXTENSION = {
	'.py': 'python', '.pyw': 'python', '.pyi': 'python', '.ipynb': 'json',
	'.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascriptreact',
	'.ts': 'typescript', '.tsx': 'typescriptreact', '.html': 'html', '.htm': 'html',
	'.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less', '.json': 'json', '.jsonc': 'jsonc',
	'.md': 'markdown', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
	'.sql': 'sql', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.c': 'c', '.h': 'c',
	'.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.cs': 'csharp', '.go': 'go',
	'.rs': 'rust', '.rb': 'ruby', '.php': 'php', '.sh': 'shellscript', '.bash': 'shellscript',
	'.ps1': 'powershell', '.bat': 'bat', '.cmd': 'bat', '.vue': 'vue', '.svelte': 'svelte',
};

function digest(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function allEntries(context) {
	const roots = new Map();
	for (const folder of vscode.workspace.workspaceFolders || []) { roots.set(path.resolve(folder.uri.fsPath), folder.uri.fsPath); }
	for (const folder of fileGuard.listTrustedFolders(context)) { roots.set(path.resolve(folder.root), folder.root); }
	const items = [];
	for (const root of roots.values()) {
		for (const entry of fileGuard.readQuarantine(context, root)) {
			items.push({ ...entry, root, key: `${fileGuard.folderKey(root)}-${digest(entry.rel)}` });
		}
	}
	return items.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

function findEntry(context, key) {
	return allEntries(context).find(entry => entry.key === key);
}

function uriFor(entry) {
	return vscode.Uri.from({ scheme: SCHEME, path: `/${entry.rel}`, query: `key=${entry.key}` });
}

async function openEntry(entry) {
	if (!entry) { return; }
	const uri = uriFor(entry);
	let document = await vscode.workspace.openTextDocument(uri);
	const language = LANGUAGE_BY_EXTENSION[path.extname(entry.rel).toLowerCase()];
	const languages = language ? await vscode.languages.getLanguages() : [];
	if (language && languages.includes(language) && document.languageId !== language) {
		document = await vscode.languages.setTextDocumentLanguage(document, language);
	}
	await vscode.window.showTextDocument(document, { preview: false });
}

function describe(entry) {
	const date = new Date(entry.savedAt).toLocaleString('pt-BR');
	return `${entry.lines} linhas · ${date} · ${path.basename(entry.root)}`;
}

function pickerItem(entry) {
	return {
		label: `$(file-code) ${entry.rel}`,
		description: describe(entry),
		detail: entry.reason,
		buttons: [OPEN_BUTTON, RELEASE_BUTTON, DISCARD_BUTTON],
		entry,
	};
}

let quarantinePanel;

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

function panelHtml(entries) {
	const nonce = crypto.randomBytes(16).toString('hex');
	const groups = new Map();
	for (const entry of entries) {
		if (!groups.has(entry.root)) { groups.set(entry.root, []); }
		groups.get(entry.root).push(entry);
	}
	const rows = [...groups.entries()].map(([root, list]) => `
		<section class="repo">
			<header><label><input type="checkbox" class="all-repo"> <span class="repo-name">📁 ${escapeHtml(path.basename(root))}</span></label>
			<span class="muted">${list.length} arquivo(s) · ${escapeHtml(root)}</span>
			<button class="ghost" data-act="trust" data-root="${escapeHtml(root)}" title="Libera todos os próximos pulls deste repositório (pede a senha do administrador)">🛡 Confiar neste repositório</button></header>
			${list.map(entry => `
			<div class="item">
				<input type="checkbox" class="pick" data-key="${entry.key}">
				<div class="info" data-act="open" data-key="${entry.key}">
					<div class="file">${escapeHtml(entry.rel)}</div>
					<div class="muted">${escapeHtml(describe(entry))}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</div>
				</div>
				<button class="ghost" data-act="open" data-key="${entry.key}" title="Ver o conteúdo (somente leitura)">👁 Ver</button>
				<button class="ghost ok" data-act="release" data-key="${entry.key}">✔ Liberar</button>
				<button class="ghost danger" data-act="discard" data-key="${entry.key}">🗑 Apagar</button>
			</div>`).join('')}
		</section>`).join('');
	return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px 28px; }
	h1 { font-size: 20px; margin: 0 0 4px; }
	.lead { color: var(--vscode-descriptionForeground); margin: 0 0 18px; max-width: 780px; line-height: 1.5; }
	.bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 0 14px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 14px; }
	.bar .count { margin-right: auto; font-weight: 600; }
	button { font: inherit; border-radius: 6px; padding: 6px 12px; cursor: pointer; border: 1px solid transparent; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	button:hover { background: var(--vscode-button-hoverBackground); }
	button:disabled { opacity: .45; cursor: default; }
	button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
	button.danger-solid { background: #C62828; color: #fff; }
	button.ghost { background: transparent; color: var(--vscode-foreground); border-color: var(--vscode-panel-border); padding: 4px 10px; }
	button.ghost:hover { background: var(--vscode-list-hoverBackground); }
	button.ghost.ok:hover { border-color: #2E7D32; }
	button.ghost.danger:hover { border-color: #C62828; color: #E57373; }
	.repo { border: 1px solid var(--vscode-panel-border); border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
	.repo header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 14px; background: var(--vscode-sideBar-background); }
	.repo header .muted { margin-right: auto; }
	.repo-name { font-weight: 600; }
	.item { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-top: 1px solid var(--vscode-panel-border); }
	.item:hover { background: var(--vscode-list-hoverBackground); }
	.info { flex: 1; min-width: 0; cursor: pointer; }
	.file { font-family: var(--vscode-editor-font-family); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
	.empty { text-align: center; padding: 60px 20px; color: var(--vscode-descriptionForeground); }
	.empty .big { font-size: 42px; }
	input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--vscode-button-background); }
</style></head><body>
<h1>🛡 Quarentena</h1>
<p class="lead">Arquivos que chegaram do GitHub sem a assinatura do DEV CODE (código que não foi digitado aqui). O aluno pode ver o conteúdo, mas precisa digitar de novo. <b>Liberar</b> pede a senha do administrador do computador (professor), uma vez só para todos os selecionados.</p>
${entries.length ? `
<div class="bar">
	<span class="count" id="count">${entries.length} arquivo(s) em quarentena</span>
	<label><input type="checkbox" id="all"> Selecionar todos</label>
	<button id="releaseSel" disabled>✔ Liberar selecionados</button>
	<button id="discardSel" class="secondary" disabled>🗑 Apagar selecionados</button>
	<button id="releaseAll">✔ Liberar todos</button>
	<button id="discardAll" class="danger-solid">🗑 Limpar quarentena</button>
</div>
${rows}` : '<div class="empty"><div class="big">✅</div><p>Não há arquivos na quarentena.</p></div>'}
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const picks = () => [...document.querySelectorAll('.pick')];
	const chosen = () => picks().filter(p => p.checked).map(p => p.dataset.key);
	function sync() {
		const n = chosen().length;
		for (const id of ['releaseSel', 'discardSel']) { const b = document.getElementById(id); if (b) { b.disabled = !n; } }
		const c = document.getElementById('count');
		if (c) { c.textContent = n ? n + ' selecionado(s) de ' + picks().length : picks().length + ' arquivo(s) em quarentena'; }
	}
	document.addEventListener('change', e => {
		if (e.target.id === 'all') { picks().forEach(p => { p.checked = e.target.checked; }); document.querySelectorAll('.all-repo').forEach(p => { p.checked = e.target.checked; }); }
		if (e.target.classList.contains('all-repo')) { e.target.closest('.repo').querySelectorAll('.pick').forEach(p => { p.checked = e.target.checked; }); }
		sync();
	});
	document.addEventListener('click', e => {
		const el = e.target.closest('[data-act], button[id]');
		if (!el) { return; }
		if (el.id === 'releaseSel') { vscode.postMessage({ type: 'release', keys: chosen() }); }
		else if (el.id === 'discardSel') { vscode.postMessage({ type: 'discard', keys: chosen() }); }
		else if (el.id === 'releaseAll') { vscode.postMessage({ type: 'release', keys: picks().map(p => p.dataset.key) }); }
		else if (el.id === 'discardAll') { vscode.postMessage({ type: 'discard', keys: picks().map(p => p.dataset.key), all: true }); }
		else if (el.dataset.act === 'trust') { vscode.postMessage({ type: 'trust', root: el.dataset.root }); }
		else if (el.dataset.act) { vscode.postMessage({ type: el.dataset.act, keys: [el.dataset.key] }); }
	});
</script></body></html>`;
}

function refreshPanel(context) {
	if (quarantinePanel) { quarantinePanel.webview.html = panelHtml(allEntries(context)); }
}

async function showQuarantine(context) {
	if (quarantinePanel) { quarantinePanel.reveal(); refreshPanel(context); return; }
	quarantinePanel = vscode.window.createWebviewPanel('devcode.quarantine', 'Quarentena', vscode.ViewColumn.Active, { enableScripts: true });
	quarantinePanel.iconPath = new vscode.ThemeIcon('shield');
	quarantinePanel.onDidDispose(() => { quarantinePanel = undefined; });
	quarantinePanel.webview.onDidReceiveMessage(async msg => {
		try {
			const byKey = new Map(allEntries(context).map(entry => [entry.key, entry]));
			const list = (msg.keys || []).map(key => byKey.get(key)).filter(Boolean);
			if (msg.type === 'open') { await openEntry(list[0]); return; }
			if (msg.type === 'release') {
				if (list.length) { await releaseEntries(context, list, false); }
			} else if (msg.type === 'trust') {
				await releaseEntries(context, [], true, msg.root);
			} else if (msg.type === 'discard') {
				if (!list.length) { return; }
				const ok = await vscode.window.showWarningMessage(
					msg.all ? `Apagar TODOS os ${list.length} arquivo(s) da quarentena?` : `Apagar ${list.length} arquivo(s) da quarentena?`,
					{ modal: true, detail: 'Eles saem da quarentena e não voltam para o projeto. Isto não pode ser desfeito.' }, 'Apagar');
				if (ok === 'Apagar') { discardEntries(context, list); }
			}
		} catch (err) {
			vscode.window.showErrorMessage(`DEV CODE: ${err.message || err}`);
		}
		refreshPanel(context);
	});
	refreshPanel(context);
}

async function releaseEntries(context, entries, trustSelected, rootHint) {
	if (!entries.length && !trustSelected) {
		vscode.window.showInformationMessage('Selecione arquivos ou a opção de confiar no repositório.');
		return false;
	}
	if (!(await requireAdmin('Liberar arquivos da quarentena'))) { return false; }
	let trustedRoot;
	if (trustSelected) {
		const active = vscode.window.activeTextEditor?.document.uri;
		trustedRoot = rootHint || (active ? vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath : undefined);
		trustedRoot ||= vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!trustedRoot || !(await authorship.trustRepo(trustedRoot))) {
			vscode.window.showErrorMessage('DEV CODE: não foi possível confiar neste repositório porque ele não tem um remote origin.');
			return false;
		}
	}

	let released = 0;
	for (const entry of entries) {
		const file = path.resolve(entry.root, ...entry.rel.split('/'));
		const relative = path.relative(path.resolve(entry.root), file);
		if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fileGuard.isGuarded(entry.root, file)) { continue; }
		const content = fileGuard.loadQuarantined(context, entry.root, entry.rel);
		if (!content) { continue; }
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
		fileGuard.acceptQuarantinedFile(context, entry.root, file, content);
		authorship.recordRelease(entry.root, entry.rel, content);
		fileGuard.removeQuarantined(context, entry.root, entry.rel);
		released++;
	}
	for (const root of new Set(entries.map(entry => entry.root).concat(trustedRoot ? [trustedRoot] : []))) {
		authorship.flushJournal(root);
	}
	refreshStatus();
	if (released || trustSelected) {
		vscode.window.showInformationMessage(`DEV CODE: ${released} arquivo(s) liberado(s) pelo professor${trustSelected ? '; os próximos pulls deste repositório serão confiáveis' : ''}.`);
	}
	return true;
}

async function releaseCommand(context) {
	const entries = allEntries(context);
	const items = entries.map(entry => ({ ...pickerItem(entry), buttons: undefined, quarantineKind: 'file' }));
	const active = vscode.window.activeTextEditor?.document.uri;
	const root = (active && vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (root) {
		items.unshift({
			label: '$(shield) Confiar neste repositório (libera todos os próximos pulls dele)',
			description: path.basename(root),
			quarantineKind: 'trust',
			root,
		});
	}
	if (!items.length) {
		vscode.window.showInformationMessage('Não há arquivos na quarentena nem repositório aberto.');
		return;
	}
	const selection = await vscode.window.showQuickPick(items, {
		title: 'Liberação do professor',
		placeHolder: 'Selecione arquivos e, se desejar, confie no repositório',
		canPickMany: true,
		ignoreFocusOut: true,
		matchOnDescription: true,
	});
	if (!selection) { return; }
	const selectedEntries = selection.filter(item => item.quarantineKind === 'file').map(item => item.entry);
	const trustSelected = selection.some(item => item.quarantineKind === 'trust');
	await releaseEntries(context, selectedEntries, trustSelected);
}

function discardEntries(context, entries) {
	let discarded = 0;
	for (const entry of entries) {
		if (fileGuard.removeQuarantined(context, entry.root, entry.rel)) { discarded++; }
	}
	refreshStatus();
	if (discarded) { vscode.window.setStatusBarMessage(`DEV CODE: ${discarded} arquivo(s) descartado(s) da quarentena.`, 4000); }
}

async function discardCommand(context) {
	const entries = allEntries(context);
	if (!entries.length) {
		vscode.window.showInformationMessage('Não há arquivos na quarentena.');
		return;
	}
	const selection = await vscode.window.showQuickPick(entries.map(entry => ({ ...pickerItem(entry), buttons: undefined })), {
		title: 'Descartar arquivos da quarentena',
		placeHolder: 'Selecione um ou mais arquivos para descartar',
		canPickMany: true,
		ignoreFocusOut: true,
		matchOnDescription: true,
	});
	if (selection) { discardEntries(context, selection.map(item => item.entry)); }
}

function contentProvider(context) {
	return {
		provideTextDocumentContent(uri) {
			const key = new URLSearchParams(uri.query).get('key');
			const entry = key && findEntry(context, key);
			if (!entry) { return 'Este arquivo não está mais na quarentena.'; }
			const content = fileGuard.loadQuarantined(context, entry.root, entry.rel);
			return content ? content.toString('utf8') : 'O conteúdo deste arquivo não está disponível.';
		},
	};
}

let statusItem;
let activeContext;

function refreshStatus() {
	if (activeContext) { refreshPanel(activeContext); }
	if (!statusItem || !activeContext) { return; }
	const count = allEntries(activeContext).length;
	if (!count) { statusItem.hide(); return; }
	statusItem.text = `$(shield) Quarentena: ${count}`;
	statusItem.tooltip = 'Ver arquivos em quarentena';
	statusItem.show();
}

function registerQuarantine(context) {
	activeContext = context;
	statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48);
	statusItem.command = 'devcode.quarantine.show';
	context.subscriptions.push(
		statusItem,
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, contentProvider(context)),
		vscode.commands.registerCommand('devcode.quarantine.show', () => showQuarantine(context).catch(err => vscode.window.showErrorMessage(`DEV CODE: ${err.message || err}`))),
		vscode.commands.registerCommand('devcode.quarantine.release', () => releaseCommand(context).catch(err => vscode.window.showErrorMessage(`DEV CODE: ${err.message || err}`))),
		vscode.commands.registerCommand('devcode.quarantine.discard', () => discardCommand(context).catch(err => vscode.window.showErrorMessage(`DEV CODE: ${err.message || err}`))),
		vscode.commands.registerCommand('devcode.quarantine.refresh', refreshStatus),
	);
	refreshStatus();
}

module.exports = { registerQuarantine, allEntries, showQuarantine, releaseEntries, discardEntries, refreshStatus };
