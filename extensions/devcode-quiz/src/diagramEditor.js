/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Editor de diagramas (*.devdiagram), estilo Microsoft Visio: fluxogramas, diagramas
 *  de classes (UML), modelagem de banco (DER), casos de uso. Arrastar formas e ligar com setas.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { acceptOwnFile } = require('./fileGuard');

const VIEW_TYPE = 'devcode.diagram';

/** Modelo inicial: uma página vazia. */
function emptyDiagram(pageName = 'Página 1') {
	return { version: 1, pages: [{ id: 'p1', name: pageName, shapes: [], links: [] }] };
}

class DiagramEditorProvider {
	constructor(context) { this.context = context; }

	async resolveCustomTextEditor(document, panel) {
		panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
		panel.webview.html = this.html(panel.webview);

		let applyingOwnEdit = false;
		const send = () => {
			let model;
			try { model = document.getText().trim() ? JSON.parse(document.getText()) : emptyDiagram(); } catch { model = null; }
			if (model && !Array.isArray(model.pages)) { model = null; }
			panel.webview.postMessage({ type: 'load', model, name: path.basename(document.uri.fsPath, '.devdiagram'), error: model ? undefined : 'O arquivo .devdiagram está corrompido (JSON inválido).' });
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
					try { await vscode.workspace.applyEdit(edit); } finally { applyingOwnEdit = false; }
					require('./autoSave').scheduleAutoSave(document);
					break;
				}
				case 'export': {
					const dir = path.join(path.dirname(document.uri.fsPath), 'exportacoes');
					fs.mkdirSync(dir, { recursive: true });
					const safe = String(msg.name || 'diagrama').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'diagrama';
					const file = path.join(dir, `${safe}.${msg.format === 'svg' ? 'svg' : 'png'}`);
					const buf = msg.format === 'svg' ? Buffer.from(msg.data, 'utf8') : Buffer.from(String(msg.data).replace(/^data:image\/png;base64,/, ''), 'base64');
					fs.writeFileSync(file, buf);
					acceptOwnFile(file, buf);
					const open = await vscode.window.showInformationMessage(`Diagrama exportado: exportacoes/${path.basename(file)}`, 'Abrir');
					if (open) { vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file)); }
					break;
				}
				case 'confirm': {
					const ok = await vscode.window.showWarningMessage(msg.message, { modal: true }, msg.button || 'OK');
					panel.webview.postMessage({ type: 'confirmed', id: msg.id, ok: ok === (msg.button || 'OK') });
					break;
				}
				case 'error': vscode.window.showErrorMessage(`Diagrama: ${msg.message}`); break;
			}
		});
	}

	html(webview) {
		const media = p => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'diagram', p));
		const nonce = Math.random().toString(36).slice(2);
		return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('diagram.css')}">
</head><body>
<div id="app"></div>
<script nonce="${nonce}" src="${media('diagram.js')}"></script>
</body></html>`;
	}
}

function registerDiagramEditor(context) {
	context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, new DiagramEditorProvider(context), {
		webviewOptions: { retainContextWhenHidden: true },
		supportsMultipleEditorsPerDocument: false,
	}));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.diagram.new', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) { return; }
		const name = await vscode.window.showInputBox({ title: 'Novo diagrama', placeHolder: 'fluxo-de-login', ignoreFocusOut: true, validateInput: v => /^[\wÀ-ú\- ]+$/.test(v.trim()) ? undefined : 'Use letras, números, espaço, - ou _' });
		if (!name) { return; }
		const file = vscode.Uri.joinPath(folder.uri, `${name.trim()}.devdiagram`);
		const buf = Buffer.from(JSON.stringify(emptyDiagram(), null, '\t'));
		await vscode.workspace.fs.writeFile(file, buf);
		acceptOwnFile(file.fsPath, buf);
		await vscode.commands.executeCommand('vscode.openWith', file, VIEW_TYPE);
	}));
}

module.exports = { registerDiagramEditor, emptyDiagram, VIEW_TYPE };
