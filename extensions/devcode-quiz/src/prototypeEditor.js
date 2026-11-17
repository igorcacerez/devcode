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

const VIEW_TYPE = 'devcode.prototype';

function emptyPrototype() {
	return {
		version: 1,
		nodes: [{
			id: 'f1', type: 'frame', name: 'Tela inicial (Mobile)', preset: 'mobile',
			x: 0, y: 0, w: 390, h: 844, fill: '#FFFFFF', radius: 0, opacity: 1, visible: true, locked: false, clip: true, children: [],
		}],
	};
}

class PrototypeEditorProvider {
	constructor(context) { this.context = context; }

	async resolveCustomTextEditor(document, panel) {
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'media')];
		if (folder) { roots.push(folder.uri); }
		panel.webview.options = { enableScripts: true, localResourceRoots: roots };
		panel.webview.html = this.html(panel.webview);

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
					const base = folder?.uri ?? vscode.Uri.file(path.dirname(document.uri.fsPath));
					const files = await vscode.window.showOpenDialog({
						title: 'Escolha uma imagem do projeto', defaultUri: base, canSelectMany: false,
						filters: { 'Imagens': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
					});
					if (!files?.[0]) { break; }
					if (folder && !files[0].fsPath.toLowerCase().startsWith(folder.uri.fsPath.toLowerCase())) {
						vscode.window.showWarningMessage('DEV CODE: coloque a imagem dentro da pasta do projeto (ex.: pasta "imagens") e escolha de lá.');
						break;
					}
					const rel = path.relative(path.dirname(document.uri.fsPath), files[0].fsPath).split(path.sep).join('/');
					panel.webview.postMessage({ type: 'imagePicked', src: rel });
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource}; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('proto.css')}">
</head><body>
<div id="app"></div>
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
		require('./fileGuard').acceptOwnFile(file.fsPath);
		await vscode.commands.executeCommand('vscode.openWith', file, VIEW_TYPE);
	}));
}

module.exports = { registerPrototypeEditor, emptyPrototype, VIEW_TYPE };
