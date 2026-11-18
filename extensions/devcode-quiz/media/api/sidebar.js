// DEV CODE - Cliente de API: barra lateral (coleções, histórico e ambientes).
(() => {
	const vscode = acquireVsCodeApi();
	const app = document.getElementById('app');
	let data; let filter = '';
	const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
	const send = (type, extra) => vscode.postMessage({ type, ...extra });
	const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'agora' : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`; };

	function render() {
		if (!data) { return; }
		const q = filter.toLowerCase();
		const env = data.envs.find(e => e.id === data.activeEnv);
		const a = [];
		a.push('<div class="actions"><button class="btn" data-a="newRequest">＋ Nova requisição</button></div>');
		a.push('<div class="actions"><button class="btn sec" data-a="newCollection">＋ Coleção</button><button class="btn sec" data-a="importCurl">Importar cURL</button></div>');
		a.push(`<input id="filter" placeholder="Filtrar requisições" value="${esc(filter)}">`);
		a.push('<h3>Coleções</h3>');
		if (!data.collections.length) { a.push('<div class="muted">Nenhuma coleção. Crie uma para organizar as requisições da sua API.</div>'); }
		for (const c of data.collections) {
			const reqs = c.requests.filter(r => !q || (r.name + ' ' + r.url).toLowerCase().includes(q));
			if (q && !reqs.length) { continue; }
			a.push(`<div class="row" data-a="toggle" data-id="${c.id}"><span>${c.open || q ? '▾' : '▸'} 📁</span><span class="name"><b>${esc(c.name)}</b></span>
				<span class="tools"><button data-a="newRequest" data-collection="${c.id}" title="Nova requisição nesta coleção">＋</button><button data-a="rename" data-id="${c.id}" title="Renomear">✎</button><button data-a="delete" data-id="${c.id}" title="Apagar">🗑</button></span></div>`);
			if (c.open || q) {
				if (!reqs.length) { a.push('<div class="muted req">Vazia. Clique em ＋ para adicionar.</div>'); }
				for (const r of reqs) {
					a.push(`<div class="row req" data-a="open" data-id="${r.id}" title="${esc(r.url)}"><span class="m ${r.method}">${r.method}</span><span class="name">${esc(r.name)}</span>
						<span class="tools"><button data-a="duplicate" data-id="${r.id}" title="Duplicar">⧉</button><button data-a="rename" data-id="${r.id}" title="Renomear">✎</button><button data-a="delete" data-id="${r.id}" title="Apagar">🗑</button></span></div>`);
				}
			}
		}
		a.push(`<h3>Ambiente <button data-a="newEnv">＋ Novo</button></h3>`);
		a.push(`<select id="env"><option value="">Sem ambiente</option>${data.envs.map(e => `<option value="${e.id}" ${e.id === data.activeEnv ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`);
		if (env) {
			a.push('<div class="muted">Use as variáveis na URL, cabeçalhos ou corpo como <b>{{nome}}</b>.</div>');
			const vars = [...env.vars, { key: '', value: '', on: true, _new: true }];
			for (let i = 0; i < vars.length; i++) {
				const v = vars[i];
				a.push(`<div class="vars" data-i="${i}"><input type="checkbox" data-f="on" ${v.on !== false ? 'checked' : ''} ${v._new ? 'disabled' : ''}><input data-f="key" value="${esc(v.key)}" placeholder="${v._new ? 'nova variável' : ''}"><input data-f="value" value="${esc(v.value)}" placeholder="${v._new ? 'valor' : ''}">${v._new ? '<span></span>' : '<button data-f="del" title="Remover">✕</button>'}</div>`);
			}
			a.push(`<div class="actions"><button class="btn sec" data-a="deleteEnv" data-id="${env.id}">Apagar ambiente</button></div>`);
		}
		a.push(`<h3>Histórico ${data.history.length ? '<button data-a="clearHistory">Limpar</button>' : ''}</h3>`);
		if (!data.history.length) { a.push('<div class="muted">As requisições enviadas aparecem aqui.</div>'); }
		for (const h of data.history.slice(0, 30)) {
			if (q && !h.url.toLowerCase().includes(q)) { continue; }
			a.push(`<div class="row" data-a="fromHistory" data-id="${h.id}" title="Abrir de novo (salva na coleção Histórico)"><span class="m ${h.method}">${h.method}</span><span class="name">${esc(h.url)}</span><span class="when">${ago(h.at)}</span></div>`);
		}
		const focused = document.activeElement;
		const keep = focused?.id === 'filter' ? { id: 'filter', pos: focused.selectionStart } : focused?.dataset?.f ? { i: focused.closest('.vars')?.dataset.i, f: focused.dataset.f, pos: focused.selectionStart } : undefined;
		app.innerHTML = a.join('');
		if (keep?.id) { const el = document.getElementById('filter'); el.focus(); el.setSelectionRange(keep.pos, keep.pos); }
		else if (keep?.f && keep.i !== undefined) { const el = app.querySelector(`.vars[data-i="${keep.i}"] [data-f="${keep.f}"]`); if (el) { el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch { } } }
	}

	function envVars() { return data.envs.find(e => e.id === data.activeEnv)?.vars; }
	let envTimer;
	app.addEventListener('input', e => {
		if (e.target.id === 'filter') { filter = e.target.value; render(); return; }
		const row = e.target.closest('.vars'); if (!row) { return; }
		const vars = envVars(); const i = Number(row.dataset.i); const f = e.target.dataset.f;
		if (i === vars.length) { vars.push({ key: '', value: '', on: true }); }
		vars[i][f] = e.target.value;
		clearTimeout(envTimer);
		envTimer = setTimeout(() => send('saveEnv', { id: data.activeEnv, vars }), 400);
		if (i === vars.length - 1) { render(); }
	});
	app.addEventListener('change', e => {
		if (e.target.id === 'env') { send('env', { id: e.target.value }); return; }
		const row = e.target.closest('.vars');
		if (row && e.target.dataset.f === 'on') { const vars = envVars(); vars[Number(row.dataset.i)].on = e.target.checked; send('saveEnv', { id: data.activeEnv, vars }); }
	});
	app.addEventListener('click', e => {
		const del = e.target.closest('[data-f="del"]');
		if (del) { const vars = envVars(); vars.splice(Number(del.closest('.vars').dataset.i), 1); send('saveEnv', { id: data.activeEnv, vars }); render(); return; }
		const el = e.target.closest('[data-a]');
		if (!el) { return; }
		e.stopPropagation();
		send(el.dataset.a, { id: el.dataset.id, collection: el.dataset.collection });
	});
	window.addEventListener('message', e => { if (e.data.type === 'state') { data = e.data.data; render(); } });
	send('ready');
})();
