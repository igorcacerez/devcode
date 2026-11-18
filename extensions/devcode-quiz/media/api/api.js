// DEV CODE - Cliente de API: editor de uma requisição (webview).
(() => {
	const vscode = acquireVsCodeApi();
	const app = document.getElementById('app');
	let req; let envs = []; let activeEnv = ''; let collection = '';
	let tab = 'params'; let resTab = 'body'; let response; let sending = false; let pretty = true;
	let saveTimer; let refocus;

	const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
	const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => vscode.postMessage({ type: 'update', request: req }), 300); };

	// ---------------------------------------------------------------- URL <-> parâmetros
	function paramsFromUrl() {
		const q = req.url.indexOf('?');
		const disabled = req.params.filter(p => p.on === false);
		if (q < 0) { req.params = disabled; return; }
		const list = req.url.slice(q + 1).split('&').filter(Boolean).map(pair => {
			const [k, ...v] = pair.split('=');
			const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
			return { key: dec(k), value: dec(v.join('=')), on: true };
		});
		req.params = [...list, ...disabled];
	}
	function urlFromParams() {
		const base = req.url.split('?')[0];
		const on = req.params.filter(p => p.on !== false && p.key);
		const enc = s => encodeURIComponent(s).replace(/%7B/g, '{').replace(/%7D/g, '}');
		req.url = on.length ? `${base}?${on.map(p => `${enc(p.key)}=${enc(p.value)}`).join('&')}` : base;
	}

	// ---------------------------------------------------------------- tabela chave/valor
	function kvTable(list, onChange, { files } = {}) {
		const rows = [...list, { key: '', value: '', on: true, _new: true }];
		const wrap = document.createElement('div');
		wrap.className = 'kv';
		wrap.innerHTML = `<div class="kv-row kv-head"><span></span><span>Chave</span><span>Valor</span><span></span></div>` + rows.map((r, i) => `
			<div class="kv-row${r._new ? ' new' : ''}" data-i="${i}">
				<input type="checkbox" data-f="on" ${r.on !== false ? 'checked' : ''} ${r._new ? 'disabled' : ''} title="Ativar/desativar">
				<input type="text" data-f="key" value="${esc(r.key)}" placeholder="${r._new ? 'Nova chave' : ''}">
				${files && r.type === 'file'
		? `<button class="file" data-f="file">${esc(r.value ? r.value.split(/[\\/]/).pop() : 'Escolher arquivo…')}</button>`
		: `<input type="text" data-f="value" value="${esc(r.value)}" placeholder="${r._new ? 'Valor' : ''}">`}
				<span class="kv-actions">
					${files && !r._new ? `<select data-f="type"><option value="text">Texto</option><option value="file" ${r.type === 'file' ? 'selected' : ''}>Arquivo</option></select>` : ''}
					${r._new ? '' : '<button class="icon" data-f="del" title="Remover">✕</button>'}
				</span>
			</div>`).join('');
		wrap.addEventListener('input', e => {
			const row = e.target.closest('.kv-row'); const i = Number(row.dataset.i); const f = e.target.dataset.f;
			if (f !== 'key' && f !== 'value') { return; }
			if (i === list.length) {
				list.push({ key: '', value: '', on: true, ...(files ? { type: 'text' } : {}) });
				list[i][f] = e.target.value;
				refocus = { i, f };
				onChange(true);
				return;
			}
			list[i][f] = e.target.value;
			onChange(false);
		});
		wrap.addEventListener('change', e => {
			const row = e.target.closest('.kv-row'); const i = Number(row.dataset.i); const f = e.target.dataset.f;
			if (f === 'on') { list[i].on = e.target.checked; onChange(true); }
			if (f === 'type') { list[i].type = e.target.value; list[i].value = ''; onChange(true); }
		});
		wrap.addEventListener('click', e => {
			const f = e.target.dataset?.f; if (!f) { return; }
			const i = Number(e.target.closest('.kv-row').dataset.i);
			if (f === 'del') { list.splice(i, 1); onChange(true); }
			if (f === 'file') { vscode.postMessage({ type: 'pickFile', index: i }); }
		});
		if (refocus) {
			const rf = refocus; refocus = undefined;
			setTimeout(() => { const el = wrap.querySelector(`[data-i="${rf.i}"] [data-f="${rf.f}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
		}
		return wrap;
	}

	// ---------------------------------------------------------------- JSON colorido
	function highlight(json) {
		return esc(json).replace(/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, m => {
			const cls = /^"/.test(m) ? (/:$/.test(m) ? 'k' : 's') : /true|false/.test(m) ? 'b' : /null/.test(m) ? 'n' : 'num';
			return `<span class="${cls}">${m}</span>`;
		});
	}
	const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
	const STATUS_TEXT = { 200: 'OK', 201: 'Criado', 204: 'Sem conteúdo', 301: 'Movido', 302: 'Redirecionado', 304: 'Não modificado', 400: 'Requisição inválida', 401: 'Não autorizado', 403: 'Proibido', 404: 'Não encontrado', 405: 'Método não permitido', 409: 'Conflito', 422: 'Dados inválidos', 429: 'Muitas requisições', 500: 'Erro no servidor', 502: 'Gateway inválido', 503: 'Serviço indisponível' };

	// ---------------------------------------------------------------- render
	function render() {
		if (!req) { return; }
		const count = l => l.filter(x => x.on !== false && x.key).length;
		const badge = n => n ? ` <span class="count">${n}</span>` : '';
		const bodyMode = req.body.mode;
		app.innerHTML = `
		<div class="top">
			<div class="crumb"><span>${esc(collection)}</span> / <input id="name" value="${esc(req.name)}" title="Nome da requisição"></div>
			<label class="env">Ambiente
				<select id="env"><option value="">Sem ambiente</option>${envs.map(e => `<option value="${e.id}" ${e.id === activeEnv ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
			</label>
		</div>
		<div class="bar">
			<select id="method" class="m-${req.method}">${window.METHODS.map(m => `<option ${m === req.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
			<input id="url" value="${esc(req.url)}" placeholder="https://api.exemplo.com/recurso  ou  {{base_url}}/usuarios" spellcheck="false">
			<button id="send" class="primary" ${sending ? 'disabled' : ''}>${sending ? 'Enviando…' : 'Enviar'}</button>
		</div>
		<div class="tabs">
			${[['params', 'Parâmetros' + badge(count(req.params))], ['headers', 'Cabeçalhos' + badge(count(req.headers))], ['body', 'Corpo' + (bodyMode !== 'none' ? ' <span class="dot"></span>' : '')], ['auth', 'Autenticação' + (req.auth.type !== 'none' ? ' <span class="dot"></span>' : '')]]
		.map(([id, t]) => `<button class="tab${tab === id ? ' on' : ''}" data-tab="${id}">${t}</button>`).join('')}
		</div>
		<div id="pane" class="pane"></div>
		<div class="res" id="res"></div>`;
		renderPane();
		renderResponse();
	}

	function renderPane() {
		const pane = document.getElementById('pane');
		pane.innerHTML = '';
		if (tab === 'params') {
			pane.append(hint('Parâmetros vão na URL depois do "?" (ex.: ?pagina=2). Editar aqui atualiza a URL.'));
			pane.append(kvTable(req.params, full => { urlFromParams(); document.getElementById('url').value = req.url; save(); if (full) { renderPane(); } }));
		} else if (tab === 'headers') {
			pane.append(hint('Cabeçalhos HTTP (ex.: Accept: application/json). Content-Type e Authorization são preenchidos pelo Corpo e pela Autenticação.'));
			pane.append(kvTable(req.headers, full => { save(); if (full) { renderPane(); } }));
		} else if (tab === 'body') {
			const modes = [['none', 'Nenhum'], ['json', 'JSON'], ['text', 'Texto'], ['urlencoded', 'Formulário (x-www-form-urlencoded)'], ['multipart', 'Formulário com arquivos (multipart)']];
			const row = document.createElement('div');
			row.className = 'modes';
			row.innerHTML = modes.map(([id, t]) => `<label><input type="radio" name="mode" value="${id}" ${req.body.mode === id ? 'checked' : ''}> ${t}</label>`).join('') +
				(req.body.mode === 'json' ? '<button class="link" id="fmt">Formatar JSON</button>' : '');
			pane.append(row);
			if (['GET', 'HEAD'].includes(req.method) && req.body.mode !== 'none') { pane.append(hint(`⚠ Requisições ${req.method} não enviam corpo. Use POST, PUT ou PATCH.`, 'warn')); }
			if (req.body.mode === 'json' || req.body.mode === 'text') {
				const ta = document.createElement('textarea');
				ta.className = 'code'; ta.spellcheck = false; ta.value = req.body.raw;
				ta.placeholder = req.body.mode === 'json' ? '{\n\t"nome": "Maria",\n\t"idade": 20\n}' : 'Texto do corpo';
				ta.addEventListener('input', () => { req.body.raw = ta.value; save(); validateJson(); });
				ta.addEventListener('keydown', e => {
					if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '\t' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 1; ta.dispatchEvent(new Event('input')); }
				});
				pane.append(ta);
				const status = document.createElement('div'); status.id = 'jsonStatus'; status.className = 'hint';
				pane.append(status);
				validateJson();
			} else if (req.body.mode === 'urlencoded' || req.body.mode === 'multipart') {
				pane.append(kvTable(req.body.form, full => { save(); if (full) { renderPane(); } }, { files: req.body.mode === 'multipart' }));
			} else {
				pane.append(hint('Esta requisição não tem corpo.'));
			}
		} else if (tab === 'auth') {
			const a = req.auth;
			const box = document.createElement('div');
			box.className = 'auth';
			box.innerHTML = `
				<label>Tipo <select id="authType"><option value="none">Sem autenticação</option><option value="bearer" ${a.type === 'bearer' ? 'selected' : ''}>Bearer Token (JWT)</option><option value="basic" ${a.type === 'basic' ? 'selected' : ''}>Basic (usuário e senha)</option></select></label>
				${a.type === 'bearer' ? `<label>Token <input id="token" value="${esc(a.token)}" placeholder="eyJhbGciOi…  ou  {{token}}"></label>` : ''}
				${a.type === 'basic' ? `<label>Usuário <input id="user" value="${esc(a.user)}"></label><label>Senha <input id="pass" type="password" value="${esc(a.pass)}"></label>` : ''}`;
			pane.append(box);
			box.querySelector('#authType').addEventListener('change', e => { a.type = e.target.value; save(); render(); });
			for (const id of ['token', 'user', 'pass']) { box.querySelector('#' + id)?.addEventListener('input', e => { a[id] = e.target.value; save(); }); }
			pane.append(hint('Dica: guarde o token numa variável do ambiente (ex.: token) e use {{token}} aqui.'));
		}
	}

	function validateJson() {
		const st = document.getElementById('jsonStatus');
		if (!st || req.body.mode !== 'json') { return; }
		if (!req.body.raw.trim()) { st.textContent = ''; return; }
		try {
			JSON.parse(req.body.raw.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '0'));
			st.textContent = '✔ JSON válido'; st.className = 'hint ok';
		} catch (err) { st.textContent = `✖ JSON inválido: ${err.message}`; st.className = 'hint warn'; }
	}

	function hint(text, cls = '') { const d = document.createElement('div'); d.className = `hint ${cls}`; d.textContent = text; return d; }

	function renderResponse() {
		const box = document.getElementById('res');
		if (!response) {
			box.innerHTML = `<div class="empty-res"><div class="big">🔌</div>Clique em <b>Enviar</b> para ver a resposta da API aqui.<br><span>Atalho: Ctrl+Enter</span></div>`;
			return;
		}
		if (!response.ok) {
			box.innerHTML = `<div class="res-head"><span class="status err">Erro</span><span>${response.time} ms</span></div>
				<div class="error"><b>Não foi possível fazer a requisição.</b><br>${esc(response.error)}${response.hint ? `<p>💡 ${esc(response.hint)}</p>` : ''}</div>`;
			return;
		}
		const cls = response.status < 300 ? 'ok' : response.status < 400 ? 'redir' : 'err';
		let bodyText = response.body ?? '';
		let isJson = false;
		if (/json/i.test(response.contentType) || /^\s*[[{]/.test(bodyText)) {
			try { const obj = JSON.parse(bodyText); isJson = true; if (pretty) { bodyText = JSON.stringify(obj, null, 2); } } catch { }
		}
		box.innerHTML = `
			<div class="res-head">
				<span class="status ${cls}">${response.status} ${esc(response.statusText || STATUS_TEXT[response.status] || '')}</span>
				<span title="Tempo de resposta">⏱ ${response.time} ms</span>
				<span title="Tamanho">📦 ${fmtSize(response.size)}</span>
				<span class="grow"></span>
				${[['body', 'Corpo'], ['headers', `Cabeçalhos (${response.headers.length})`]].map(([id, t]) => `<button class="tab small${resTab === id ? ' on' : ''}" data-restab="${id}">${t}</button>`).join('')}
			</div>
			<div class="res-tools">
				${resTab === 'body' && isJson ? `<label><input type="checkbox" id="pretty" ${pretty ? 'checked' : ''}> Formatado</label>` : ''}
				<span class="grow"></span>
				${resTab === 'body' ? '<button class="link" id="copyRes">Copiar</button><button class="link" id="saveRes">Salvar em arquivo</button>' : ''}
			</div>
			<div class="res-body">${resTab === 'headers'
		? `<table>${response.headers.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`
		: response.image ? `<img src="${response.image}" alt="imagem da resposta">`
			: response.body === undefined ? '<div class="hint">Resposta binária (não é texto).</div>'
				: !bodyText ? '<div class="hint">A resposta veio vazia.</div>'
					: `<pre>${isJson && pretty ? highlight(bodyText) : esc(bodyText)}</pre>`}</div>`;
		box._text = bodyText;
	}

	// ---------------------------------------------------------------- eventos
	function doSend() {
		if (sending) { return; }
		sending = true; response = undefined;
		render();
		vscode.postMessage({ type: 'send', request: req });
	}
	app.addEventListener('input', e => {
		if (e.target.id === 'url') { req.url = e.target.value; paramsFromUrl(); save(); if (tab === 'params') { renderPane(); } }
		if (e.target.id === 'name') { req.name = e.target.value; save(); }
	});
	app.addEventListener('change', e => {
		if (e.target.id === 'method') { req.method = e.target.value; e.target.className = `m-${req.method}`; save(); renderPane(); }
		if (e.target.id === 'env') { activeEnv = e.target.value; vscode.postMessage({ type: 'env', id: activeEnv }); }
		if (e.target.name === 'mode') {
			req.body.mode = e.target.value;
			if (req.body.mode === 'json' && !req.body.raw.trim()) { req.body.raw = '{\n\t\n}'; }
			if (['GET', 'HEAD'].includes(req.method) && req.body.mode !== 'none') { req.method = 'POST'; save(); render(); return; }
			save(); render();
		}
		if (e.target.id === 'pretty') { pretty = e.target.checked; renderResponse(); }
	});
	app.addEventListener('click', e => {
		const t = e.target.closest('[data-tab]');
		if (t) { tab = t.dataset.tab; render(); return; }
		const r = e.target.closest('[data-restab]');
		if (r) { resTab = r.dataset.restab; renderResponse(); return; }
		if (e.target.id === 'send') { doSend(); }
		if (e.target.id === 'fmt') { try { req.body.raw = JSON.stringify(JSON.parse(req.body.raw), null, '\t'); save(); renderPane(); } catch { } }
		if (e.target.id === 'copyRes') { vscode.postMessage({ type: 'copy', text: document.getElementById('res')._text }); }
		if (e.target.id === 'saveRes') { vscode.postMessage({ type: 'saveResponse', text: document.getElementById('res')._text }); }
	});
	document.addEventListener('keydown', e => {
		if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); doSend(); }
		if (e.key === 'Enter' && e.target.id === 'url') { doSend(); }
	});
	window.addEventListener('message', e => {
		const m = e.data;
		if (m.type === 'load') { req = m.request; collection = m.collection; envs = m.envs; activeEnv = m.activeEnv; req.params ||= []; req.headers ||= []; req.body ||= { mode: 'none', raw: '', form: [] }; req.body.form ||= []; req.auth ||= { type: 'none' }; if (!req.params.length && req.url.includes('?')) { paramsFromUrl(); } render(); }
		if (m.type === 'envs') {
			envs = m.envs; activeEnv = m.activeEnv;
			const sel = document.getElementById('env');
			if (sel) { sel.innerHTML = `<option value="">Sem ambiente</option>${envs.map(x => `<option value="${x.id}" ${x.id === activeEnv ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`; }
		}
		if (m.type === 'response') { sending = false; response = m.response; resTab = 'body'; render(); }
		if (m.type === 'file') { req.body.form[m.index].value = m.path; save(); renderPane(); }
	});
	vscode.postMessage({ type: 'ready' });
})();
