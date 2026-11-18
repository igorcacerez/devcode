/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Editor visual de testes de sites (*.devtest), sem código para o aluno.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createHtmlReport, launchBrowser, runTests } = require('./testRunner');

const VIEW_TYPE = 'devcode.test';
const RECORDABLE_COMMANDS = new Set(['click', 'type', 'select', 'check', 'uncheck', 'pressKey', 'assertText', 'assertVisible', 'assertTitle']);

/** Modelo inicial de um projeto de testes. */
function emptyTestProject() {
	return {
		version: 1,
		baseUrl: '',
		suites: [
			{ id: 'suite-login', name: 'Login', cases: [{ id: 'case-login', name: 'Login básico', steps: [] }] },
			{ id: 'suite-cadastro', name: 'Cadastro', cases: [{ id: 'case-cadastro', name: 'Cadastro básico', steps: [] }] },
		],
		lastResults: null,
	};
}

function createId(prefix) {
	return `${prefix}-${crypto.randomUUID()}`;
}

function parseModel(document) {
	try {
		const model = JSON.parse(document.getText());
		if (model && Array.isArray(model.suites)) {
			model.version = 1;
			model.baseUrl = typeof model.baseUrl === 'string' ? model.baseUrl : '';
			return model;
		}
	} catch { /* O editor mostra uma mensagem amigável no lugar do modelo inválido. */ }
	return undefined;
}

function normalizeUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) { throw new Error('Informe a URL base do site antes de gravar ou executar.'); }
	const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
	if (!['http:', 'https:'].includes(url.protocol)) { throw new Error('A URL base precisa começar com http:// ou https://.'); }
	return url.toString();
}

