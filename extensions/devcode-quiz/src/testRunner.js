/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Execução visual de testes de sites com Playwright.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const { chromium } = require('playwright-core');

const STEP_TIMEOUT = 10000;
const COMMANDS = new Set([
	'open', 'click', 'type', 'select', 'check', 'uncheck', 'pressKey', 'waitForElement',
	'assertText', 'assertTextContains', 'assertValue', 'assertVisible', 'assertNotVisible',
	'assertTitle', 'assertUrlContains', 'assertElementCount', 'pause',
]);

/** Abre um navegador já instalado, sem baixar binários. */
async function launchBrowser() {
	const errors = [];
	for (const channel of ['msedge', 'chrome']) {
		try {
			return await chromium.launch({ channel, headless: false });
		} catch (error) {
			errors.push(`${channel}: ${error.message}`);
		}
	}
	throw new Error(`Não foi possível abrir o Microsoft Edge nem o Google Chrome instalados. ${errors.join(' | ')}`);
}

/** Converte um locator amigável em um Locator do Playwright. */
function locatorFor(page, rawTarget) {
	const target = String(rawTarget || '').trim();
	if (!target) {
		throw new Error('Informe um alvo (locator) para esta etapa.');
	}
	const separator = target.indexOf('=');
	const kind = separator > 0 ? target.slice(0, separator).toLowerCase() : 'css';
	const value = separator > 0 ? target.slice(separator + 1) : target;
	if (!value) {
		throw new Error('O locator está vazio.');
	}
	switch (kind) {
		case 'css': return page.locator(value);
		case 'xpath': return page.locator(`xpath=${value}`);
		case 'id': return page.locator(`[id=${JSON.stringify(value)}]`);
		case 'text': return page.getByText(value, { exact: true });
		case 'name': return page.locator(`[name=${JSON.stringify(value)}]`);
		default: throw new Error(`Tipo de locator desconhecido: ${kind}. Use css=, xpath=, id=, text= ou name=.`);
	}
}

/** Aguarda que um alvo esteja visível antes de uma interação. */
async function visibleLocator(page, target) {
	const locator = locatorFor(page, target);
	await locator.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
	return locator;
}

function expectedNumber(value, description) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < 0) {
		throw new Error(`Informe um número inteiro válido para ${description}.`);
	}
	return number;
}

/** Executa uma etapa e registra o resultado sem interromper as próximas etapas. */
async function executeStep(page, step, options = {}) {
	const started = Date.now();
	const result = {
		id: step.id,
		command: step.command,
		target: step.target || '',
		value: step.value || '',
		status: 'ok',
		duration: 0,
	};
	if (step.disabled) {
		result.status = 'pulado';
		result.error = 'Etapa desativada.';
	} else {
		try {
			await runCommand(page, step, options.baseUrl);
		} catch (error) {
			result.status = 'falhou';
			result.error = toPortugueseError(error);
			try {
				const screenshot = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, timeout: 5000 });
				result.screenshot = screenshot.toString('base64');
			} catch { /* A página pode ter fechado durante a falha. */ }
		}
	}
	result.duration = Date.now() - started;
	if (options.onStep) {
		await options.onStep(result);
	}
	return result;
}

