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

async function showQuarantine(context) {
	const entries = allEntries(context);
	if (!entries.length) {
		vscode.window.showInformationMessage('Não há arquivos na quarentena.');
		return;
	}
	const picker = vscode.window.createQuickPick();
	picker.title = 'Arquivos em quarentena';
	picker.placeholder = 'Selecione um arquivo para abrir (somente leitura)';
	picker.ignoreFocusOut = true;
	picker.matchOnDescription = true;
	picker.items = entries.map(pickerItem);
	picker.onDidAccept(() => {
		const item = picker.selectedItems[0];
		picker.hide();
		if (item) { openEntry(item.entry).catch(err => vscode.window.showErrorMessage(`DEV CODE: ${err.message || err}`)); }
	});
	picker.onDidTriggerItemButton(async event => {
		const entry = event.item.entry;
		picker.hide();
		try {
			if (event.button === OPEN_BUTTON) {
				await openEntry(entry);
			} else if (event.button === RELEASE_BUTTON) {
				await releaseEntries(context, [entry], false);
			} else if (event.button === DISCARD_BUTTON) {
				discardEntries(context, [entry]);
			}
		} catch (err) {
			vscode.window.showErrorMessage(`DEV CODE: ${err.message || err}`);
		}
	});
	picker.onDidHide(() => picker.dispose());
	picker.show();
}

async function releaseEntries(context, entries, trustSelected) {
	if (!entries.length && !trustSelected) {
		vscode.window.showInformationMessage('Selecione arquivos ou a opção de confiar no repositório.');
		return false;
	}
	if (!(await requireAdmin('Liberar arquivos da quarentena'))) { return false; }
	let trustedRoot;
	if (trustSelected) {
		const active = vscode.window.activeTextEditor?.document.uri;
		trustedRoot = active ? vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath : undefined;
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