/** Script que grava interações e oferece uma pequena barra de asserções na página visitada. */
const RECORDER_SCRIPT = String.raw`(() => {
	if (window.__devcodeRecorderInstalled) { return; }
	window.__devcodeRecorderInstalled = true;
	let inputTimer;
	let pendingInput;
	let assertionMode = '';
	let previousOutline;
	let previousOutlineElement;
	const toolbarId = '__devcode_test_toolbar';
	const send = step => {
		if (typeof window.__devcodeRecord === 'function') {
			window.__devcodeRecord(step).catch(() => {});
		}
	};
	const locator = element => {
		if (!element || element.nodeType !== 1) { return 'css=body'; }
		if (element.id) { return 'id=' + element.id; }
		const testId = element.getAttribute('data-testid');
		if (testId) { return 'css=[data-testid=' + JSON.stringify(testId) + ']'; }
		const name = element.getAttribute('name');
		if (name) { return 'name=' + name; }
		if (/^(BUTTON|A)$/.test(element.tagName)) {
			const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
			if (text && text.length <= 80) {
				const matches = Array.from(document.querySelectorAll('button,a')).filter(item => (item.innerText || item.textContent || '').trim().replace(/\s+/g, ' ') === text);
				if (matches.length === 1) { return 'text=' + text; }
			}
		}
		const path = [];
		let current = element;
		while (current && current !== document.documentElement && path.length < 4) {
			let part = current.tagName.toLowerCase();
			if (current.classList.length) {
				part += '.' + Array.from(current.classList).slice(0, 2).map(value => value.replace(/[^\w-]/g, '\\$&')).join('.');
			}
			if (current.parentElement) {
				const siblings = Array.from(current.parentElement.children).filter(item => item.tagName === current.tagName);
				if (siblings.length > 1) { part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'; }
			}
			path.unshift(part);
			const selector = path.join(' > ');
			try { if (document.querySelectorAll(selector).length === 1) { return 'css=' + selector; } } catch {}
			current = current.parentElement;
		}
		return 'css=' + path.join(' > ');
	};
	const interactive = element => element?.closest?.('button,a,[role="button"],input[type="submit"],input[type="button"]') || element;
	const addToolbar = () => {
		if (!document.body || document.getElementById(toolbarId)) { return; }
		const bar = document.createElement('div');
		bar.id = toolbarId;
		bar.innerHTML = '<b>DEV CODE · Gravando</b><button type="button" data-assert="assertText">Verificar texto</button><button type="button" data-assert="assertVisible">Verificar visível</button><button type="button" data-assert="assertTitle">Verificar título</button><small>Clique em uma opção e depois no elemento</small>';
		bar.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;display:flex;align-items:center;gap:6px;padding:8px;background:#fff7f6;color:#56252b;border:1px solid #df9b9f;border-radius:9px;box-shadow:0 3px 18px #42101855;font:12px system-ui,sans-serif';
		bar.querySelectorAll('button').forEach(button => {
			button.style.cssText = 'border:1px solid #d99095;border-radius:6px;background:#fff;color:#712d35;padding:5px 8px;cursor:pointer;font:inherit';
			button.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				const command = button.dataset.assert;
				if (command === 'assertTitle') {
					send({ command, target: '', value: document.title });
					return;
				}
				assertionMode = command;
				bar.querySelector('small').textContent = 'Agora clique no elemento que deseja verificar';
			});
		});
		document.body.appendChild(bar);
	};
	if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', addToolbar, { once: true }); } else { addToolbar(); }
	window.__devcodePickElement = () => { assertionMode = '__pick'; };
	document.addEventListener('mouseover', event => {
		if (!assertionMode || assertionMode === '__pick' || event.target.closest?.('#' + toolbarId)) { return; }
		const element = event.target;
		if (previousOutlineElement && previousOutlineElement !== element) { previousOutlineElement.style.outline = previousOutline; }
		previousOutlineElement = element;
		previousOutline = element.style.outline;
		element.style.outline = '2px solid #d64550';
	}, true);
	document.addEventListener('click', event => {
		if (event.target.closest?.('#' + toolbarId)) { return; }
		const element = interactive(event.target);
		if (assertionMode) {
			event.preventDefault();
			event.stopImmediatePropagation();
			const command = assertionMode;
			assertionMode = '';
			if (previousOutlineElement) { previousOutlineElement.style.outline = previousOutline; }
			const target = locator(element);
			if (command === '__pick') { window.__devcodeRecord({ type: 'picked', target }).catch(() => {}); }
			else {
				const value = command === 'assertText' ? (element.innerText || element.textContent || '').trim() : '';
				send({ command, target, value });
			}
			const small = document.querySelector('#' + toolbarId + ' small');
			if (small) { small.textContent = 'Clique em uma opção e depois no elemento'; }
			return;
		}
		if (element.matches?.('input[type="checkbox"],input[type="radio"],select')) { return; }
		send({ command: 'click', target: locator(element), value: '' });
	}, true);
	document.addEventListener('change', event => {
		const element = event.target;
		if (element.closest?.('#' + toolbarId)) { return; }
		if (element.matches?.('select')) { send({ command: 'select', target: locator(element), value: element.value }); }
		else if (element.matches?.('input[type="checkbox"],input[type="radio"]')) { send({ command: element.checked ? 'check' : 'uncheck', target: locator(element), value: '' }); }
	}, true);
	const flushInput = () => {
		if (!pendingInput) { return; }
		send(pendingInput);
		pendingInput = undefined;
	};
	document.addEventListener('input', event => {
		const element = event.target;
		if (element.closest?.('#' + toolbarId) || element.matches?.('input[type="checkbox"],input[type="radio"],input[type="password"],input[type="hidden"],input[type="file"],select')) { return; }
		pendingInput = { command: 'type', target: locator(element), value: element.isContentEditable ? element.innerText : element.value };
		clearTimeout(inputTimer);
		inputTimer = setTimeout(flushInput, 450);
	}, true);
	document.addEventListener('focusout', event => {
		if (pendingInput && event.target === document.activeElement) { flushInput(); }
	}, true);
	document.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.target.closest?.('#' + toolbarId)) {
			send({ command: 'pressKey', target: locator(event.target), value: 'Enter' });
		}
	}, true);
})();`;

class TestEditorProvider {
	constructor(context) { this.context = context; }