async function runCommand(page, step, baseUrl) {
	const target = String(step.target || '').trim();
	const value = String(step.value ?? '');
	if (!COMMANDS.has(step.command)) {
		throw new Error(`Comando desconhecido: ${step.command || '(vazio)'}.`);
	}
	switch (step.command) {
		case 'open': {
			const destination = target || baseUrl;
			if (!destination) { throw new Error('Informe uma URL para abrir.'); }
			const url = new URL(destination, baseUrl || undefined);
			if (!['http:', 'https:', 'file:'].includes(url.protocol)) { throw new Error('Use uma URL http ou https.'); }
			await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
			return;
		}
		case 'click': await (await visibleLocator(page, target)).click({ timeout: STEP_TIMEOUT }); return;
		case 'type': await (await visibleLocator(page, target)).fill(value, { timeout: STEP_TIMEOUT }); return;
		case 'select': await (await visibleLocator(page, target)).selectOption(value, { timeout: STEP_TIMEOUT }); return;
		case 'check': await (await visibleLocator(page, target)).check({ timeout: STEP_TIMEOUT }); return;
		case 'uncheck': await (await visibleLocator(page, target)).uncheck({ timeout: STEP_TIMEOUT }); return;
		case 'pressKey': await (await visibleLocator(page, target)).press(value, { timeout: STEP_TIMEOUT }); return;
		case 'waitForElement': await (await locatorFor(page, target)).waitFor({ state: 'visible', timeout: STEP_TIMEOUT }); return;
		case 'assertText': {
			const actual = (await (await visibleLocator(page, target)).innerText()).trim();
			if (actual !== value.trim()) { throw new Error(`Texto diferente. Esperado: "${value.trim()}"; encontrado: "${actual}".`); }
			return;
		}
		case 'assertTextContains': {
			const actual = (await (await visibleLocator(page, target)).innerText()).trim();
			if (!actual.includes(value)) { throw new Error(`O texto esperado "${value}" não foi encontrado em "${actual}".`); }
			return;
		}
		case 'assertValue': {
			const actual = await (await visibleLocator(page, target)).inputValue();
			if (actual !== value) { throw new Error(`Valor diferente. Esperado: "${value}"; encontrado: "${actual}".`); }
			return;
		}
		case 'assertVisible': await (await locatorFor(page, target)).waitFor({ state: 'visible', timeout: STEP_TIMEOUT }); return;
		case 'assertNotVisible': await (await locatorFor(page, target)).waitFor({ state: 'hidden', timeout: STEP_TIMEOUT }); return;
		case 'assertTitle': {
			const actual = await page.title();
			if (actual !== value) { throw new Error(`Título diferente. Esperado: "${value}"; encontrado: "${actual}".`); }
			return;
		}
		case 'assertUrlContains': {
			const actual = page.url();
			if (!actual.includes(value)) { throw new Error(`A URL "${actual}" não contém "${value}".`); }
			return;
		}
		case 'assertElementCount': {
			const expected = expectedNumber(value, 'a quantidade de elementos');
			const locator = locatorFor(page, target);
			const deadline = Date.now() + STEP_TIMEOUT;
			let actual = await locator.count();
			while (actual !== expected && Date.now() < deadline) {
				await page.waitForTimeout(Math.min(100, deadline - Date.now()));
				actual = await locator.count();
			}
			if (actual !== expected) { throw new Error(`Quantidade diferente. Esperado: ${expected}; encontrado: ${actual}.`); }
			return;
		}
		case 'pause': {
			const milliseconds = expectedNumber(value || target || 0, 'a duração da pausa');
			if (milliseconds > 60000) { throw new Error('A pausa não pode passar de 60.000 ms.'); }
			await page.waitForTimeout(milliseconds);
			return;
		}
	}
}

/** Executa um caso inteiro e continua mesmo se uma etapa falhar. */
async function executeTestCase(page, testCase, options = {}) {
	const started = Date.now();
	const steps = [];
	if (options.baseUrl && (!testCase.steps?.length || testCase.steps[0].command !== 'open')) {
		const open = { id: `${testCase.id || 'caso'}-base-url`, command: 'open', target: options.baseUrl };
		steps.push(await executeStep(page, open, options));
	}
	for (const step of testCase.steps || []) {
		steps.push(await executeStep(page, step, options));
	}
	return {
		id: testCase.id,
		name: testCase.name || 'Caso sem nome',
		status: steps.some(step => step.status === 'falhou') ? 'falhou' : 'passou',
		duration: Date.now() - started,
		steps,
	};
}

/** Executa todos ou parte dos casos em um navegador; aceita browser externo para testes locais. */
async function runTests(model, options = {}) {
	const browser = options.browser || await launchBrowser();
	const ownsBrowser = !options.browser;
	let context;
	const suites = [];
	const started = Date.now();
	try {
		context = await browser.newContext();
		const suiteIds = options.suiteIds ? new Set(options.suiteIds) : undefined;
		const caseIds = options.caseIds ? new Set(options.caseIds) : undefined;
		for (const suite of model.suites || []) {
			if (suiteIds && !suiteIds.has(suite.id)) { continue; }
			const suiteResult = { id: suite.id, name: suite.name || 'Suíte sem nome', cases: [] };
			for (const testCase of suite.cases || []) {
				if (caseIds && !caseIds.has(testCase.id)) { continue; }
				if (options.onCaseStart) { await options.onCaseStart({ suite, testCase }); }
				const page = await context.newPage();
				try {
					const result = await executeTestCase(page, testCase, {
						baseUrl: model.baseUrl,
						onStep: step => options.onStep && options.onStep({ suite, testCase, step }),
					});
					suiteResult.cases.push(result);
					if (options.onCaseResult) { await options.onCaseResult({ suite, testCase, result }); }
				} finally {
					await page.close().catch(() => {});
				}
			}
			suiteResult.status = suiteResult.cases.some(testCase => testCase.status === 'falhou') ? 'falhou' : 'passou';
			suites.push(suiteResult);
		}
	} finally {
		if (context) { await context.close().catch(() => {}); }
		if (ownsBrowser) { await browser.close().catch(() => {}); }
	}
	const steps = suites.flatMap(suite => suite.cases.flatMap(testCase => testCase.steps));
	const results = {
		timestamp: new Date().toISOString(),
		duration: Date.now() - started,
		total: steps.length,
		passed: steps.filter(step => step.status === 'ok').length,
		failed: steps.filter(step => step.status === 'falhou').length,
		skipped: steps.filter(step => step.status === 'pulado').length,
		suites,
	};
	return results;
}

