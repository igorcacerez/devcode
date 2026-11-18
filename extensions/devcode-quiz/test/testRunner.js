/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Teste local do gravador e executor visual de sites.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const assert = require('assert/strict');
const http = require('http');
const Module = require('module');
const { createHtmlReport, launchBrowser, runTests } = require('../src/testRunner');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
	if (request === 'vscode') { return {}; }
	return originalLoad.call(this, request, parent, isMain);
};
const { RECORDER_SCRIPT } = require('../src/testEditor');
Module._load = originalLoad;

const pageHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Página de testes</title></head><body>
<label>Nome <input id="name" name="nome"></label>
<label>Cidade <select id="city" name="cidade"><option value="">Selecione</option><option value="sp">São Paulo</option></select></label>
<label><input id="accepted" type="checkbox"> Aceito</label>
<button id="submit" type="button">Enviar</button>
<p id="result" hidden></p><p id="hidden" hidden>Não aparece</p>
<div class="item">Um</div><div class="item">Dois</div>
<script>document.getElementById('submit').addEventListener('click', () => { const output = document.getElementById('result'); output.textContent = 'Olá, ' + document.getElementById('name').value; output.hidden = false; });</script>
</body></html>`;

async function main() {
	const server = http.createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		response.end(pageHtml);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}/`;
	let browser;
	try {
		browser = await launchBrowser();
		const context = await browser.newContext();
		const recorded = [];
		const recordPage = await context.newPage();
		await recordPage.exposeBinding('__devcodeRecord', (_source, step) => { recorded.push(step); });
		await recordPage.addInitScript(RECORDER_SCRIPT);
		await recordPage.goto(baseUrl);
		await recordPage.locator('#name').fill('Bia');
		await recordPage.waitForTimeout(600);
		await recordPage.locator('#submit').click();
		await recordPage.waitForTimeout(100);
		await recordPage.evaluate(() => {
			document.querySelector('[data-assert="assertText"]').click();
			document.getElementById('result').click();
			document.querySelector('[data-assert="assertVisible"]').click();
			document.getElementById('result').click();
			document.querySelector('[data-assert="assertTitle"]').click();
		});
		await recordPage.waitForTimeout(100);
		assert.deepStrictEqual(recorded.map(step => [step.command, step.target, step.value]), [
			['type', 'id=name', 'Bia'],
			['click', 'id=submit', ''],
			['assertText', 'id=result', 'Olá, Bia'],
			['assertVisible', 'id=result', ''],
			['assertTitle', '', 'Página de testes'],
		]);
		await context.close();

		const model = {
			baseUrl,
			suites: [{
				id: 'suite', name: 'Verificações locais', cases: [
					{
						id: 'pass', name: 'Passa com interações e asserts', steps: [
							{ id: 'p1', command: 'open', target: baseUrl },
							{ id: 'p2', command: 'type', target: 'id=name', value: 'Ana' },
							{ id: 'p3', command: 'check', target: 'id=accepted' },
							{ id: 'p4', command: 'select', target: 'name=cidade', value: 'sp' },
							{ id: 'p5', command: 'click', target: 'id=submit' },
							{ id: 'p6', command: 'waitForElement', target: 'id=result' },
							{ id: 'p7', command: 'assertTextContains', target: 'id=result', value: 'Olá, Ana' },
							{ id: 'p8', command: 'assertValue', target: 'id=name', value: 'Ana' },
							{ id: 'p9', command: 'assertVisible', target: 'id=result' },
							{ id: 'p10', command: 'assertTitle', value: 'Página de testes' },
							{ id: 'p11', command: 'assertUrlContains', value: `:${port}/` },
							{ id: 'p12', command: 'assertElementCount', target: 'css=.item', value: '2' },
							{ id: 'p13', command: 'assertNotVisible', target: 'id=hidden' },
							{ id: 'p14', command: 'pressKey', target: 'id=name', value: 'Enter' },
							{ id: 'p15', command: 'pause', value: '1' },
							{ id: 'p16', command: 'uncheck', target: 'id=accepted' },
						],
					},
					{
						id: 'fail', name: 'Falha mantém captura e segue adiante', steps: [
							{ id: 'f1', command: 'open', target: baseUrl },
							{ id: 'f2', command: 'click', target: 'id=submit' },
							{ id: 'f3', command: 'assertText', target: 'id=result', value: 'Texto incorreto' },
							{ id: 'f4', command: 'assertTitle', value: 'Página de testes' },
							{ id: 'f5', command: 'assertVisible', target: 'id=hidden', disabled: true },
						],
					},
					{
						id: 'after-failure', name: 'Executado depois do caso com falha', steps: [
							{ id: 'a1', command: 'open', target: baseUrl },
							{ id: 'a2', command: 'assertTitle', value: 'Página de testes' },
						],
					},
				],
			}],
		};
		const results = await runTests(model, { browser });
		assert.deepStrictEqual({ total: results.total, passed: results.passed, failed: results.failed, skipped: results.skipped }, {
			total: 23, passed: 21, failed: 1, skipped: 1,
		});
		assert.deepStrictEqual(results.suites[0].cases.map(testCase => testCase.status), ['passou', 'falhou', 'passou']);
		assert.match(results.suites[0].cases[1].steps[2].error, /Texto diferente/);
		assert.ok(results.suites[0].cases[1].steps[2].screenshot?.length > 100);
		const report = createHtmlReport(results);
		assert.match(report, /data:image\/jpeg;base64,/);
		assert.match(report, /Relatório de execução/);
		console.log('OK: gravação, interações, asserts, captura de falha, relatório e continuação entre casos.');
	} finally {
		if (browser) { await browser.close().catch(() => {}); }
		await new Promise(resolve => server.close(resolve));
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