	async resolveCustomTextEditor(document, panel) {
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};
		panel.webview.html = this.html(panel.webview);
		let applyingOwnEdit = false;
		let recording;
		let pendingPickStepId;
		let modelQueue = Promise.resolve();
		let disposed = false;
		const readModel = () => parseModel(document) || emptyTestProject();
		const post = message => { if (!disposed) { panel.webview.postMessage(message); } };
		const sendModel = () => {
			const model = parseModel(document);
			post({ type: 'load', model, error: model ? undefined : 'O arquivo .devtest está inválido. Corrija o JSON no editor de texto.' });
		};
		const writeModel = async model => {
			const text = JSON.stringify(model, null, '\t');
			if (text === document.getText()) { return; }
			const edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
			applyingOwnEdit = true;
			try {
				const applied = await vscode.workspace.applyEdit(edit);
				if (!applied) { throw new Error('Não foi possível salvar as alterações no arquivo .devtest.'); }
			} finally { applyingOwnEdit = false; }
		};
		const enqueueModelUpdate = mutation => {
			const operation = modelQueue.then(async () => {
				const model = readModel();
				const value = mutation(model);
				await writeModel(model);
				return value;
			});
			modelQueue = operation.then(() => undefined, () => undefined);
			return operation;
		};
		const replaceModel = model => {
			const operation = modelQueue.then(() => writeModel(model));
			modelQueue = operation.then(() => undefined, () => undefined);
			return operation;
		};
		const changeSub = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.uri.toString() === document.uri.toString() && !applyingOwnEdit && event.contentChanges.length) { sendModel(); }
		});
		panel.onDidDispose(() => {
			disposed = true;
			changeSub.dispose();
			if (recording) { recording.browser.close().catch(() => {}); recording = undefined; }
		});

		const stopRecording = async () => {
			if (!recording) { return; }
			const active = recording;
			recording = undefined;
			await active.browser.close().catch(() => {});
			post({ type: 'recording', active: false });
			post({ type: 'status', message: 'Gravação parada.', kind: 'ok' });
		};

		const appendStep = async (suiteId, caseId, step) => {
			let savedStep;
			let merged = false;
			const added = await enqueueModelUpdate(model => {
				const testCase = model.suites.find(suite => suite.id === suiteId)?.cases?.find(item => item.id === caseId);
				if (!testCase) { return false; }
				testCase.steps = Array.isArray(testCase.steps) ? testCase.steps : [];
				const previous = testCase.steps.at(-1);
				if (step.command === 'type' && previous?.command === 'type' && previous.target === step.target) {
					previous.value = step.value || '';
					savedStep = previous;
					merged = true;
				} else {
					savedStep = { id: createId('step'), command: step.command, target: step.target || '', value: step.value || '' };
					testCase.steps.push(savedStep);
				}
				return true;
			});
			if (!added) { return; }
			post({ type: 'recordedStep', suiteId, caseId, step: savedStep, merge: merged });
		};

		const startRecording = async () => {
			if (recording) { await stopRecording(); }
			await modelQueue;
			const model = readModel();
			let baseUrl;
			try { baseUrl = normalizeUrl(model.baseUrl); } catch (error) { post({ type: 'status', message: error.message, kind: 'error' }); return; }
			const suiteId = panelSelection?.suiteId;
			const caseId = panelSelection?.caseId;
			if (!suiteId || !caseId) { post({ type: 'status', message: 'Selecione um caso de teste para gravar.', kind: 'error' }); return; }
			let session;
			try {
				const browser = await launchBrowser();
				const context = await browser.newContext();
				const page = await context.newPage();
				session = { browser, context, page, suiteId, caseId };
				recording = session;
				await page.exposeBinding('__devcodeRecord', async (_source, step) => {
					if (recording !== session) { return; }
					if (!step || typeof step !== 'object') { return; }
					if (step.type === 'picked') {
						if (typeof step.target === 'string' && step.target.length <= 2048) { post({ type: 'pickedElement', target: step.target, stepId: pendingPickStepId }); }
						pendingPickStepId = undefined;
						return;
					}
					if (!RECORDABLE_COMMANDS.has(step.command) || typeof step.target !== 'string' || typeof step.value !== 'string' || step.target.length > 2048 || step.value.length > 10000) { return; }
					await appendStep(suiteId, caseId, step);
				});
				await page.addInitScript(RECORDER_SCRIPT);
				await appendStep(suiteId, caseId, { command: 'open', target: baseUrl });
				post({ type: 'recording', active: true });
				post({ type: 'status', message: 'Abrindo o navegador para gravar…', kind: 'info' });
				await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
				if (recording === session) { post({ type: 'status', message: 'Gravando no navegador. Senhas são ignoradas; use a barra na página para incluir verificações.', kind: 'ok' }); }
			} catch (error) {
				if (!session || recording === session) {
					if (session) { await session.browser.close().catch(() => {}); }
					recording = undefined;
					post({ type: 'recording', active: false });
					post({ type: 'status', message: `Não foi possível iniciar a gravação: ${error.message}`, kind: 'error' });
				}
			}
		};

		const writeReport = async results => {
			const reportDirectory = path.join(path.dirname(document.uri.fsPath), 'relatorios');
			fs.mkdirSync(reportDirectory, { recursive: true });
			const now = new Date();
			const pad = number => String(number).padStart(2, '0');
			const fileName = `relatorio-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.html`;
			const reportPath = path.join(reportDirectory, fileName);
			const html = createHtmlReport(results);
			require('./fileGuard').acceptOwnFile(reportPath, Buffer.from(html, 'utf8')); // o vigia aceita o relatório gravado pela própria IDE
			fs.writeFileSync(reportPath, html, 'utf8');
			try { await vscode.env.openExternal(vscode.Uri.file(reportPath)); } catch { /* O arquivo permanece salvo para abertura manual. */ }
			return path.relative(path.dirname(document.uri.fsPath), reportPath).split(path.sep).join('/');
		};

		const execute = async (suiteIds, caseIds) => {
			if (recording) { post({ type: 'status', message: 'Pare a gravação antes de executar os testes.', kind: 'error' }); return; }
			await modelQueue;
			const model = readModel();
			if (model.baseUrl) {
				try { model.baseUrl = normalizeUrl(model.baseUrl); } catch (error) { post({ type: 'status', message: error.message, kind: 'error' }); return; }
			}
			post({ type: 'running', active: true });
			post({ type: 'status', message: 'Iniciando os testes no navegador…', kind: 'info' });
			try {
				const results = await runTests(model, {
					suiteIds,
					caseIds,
					onStep: ({ suite, testCase, step }) => post({ type: 'stepResult', suiteId: suite.id, caseId: testCase.id, result: step }),
					onCaseStart: ({ suite, testCase }) => post({ type: 'caseRunning', suiteId: suite.id, caseId: testCase.id }),
					onCaseResult: ({ suite, testCase, result }) => post({ type: 'caseResult', suiteId: suite.id, caseId: testCase.id, result }),
				});
				await enqueueModelUpdate(updated => { updated.lastResults = results; });
				const report = await writeReport(results);
				post({ type: 'runComplete', results, report });
				post({ type: 'status', message: `Execução concluída: ${results.passed} passou, ${results.failed} falhou. Relatório: ${report}`, kind: results.failed ? 'error' : 'ok' });
			} catch (error) {
				post({ type: 'status', message: error.message, kind: 'error' });
			} finally {
				post({ type: 'running', active: false });
			}
		};

		let panelSelection;
		panel.webview.onDidReceiveMessage(async message => {
			try {
				switch (message.type) {
					case 'ready': sendModel(); break;
					case 'selection': panelSelection = { suiteId: message.suiteId, caseId: message.caseId }; break;
					case 'edit': if (message.model && Array.isArray(message.model.suites)) { await replaceModel(message.model); } break;
					case 'record': await startRecording(); break;
					case 'stopRecording': await stopRecording(); break;
					case 'pickElement':
						if (recording) { pendingPickStepId = message.stepId; await recording.page.evaluate(() => window.__devcodePickElement?.()); }
						else { post({ type: 'status', message: 'Inicie a gravação antes de escolher um elemento.', kind: 'error' }); }
						break;
					case 'runCase': if (panelSelection) { await execute(undefined, [panelSelection.caseId]); } break;
					case 'runSuite': if (panelSelection?.suiteId) { await execute([panelSelection.suiteId]); } break;
					case 'runAll': await execute(); break;
					case 'openReport':
						if (message.report) { await vscode.env.openExternal(vscode.Uri.file(path.resolve(path.dirname(document.uri.fsPath), message.report))); }
						break;
				}
			} catch (error) {
				post({ type: 'status', message: `Erro no editor de testes: ${error.message}`, kind: 'error' });
			}
		});
	}

	html(webview) {
		const media = file => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'test', file));
		const nonce = crypto.randomBytes(16).toString('base64');
		return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${media('test.css')}">
</head><body><div id="app"></div><script nonce="${nonce}" src="${media('test.js')}"></script></body></html>`;
	}
}

function registerTestEditor(context) {
	context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, new TestEditorProvider(context), {
		webviewOptions: { retainContextWhenHidden: true },
		supportsMultipleEditorsPerDocument: false,
	}));
}

module.exports = { RECORDER_SCRIPT, TestEditorProvider, VIEW_TYPE, emptyTestProject, normalizeUrl, registerTestEditor };