function toPortugueseError(error) {
	const message = String(error?.message || error || 'Erro desconhecido').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s+/g, ' ').trim();
	if (/timeout.*exceeded|timed out/i.test(message)) {
		return `O locator não ficou pronto em até 10 segundos. Detalhe técnico: ${message}`;
	}
	if (/strict mode violation|resolved to .* elements/i.test(message)) { return 'O locator encontrou mais de um elemento. Torne o alvo mais específico.'; }
	if (/target.*closed|page.*closed/i.test(message)) { return 'A página foi fechada antes de concluir a etapa.'; }
	if (/not enabled|disabled/i.test(message)) { return 'O elemento está desabilitado.'; }
	if (/not visible|hidden/i.test(message)) { return 'O elemento não está visível.'; }
	if (/not editable|cannot be edited/i.test(message)) { return 'O elemento não permite digitação.'; }
	if (/intercepts pointer events|another element.*receives pointer/i.test(message)) { return 'Outro elemento está cobrindo o alvo.'; }
	if (/no node found|failed to find element/i.test(message)) { return 'O elemento não foi encontrado.'; }
	if (/^(O |A |Use |Informe |Não |Digite |Quantidade |Texto |Título |Valor |Comando |A pausa )/i.test(message)) { return message; }
	return `Falha na etapa. Detalhe técnico do navegador: ${message}`;
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

/** Monta relatório HTML autocontido, inclusive com as capturas de tela. */
function createHtmlReport(results) {
	const total = results.total || 0;
	const passedWidth = total ? Math.round(results.passed * 100 / total) : 0;
	const failedWidth = total ? Math.round(results.failed * 100 / total) : 0;
	const suites = results.suites.map(suite => `<section><h2>${escapeHtml(suite.name)}</h2>${suite.cases.map(testCase => `
		<article class="case ${testCase.status}"><h3>${escapeHtml(testCase.name)} <span>${escapeHtml(testCase.status)}</span></h3><p>Duração: ${testCase.duration} ms</p>
		<table><thead><tr><th>Etapa</th><th>Comando</th><th>Alvo</th><th>Valor</th><th>Resultado</th></tr></thead><tbody>${testCase.steps.map((step, index) => `<tr class="${step.status}"><td>${index + 1}</td><td>${escapeHtml(step.command)}</td><td>${escapeHtml(step.target)}</td><td>${escapeHtml(step.value)}</td><td>${escapeHtml(step.status)}${step.error ? `<pre>${escapeHtml(step.error)}</pre>` : ''}${step.screenshot ? `<img alt="Captura da falha" src="data:image/jpeg;base64,${step.screenshot}">` : ''}</td></tr>`).join('')}</tbody></table></article>`).join('')}</section>`).join('');
	return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Relatório de testes DEV CODE</title>
	<style>body{font:15px system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#302326;background:#fff8f7}h1{color:#a6323d}h2{margin-top:32px;color:#852d35}.summary{display:flex;gap:18px;flex-wrap:wrap}.metric{background:white;border:1px solid #f0d1d1;border-radius:10px;padding:14px 20px;min-width:115px}.metric b{display:block;font-size:24px}.bar{height:14px;display:flex;overflow:hidden;border-radius:99px;background:#f3dfe0;margin:14px 0 26px}.passbar{background:#4f9b72;width:${passedWidth}%}.failbar{background:#c94b53;width:${failedWidth}%}.case{background:white;border:1px solid #efd2d3;border-radius:10px;padding:16px;margin:14px 0}.case h3{margin:0}.case h3 span{font-size:12px;text-transform:uppercase;padding:4px 8px;border-radius:99px;background:#e6f3eb;color:#276342}.case.falhou h3 span{background:#ffe3e2;color:#a6323d}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid #f0e2e2;vertical-align:top;overflow-wrap:anywhere}.falhou td:last-child{color:#a6323d}.pulado td:last-child{color:#8a6a24}pre{white-space:pre-wrap;color:#812d36}img{display:block;max-width:100%;max-height:480px;margin-top:10px;border:1px solid #e4b9bb;border-radius:6px}</style></head>
	<body><h1>Relatório de execução</h1><div class="summary"><div class="metric"><b>${total}</b>etapas</div><div class="metric"><b>${results.passed}</b>passou</div><div class="metric"><b>${results.failed}</b>falhou</div><div class="metric"><b>${results.skipped}</b>pulou</div><div class="metric"><b>${results.duration} ms</b>duração</div></div><div class="bar"><div class="passbar"></div><div class="failbar"></div></div>${suites || '<p>Nenhuma etapa foi executada.</p>'}</body></html>`;
}

module.exports = { COMMANDS, STEP_TIMEOUT, createHtmlReport, executeStep, executeTestCase, launchBrowser, locatorFor, runTests, toPortugueseError };
