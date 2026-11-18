/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Interface do editor visual de testes.
 *--------------------------------------------------------------------------------------------*/
'use strict';

(() => {
	const vscode = acquireVsCodeApi();
	const app = document.getElementById('app');
	const commands = [
		['open', 'Abrir página'], ['click', 'Clicar'], ['type', 'Digitar'], ['select', 'Selecionar opção'],
		['check', 'Marcar'], ['uncheck', 'Desmarcar'], ['pressKey', 'Pressionar tecla'], ['waitForElement', 'Aguardar elemento'],
		['assertText', 'Verificar texto'], ['assertTextContains', 'Verificar se contém texto'], ['assertValue', 'Verificar valor'],
		['assertVisible', 'Verificar visível'], ['assertNotVisible', 'Verificar não visível'], ['assertTitle', 'Verificar título'],
		['assertUrlContains', 'Verificar URL'], ['assertElementCount', 'Verificar quantidade'], ['pause', 'Pausar'],
	];
	const state = {
		model: undefined,
		error: '',
		suiteId: undefined,
		caseId: undefined,
		recording: false,
		running: false,
		dragStepId: undefined,
		newItem: undefined,
		confirmDelete: undefined,
		status: { message: 'Carregando projeto de testes…', kind: 'info' },
		results: {},
		lastReport: '',
	};

	function escapeHtml(value) {
		return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
	}

	function id(prefix) {
		return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}

	function selectedSuite() {
		return state.model?.suites.find(suite => suite.id === state.suiteId);
	}

	function selectedCase() {
		return selectedSuite()?.cases?.find(testCase => testCase.id === state.caseId);
	}

	function selectFirst() {
		if (!state.model) { return; }
		if (!state.model.suites.some(suite => suite.id === state.suiteId)) { state.suiteId = state.model.suites[0]?.id; }
		const suite = selectedSuite();
		if (!suite?.cases?.some(testCase => testCase.id === state.caseId)) { state.caseId = suite?.cases?.[0]?.id; }
		vscode.postMessage({ type: 'selection', suiteId: state.suiteId, caseId: state.caseId });
	}

	function ensureModelIds(model) {
		let changed = false;
		model.suites ||= [];
		for (const suite of model.suites) {
			if (!suite.id) { suite.id = id('suite'); changed = true; }
			suite.cases ||= [];
			for (const testCase of suite.cases) {
				if (!testCase.id) { testCase.id = id('case'); changed = true; }
				testCase.steps ||= [];
				for (const step of testCase.steps) {
					if (!step.id) { step.id = id('step'); changed = true; }
					if (typeof step.target !== 'string') { step.target = String(step.target || ''); changed = true; }
					if (typeof step.value !== 'string') { step.value = String(step.value || ''); changed = true; }
				}
			}
		}
		return changed;
	}

	function legacyResult(stepId) {
		for (const suite of state.model?.lastResults?.suites || []) {
			for (const testCase of suite.cases || []) {
				const result = testCase.steps?.find(item => item.id === stepId);
				if (result) { return result; }
			}
		}
		return undefined;
	}

	function render() {
		if (state.error) {
			app.innerHTML = `<div class="error">${escapeHtml(state.error)}</div>`;
			return;
		}
		if (!state.model) { app.innerHTML = '<div class="status">Carregando projeto de testes…</div>'; return; }
		selectFirst();
		const suite = selectedSuite();
		const testCase = selectedCase();
		const suites = state.model.suites.map(item => `<div class="suite-item ${item.id === state.suiteId ? 'selected' : ''}" draggable="true" data-drag-suite="${escapeHtml(item.id)}" title="Arraste para mudar a ordem">
			<button data-action="select-suite" data-suite-id="${escapeHtml(item.id)}">${escapeHtml(item.name || 'Suíte sem nome')}</button>
			<button class="small-action danger" title="Remover suíte" data-action="remove-suite" data-suite-id="${escapeHtml(item.id)}">×</button></div>
			<div class="case-list">${(item.cases || []).map(child => `<div class="case-item ${child.id === state.caseId ? 'selected' : ''}" draggable="true" data-drag-suite="${escapeHtml(item.id)}" data-drag-case="${escapeHtml(child.id)}" title="Arraste para mudar a ordem (ou para outra suíte)"><span class="drag" aria-hidden="true">⠿</span>
			<button data-action="select-case" data-suite-id="${escapeHtml(item.id)}" data-case-id="${escapeHtml(child.id)}">${escapeHtml(child.name || 'Caso sem nome')}</button>
			<button class="small-action danger" title="Remover caso" data-action="remove-case" data-suite-id="${escapeHtml(item.id)}" data-case-id="${escapeHtml(child.id)}">×</button></div>`).join('')}
			<button class="small-action" data-action="add-case" data-suite-id="${escapeHtml(item.id)}">＋ Caso de teste</button></div>`).join('');
		const stepRows = (testCase?.steps || []).map((step, index) => {
			if (!step.id) { step.id = id('step'); }
			const result = state.results[step.id] || legacyResult(step.id) || {};
			const resultText = result.status ? `${result.status}${result.duration !== undefined ? ` · ${result.duration} ms` : ''}${result.error ? ` · ${result.error}` : ''}` : 'Aguardando execução';
			return `<div class="step-row step-grid" draggable="true" data-step-id="${escapeHtml(step.id)}">
				<span class="drag" title="Arraste para reordenar">⠿</span>
				<select class="command-field" data-field="command" aria-label="Comando">${commands.map(([value, label]) => `<option value="${value}" ${step.command === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
				<input class="target-field" data-field="target" value="${escapeHtml(step.target || '')}" placeholder="Alvo: css=, xpath=, id=, text=, name=" aria-label="Alvo">
				<input class="value-field" data-field="value" value="${escapeHtml(step.value || '')}" placeholder="Valor esperado ou digitado" aria-label="Valor">
				<button class="pick-button" title="Escolher elemento na página" data-action="pick-element">⌖</button>
				<label class="skip-step" title="Pular esta etapa"><input type="checkbox" data-field="disabled" ${step.disabled ? 'checked' : ''}>Pular</label>
				<button class="remove-button danger" title="Remover etapa" data-action="remove-step">×</button>
				<div class="step-result ${escapeHtml(result.status || '')}">${escapeHtml(resultText)}</div>
			</div>`;
		}).join('');
		const suiteName = suite ? escapeHtml(suite.name || '') : '';
		const caseName = testCase ? escapeHtml(testCase.name || '') : '';
		const deleteTarget = state.confirmDelete?.type === 'suite'
			? state.model.suites.find(item => item.id === state.confirmDelete.id)?.name
			: state.confirmDelete?.type === 'case'
				? selectedSuite()?.cases?.find(item => item.id === state.confirmDelete.id)?.name
				: '';
		app.innerHTML = `<div class="app">
			<header class="topbar"><div class="brand">DEV CODE · TESTE VISUAL</div>
				<div class="base-url"><label for="base-url">URL base</label><input id="base-url" value="${escapeHtml(state.model.baseUrl || '')}" placeholder="https://meusite.com.br"></div>
				<div class="actions"><button class="primary" data-action="record" ${state.recording || state.running ? 'disabled' : ''}>● Gravar</button>
				<button data-action="stop-recording" ${state.recording ? '' : 'disabled'}>■ Parar</button>
				<button data-action="run-case" ${state.running || state.recording || !testCase ? 'disabled' : ''}>Executar caso</button>
				<button data-action="run-suite" ${state.running || state.recording || !suite ? 'disabled' : ''}>Executar suíte</button>
				<button data-action="run-all" ${state.running || state.recording ? 'disabled' : ''}>Executar tudo</button></div>
			</header>
			<div id="status" class="status ${escapeHtml(state.status.kind)}">${escapeHtml(state.status.message)}</div>
			<div class="workspace"><aside class="sidebar"><div class="sidebar-head"><span>Suítes · ${state.model.suites.length}</span><button title="Adicionar suíte" data-action="add-suite">＋</button></div>
				<div class="suite-list">${suites || '<div class="empty">Adicione uma suíte para começar.</div>'}</div>
				${state.newItem ? `<div class="inline-add"><input id="new-item-name" value="${escapeHtml(state.newItem.name || '')}" placeholder="${state.newItem.type === 'suite' ? 'Nome da suíte' : 'Nome do caso de teste'}" aria-label="Nome"><button data-action="save-new-item">Adicionar</button><button data-action="cancel-new-item">Cancelar</button></div>` : ''}</aside>
				<main class="editor">${state.confirmDelete ? `<div class="confirm-delete"><span>Remover "${escapeHtml(deleteTarget || '')}"?</span><button class="danger" data-action="confirm-delete">Remover</button><button data-action="cancel-delete">Cancelar</button></div>` : ''}
				${suite && testCase ? `<div class="editor-head"><input class="suite-name" data-field="suite-name" value="${suiteName}" aria-label="Nome da suíte"><span class="subtle">›</span><input class="case-name" data-field="case-name" value="${caseName}" aria-label="Nome do caso"><span class="subtle">${(testCase.steps || []).length} etapas</span></div>
					<div class="steps-head"><h2>Etapas do caso de teste</h2><div class="actions"><button data-action="pick-element" ${state.recording ? '' : 'disabled'}>⌖ Escolher elemento</button><button data-action="add-step">＋ Adicionar etapa</button></div></div>
					<div class="step-grid step-labels"><span></span><span>Comando</span><span>Alvo / locator</span><span>Valor</span><span></span><span>Pular</span><span></span></div>
					<div id="steps">${stepRows || '<div class="empty">Este caso ainda não tem etapas. Grave ações no navegador ou adicione uma etapa.</div>'}</div>
					<div id="summary" class="summary ${state.lastReport ? 'visible' : ''}"><div class="summary-row"><span>Última execução:</span><b>${state.model.lastResults?.passed || 0} passou</b><b>${state.model.lastResults?.failed || 0} falhou</b><span>${state.model.lastResults?.duration || 0} ms</span>
						${state.lastReport ? `<button data-action="open-report" data-report="${escapeHtml(state.lastReport)}">Abrir relatório</button>` : ''}</div></div>`
					: '<div class="empty">Crie ou selecione um caso de teste na lista de suítes.</div>'}</main>
			</div></div>`;
	}

	function commit() {
		vscode.postMessage({ type: 'edit', model: state.model });
		selectFirst();
		render();
	}

	function getStep(row) {
		return selectedCase()?.steps?.find(step => step.id === row.dataset.stepId);
	}

	function addSuite(name) {
		if (!name?.trim()) { return; }
		const suite = { id: id('suite'), name: name.trim(), cases: [] };
		state.model.suites.push(suite);
		state.suiteId = suite.id;
		state.caseId = undefined;
		state.newItem = undefined;
		commit();
	}

	function addCase(suiteId, name) {
		const suite = state.model.suites.find(item => item.id === suiteId);
		if (!suite || !name?.trim()) { return; }
		const testCase = { id: id('case'), name: name.trim(), steps: [] };
		suite.cases.push(testCase);
		state.suiteId = suite.id;
		state.caseId = testCase.id;
		state.newItem = undefined;
		commit();
	}

	function removeSuite(suiteId) {
		const suite = state.model.suites.find(item => item.id === suiteId);
		if (!suite) { return; }
		state.model.suites = state.model.suites.filter(item => item.id !== suiteId);
		state.confirmDelete = undefined;
		if (state.suiteId === suiteId) { state.suiteId = undefined; state.caseId = undefined; }
		commit();
	}

	function removeCase(suiteId, caseId) {
		const suite = state.model.suites.find(item => item.id === suiteId);
		const testCase = suite?.cases?.find(item => item.id === caseId);
		if (!suite || !testCase) { return; }
		suite.cases = suite.cases.filter(item => item.id !== caseId);
		state.confirmDelete = undefined;
		if (state.caseId === caseId) { state.caseId = undefined; }
		commit();
	}

	function moveStep(sourceId, destinationId) {
		const steps = selectedCase()?.steps;
		if (!steps) { return; }
		const from = steps.findIndex(step => step.id === sourceId);
		const to = steps.findIndex(step => step.id === destinationId);
		if (from < 0 || to < 0 || from === to) { return; }
		const [step] = steps.splice(from, 1);
		steps.splice(to, 0, step);
		commit();
	}

	app.addEventListener('click', event => {
		const button = event.target.closest('[data-action]');
		if (!button || button.disabled) { return; }
		const action = button.dataset.action;
		switch (action) {
			case 'add-suite': state.newItem = { type: 'suite', name: '' }; render(); app.querySelector('#new-item-name')?.focus(); break;
			case 'add-case': state.newItem = { type: 'case', suiteId: button.dataset.suiteId, name: '' }; render(); app.querySelector('#new-item-name')?.focus(); break;
			case 'remove-suite': state.confirmDelete = { type: 'suite', id: button.dataset.suiteId }; render(); break;
			case 'remove-case': state.confirmDelete = { type: 'case', suiteId: button.dataset.suiteId, id: button.dataset.caseId }; state.suiteId = button.dataset.suiteId; state.caseId = button.dataset.caseId; render(); break;
			case 'save-new-item': {
				const name = app.querySelector('#new-item-name')?.value || '';
				if (state.newItem?.type === 'suite') { addSuite(name); }
				else if (state.newItem?.type === 'case') { addCase(state.newItem.suiteId, name); }
				break;
			}
			case 'cancel-new-item': state.newItem = undefined; render(); break;
			case 'confirm-delete':
				if (state.confirmDelete?.type === 'suite') { removeSuite(state.confirmDelete.id); }
				else if (state.confirmDelete?.type === 'case') { removeCase(state.confirmDelete.suiteId, state.confirmDelete.id); }
				break;
			case 'cancel-delete': state.confirmDelete = undefined; render(); break;
			case 'select-suite': state.suiteId = button.dataset.suiteId; state.caseId = undefined; render(); break;
			case 'select-case': state.suiteId = button.dataset.suiteId; state.caseId = button.dataset.caseId; render(); break;
			case 'add-step': {
				const testCase = selectedCase();
				if (!testCase) { break; }
				testCase.steps.push({ id: id('step'), command: 'click', target: '', value: '' });
				commit();
				break;
			}
			case 'remove-step': {
				const row = button.closest('[data-step-id]');
				const testCase = selectedCase();
				if (row && testCase) { testCase.steps = testCase.steps.filter(step => step.id !== row.dataset.stepId); commit(); }
				break;
			}
			case 'record': vscode.postMessage({ type: 'record' }); break;
			case 'stop-recording': vscode.postMessage({ type: 'stopRecording' }); break;
			case 'run-case': vscode.postMessage({ type: 'runCase' }); break;
			case 'run-suite': vscode.postMessage({ type: 'runSuite' }); break;
			case 'run-all': vscode.postMessage({ type: 'runAll' }); break;
			case 'pick-element': vscode.postMessage({ type: 'pickElement', stepId: button.closest('.step-row')?.dataset.stepId }); break;
			case 'open-report': vscode.postMessage({ type: 'openReport', report: button.dataset.report }); break;
		}
	});

	app.addEventListener('change', event => {
		const field = event.target.dataset.field;
		if (event.target.id === 'base-url') { state.model.baseUrl = event.target.value.trim(); commit(); return; }
		if (field === 'suite-name' && selectedSuite()) { selectedSuite().name = event.target.value.trim() || 'Suíte sem nome'; commit(); return; }
		if (field === 'case-name' && selectedCase()) { selectedCase().name = event.target.value.trim() || 'Caso sem nome'; commit(); return; }
		if (['command', 'target', 'value', 'disabled'].includes(field)) {
			const step = getStep(event.target.closest('[data-step-id]'));
			if (step) { step[field] = field === 'disabled' ? event.target.checked : event.target.value; delete state.results[step.id]; commit(); }
		}
	});
	app.addEventListener('input', event => {
		if (event.target.id === 'new-item-name' && state.newItem) { state.newItem.name = event.target.value; }
	});

	// ---------------------------------------------------------------- arrastar suítes e casos de teste
	function moveCase(fromSuiteId, caseId, toSuiteId, beforeCaseId, after) {
		const from = state.model.suites.find(s => s.id === fromSuiteId);
		const to = state.model.suites.find(s => s.id === toSuiteId);
		if (!from || !to || caseId === beforeCaseId) { return; }
		const i = from.cases.findIndex(c => c.id === caseId);
		if (i < 0) { return; }
		const [moved] = from.cases.splice(i, 1);
		let j = beforeCaseId ? to.cases.findIndex(c => c.id === beforeCaseId) : to.cases.length;
		if (j < 0) { j = to.cases.length; } else if (after) { j++; }
		to.cases.splice(j, 0, moved);
		state.suiteId = to.id; state.caseId = moved.id;
		commit();
	}
	function moveSuite(suiteId, targetId, after) {
		const list = state.model.suites;
		const i = list.findIndex(s => s.id === suiteId);
		if (i < 0 || suiteId === targetId) { return; }
		const [moved] = list.splice(i, 1);
		let j = list.findIndex(s => s.id === targetId);
		if (j < 0) { j = list.length; } else if (after) { j++; }
		list.splice(j, 0, moved);
		commit();
	}
	const isAfter = (event, el) => { const r = el.getBoundingClientRect(); return event.clientY > r.top + r.height / 2; };
	const clearMarks = () => app.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-into'));
	app.addEventListener('dragstart', event => {
		const item = event.target.closest?.('[data-drag-suite]');
		if (!item || event.target.closest('.step-row')) { return; }
		state.dragList = item.dataset.dragCase ? { type: 'case', suiteId: item.dataset.dragSuite, caseId: item.dataset.dragCase } : { type: 'suite', suiteId: item.dataset.dragSuite };
		item.classList.add('dragging');
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', 'devcode');
	});
	app.addEventListener('dragover', event => {
		const d = state.dragList; if (!d) { return; }
		const item = event.target.closest('[data-drag-suite]'); if (!item) { return; }
		const targetIsCase = !!item.dataset.dragCase;
		if (d.type === 'suite' && targetIsCase) { return; }
		event.preventDefault();
		clearMarks();
		if (d.type === 'case' && !targetIsCase) { item.classList.add('drop-into'); }
		else { item.classList.add(isAfter(event, item) ? 'drop-after' : 'drop-before'); }
	});
	app.addEventListener('drop', event => {
		const d = state.dragList; if (!d) { return; }
		const item = event.target.closest('[data-drag-suite]'); if (!item) { return; }
		event.preventDefault();
		const after = isAfter(event, item);
		clearMarks();
		state.dragList = undefined;
		if (d.type === 'suite') { if (!item.dataset.dragCase) { moveSuite(d.suiteId, item.dataset.dragSuite, after); } }
		else { moveCase(d.suiteId, d.caseId, item.dataset.dragSuite, item.dataset.dragCase, after); }
	});
	app.addEventListener('dragend', () => { state.dragList = undefined; clearMarks(); app.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging')); });

	app.addEventListener('dragstart', event => {
		const row = event.target.closest('.step-row');
		if (!row) { return; }
		state.dragStepId = row.dataset.stepId;
		row.classList.add('dragging');
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', state.dragStepId);
	});
	app.addEventListener('dragend', event => {
		event.target.closest('.step-row')?.classList.remove('dragging');
		app.querySelectorAll('.drag-over').forEach(row => row.classList.remove('drag-over'));
		state.dragStepId = undefined;
	});
	app.addEventListener('dragover', event => {
		const row = event.target.closest('.step-row');
		if (row && state.dragStepId) { event.preventDefault(); row.classList.add('drag-over'); }
	});
	app.addEventListener('dragleave', event => event.target.closest('.step-row')?.classList.remove('drag-over'));
	app.addEventListener('drop', event => {
		const row = event.target.closest('.step-row');
		if (!row || !state.dragStepId) { return; }
		event.preventDefault();
		row.classList.remove('drag-over');
		moveStep(state.dragStepId, row.dataset.stepId);
	});

	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'load':
				state.model = message.model;
				state.error = message.error || '';
				if (state.model && ensureModelIds(state.model)) { vscode.postMessage({ type: 'edit', model: state.model }); }
				selectFirst();
				render();
				break;
			case 'recording': state.recording = message.active; render(); break;
			case 'running': state.running = message.active; if (message.active) { state.results = {}; state.lastReport = ''; } render(); break;
			case 'status': state.status = { message: message.message, kind: message.kind }; render(); break;
			case 'recordedStep': {
				const testCase = state.model?.suites.find(suite => suite.id === message.suiteId)?.cases?.find(item => item.id === message.caseId);
				if (testCase) {
					if (message.merge) {
						const previous = testCase.steps.find(step => step.id === message.step.id);
						if (previous) { previous.value = message.step.value; }
					} else { testCase.steps.push(message.step); }
				}
				state.suiteId = message.suiteId;
				state.caseId = message.caseId;
				render();
				break;
			}
			case 'pickedElement': {
				let testCase = selectedCase();
				let step = testCase?.steps?.find(item => item.id === message.stepId);
				if (!step && testCase && !message.stepId) {
					step = { id: id('step'), command: 'click', target: message.target, value: '' };
					testCase.steps.push(step);
					commit();
				} else if (step) {
					step.target = message.target;
					commit();
				} else { state.status = { message: `Elemento escolhido: ${message.target}. Selecione um caso para usá-lo.`, kind: 'ok' }; render(); }
				break;
			}
			case 'caseRunning': state.status = { message: 'Executando caso de teste…', kind: 'info' }; render(); break;
			case 'stepResult': state.results[message.result.id] = message.result; render(); break;
			case 'caseResult':
				state.results[`case:${message.caseId}`] = message.result;
				state.status = { message: `${message.result.name}: ${message.result.status}.`, kind: message.result.status === 'falhou' ? 'error' : 'ok' };
				render();
				break;
			case 'runComplete':
				state.model.lastResults = message.results;
				state.lastReport = message.report;
				state.status = { message: `Execução concluída: ${message.results.passed} passou, ${message.results.failed} falhou.`, kind: message.results.failed ? 'error' : 'ok' };
				render();
				break;
		}
	});

	render();
	vscode.postMessage({ type: 'ready' });
})();
