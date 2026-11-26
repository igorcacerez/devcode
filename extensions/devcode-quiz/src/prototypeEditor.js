/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Modo Protótipo (editor visual estilo Figma, simplificado e sem IA).
 *  Arquivos *.devproto (JSON) abertos num editor customizado: frames Mobile/Desktop, formas,
 *  texto, imagens do projeto, camadas e estilos. O documento é um TextDocument comum, então
 *  desfazer/refazer (Ctrl+Z / Ctrl+Y), salvar e o vigia de arquivos funcionam normalmente.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { acceptOwnFile } = require('./fileGuard');

const VIEW_TYPE = 'devcode.prototype';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const IMAGE_FILTERS = { 'Imagens': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] };
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
let lastPickDir;

function emptyPrototype() {
	return {
		version: 1,
		nodes: [{
			id: 'f1', type: 'frame', name: 'Tela inicial (Mobile)', preset: 'mobile',
			x: 0, y: 0, w: 390, h: 844, fill: '#FFFFFF', radius: 0, opacity: 1, visible: true, locked: false, clip: true, children: [],
		}],
	};
}

function isInsideDir(dir, file) {
	const rel = path.relative(dir, file);
	return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Nome de arquivo seguro no Windows (sem caracteres proibidos nem nomes reservados). */
function safeBaseName(name) {
	let base = path.basename(name, path.extname(name)).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/^[\s.-]+|[\s.]+$/g, '');
	if (!base) { base = 'imagem'; }
	if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) { base += '_'; }
	return base;
}

/**
 * Grava uma imagem na pasta `imagens/` do projeto e devolve o caminho final.
 *  - arquivo já dentro de imagens/ → usa o próprio arquivo (não duplica);
 *  - nome livre → grava com o mesmo nome;
 *  - nome em uso com o MESMO conteúdo → reaproveita;
 *  - nome em uso com outro conteúdo → foto-1.png, foto-2.png…
 */
function storeImage(dir, name, buf, sourcePath) {
	if (sourcePath && isInsideDir(dir, sourcePath)) { return sourcePath; }
	fs.mkdirSync(dir, { recursive: true });
	const ext = path.extname(name).toLowerCase();
	const base = safeBaseName(name);
	for (let i = 0; ; i++) {
		const file = path.join(dir, `${base}${i ? `-${i}` : ''}${ext}`);
		if (!fs.existsSync(file)) {
			acceptOwnFile(file, buf); // o vigia de arquivos precisa aceitar o que o próprio DEV CODE grava
			fs.writeFileSync(file, buf);
			return file;
		}
		try { if (fs.statSync(file).size === buf.length && fs.readFileSync(file).equals(buf)) { return file; } } catch { /* tenta o próximo nome */ }
	}
}

function defaultPickDir() {
	if (lastPickDir) { return lastPickDir; }
	const pics = path.join(os.homedir(), 'Pictures');
	return vscode.Uri.file(fs.existsSync(pics) ? pics : os.homedir());
}

class PrototypeEditorProvider {
	constructor(context) { this.context = context; }

	async resolveCustomTextEditor(document, panel) {
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		const docDir = path.dirname(document.uri.fsPath);
		const imagesDir = path.join(folder ? folder.uri.fsPath : docDir, 'imagens');
		const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'media')];
		roots.push(folder ? folder.uri : vscode.Uri.file(docDir));
		panel.webview.options = { enableScripts: true, localResourceRoots: roots };
		panel.webview.html = this.html(panel.webview);

		/** Copia as imagens para imagens/ e devolve { src (relativo ao .devproto), uri (do webview) }. */
		const importImages = sources => {
			const items = [], skipped = [], tooBig = [];
			for (const s of sources) {
				const name = s.name || path.basename(s.path || '');
				if (!IMAGE_EXT.test(name)) { skipped.push(name); continue; }
				try {
					const buf = s.data !== undefined ? Buffer.from(s.data, 'base64') : fs.readFileSync(s.path);
					if (buf.length > MAX_IMAGE_BYTES) { tooBig.push(name); continue; }
					const file = storeImage(imagesDir, name, buf, s.path);
					items.push({ src: path.relative(docDir, file).split(path.sep).join('/'), uri: panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() });
				} catch (err) {
					vscode.window.showErrorMessage(`Protótipo: não foi possível copiar "${name}" para a pasta imagens: ${err.message}`);
				}
			}
			if (skipped.length) { vscode.window.showWarningMessage(`Protótipo: só imagens PNG, JPG, GIF, WEBP ou SVG podem ser inseridas (ignorado: ${skipped.join(', ')}).`); }
			if (tooBig.length) { vscode.window.showWarningMessage(`Protótipo: imagem grande demais (máx. 25 MB): ${tooBig.join(', ')}.`); }
			return items;
		};

		let applyingOwnEdit = false;
		const send = () => {
			let model;
			try { model = document.getText().trim() ? JSON.parse(document.getText()) : emptyPrototype(); } catch { model = null; }
			panel.webview.postMessage({ type: 'load', model, error: model ? undefined : 'O arquivo .devproto está corrompido (JSON inválido).' });
		};

		const sub = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString() && !applyingOwnEdit && e.contentChanges.length) { send(); }
		});
		panel.onDidDispose(() => sub.dispose());

		panel.webview.onDidReceiveMessage(async msg => {
			switch (msg.type) {
				case 'ready': send(); break;
				case 'edit': {
					const text = JSON.stringify(msg.model, null, '\t');
					if (text === document.getText()) { break; }
					const edit = new vscode.WorkspaceEdit();
					edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
					applyingOwnEdit = true;
					await vscode.workspace.applyEdit(edit);
					applyingOwnEdit = false;
					break;
				}
				case 'pickImage': {
					// qualquer pasta do computador: a imagem é copiada para imagens/ do projeto
					const files = await vscode.window.showOpenDialog({
						title: msg.replace ? 'Trocar imagem' : 'Inserir imagem', openLabel: msg.replace ? 'Trocar' : 'Inserir',
						defaultUri: defaultPickDir(), canSelectMany: !msg.replace, canSelectFolders: false, filters: IMAGE_FILTERS,
					});
					if (!files?.length) { break; }
					lastPickDir = vscode.Uri.file(path.dirname(files[0].fsPath));
					const items = importImages(files.map(f => ({ path: f.fsPath })));
					if (items.length) { panel.webview.postMessage({ type: 'imagesAdded', items, replace: msg.replace, fillId: msg.fillId }); }
					break;
				}
				case 'saveImages': {
					// arrastar e soltar: arquivos lidos no webview (base64) ou URIs (text/uri-list)
					const uris = (msg.uris || []).map(u => { try { const uri = vscode.Uri.parse(u); return uri.scheme === 'file' ? { path: uri.fsPath } : null; } catch { return null; } }).filter(Boolean);
					const items = importImages([...(msg.files || []).map(f => ({ name: String(f.name || ''), data: String(f.data || '') })), ...uris]);
					if (items.length) { panel.webview.postMessage({ type: 'imagesAdded', items, at: msg.at }); }
					break;
				}
				case 'resolveImages': {
					const map = {};
					for (const rel of msg.srcs) {
						const abs = path.resolve(path.dirname(document.uri.fsPath), rel);
						if (fs.existsSync(abs)) { map[rel] = panel.webview.asWebviewUri(vscode.Uri.file(abs)).toString(); }
					}
					panel.webview.postMessage({ type: 'images', map });
					break;
				}
				case 'exportPng': {
					const dir = path.join(path.dirname(document.uri.fsPath), 'exportacoes');
					fs.mkdirSync(dir, { recursive: true });
					const safe = String(msg.name || 'frame').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'frame';
					const file = path.join(dir, `${safe}.png`);
					fs.writeFileSync(file, Buffer.from(msg.data.replace(/^data:image\/png;base64,/, ''), 'base64'));
					const open = await vscode.window.showInformationMessage(`Imagem exportada: exportacoes/${safe}.png`, 'Abrir');
					if (open) { vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file)); }
					break;
				}
				case 'error': vscode.window.showErrorMessage(`Protótipo: ${msg.message}`); break;
			}
		});
	}

	html(webview) {
		const media = p => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'proto', p));
		const nonce = Math.random().toString(36).slice(2);
		return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} https://fonts.googleapis.com https://fonts.gstatic.com; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} https://fonts.gstatic.com data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('proto.css')}">
</head><body>
<div id="app"></div>
<script nonce="${nonce}">window.__DEVCODE_FONTS_URL = ${JSON.stringify(String(media('google-fonts.json')))};</script>
<script nonce="${nonce}" src="${media('styles.js')}"></script>
<script nonce="${nonce}" src="${media('proto.js')}"></script>
</body></html>`;
	}
}

function registerPrototypeEditor(context) {
	context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, new PrototypeEditorProvider(context), {
		webviewOptions: { retainContextWhenHidden: true },
		supportsMultipleEditorsPerDocument: false,
	}));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.prototype.newScreen', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) { return; }
		const name = await vscode.window.showInputBox({ title: 'Nova tela do protótipo', placeHolder: 'login', ignoreFocusOut: true, validateInput: v => /^[\w\- ]+$/.test(v.trim()) ? undefined : 'Use letras, números, espaço, - ou _' });
		if (!name) { return; }
		const file = vscode.Uri.joinPath(folder.uri, `${name.trim()}.devproto`);
		const model = emptyPrototype();
		model.nodes[0].name = name.trim();
		await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(model, null, '\t')));
		acceptOwnFile(file.fsPath);
		await vscode.commands.executeCommand('vscode.openWith', file, VIEW_TYPE);
	}));
	// Ctrl+G / Ctrl+Shift+G são tratados dentro do webview (agrupar/desagrupar). Estes comandos vazios só
	// impedem que a mesma tecla, repassada ao workbench, abra "Ir para a linha" / "Controle do Código-Fonte".
	context.subscriptions.push(vscode.commands.registerCommand('devcode.prototype.groupKey', () => { /* tratado no webview */ }));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.prototype.ungroupKey', () => { /* tratado no webview */ }));
}

module.exports = { registerPrototypeEditor, emptyPrototype, VIEW_TYPE };
