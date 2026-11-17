/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Banco de Dados: painel de resultados (grade de registros) e dicionário da tabela.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `
	:root { --red: #D10A0A; --border: var(--vscode-widget-border, #e3e3e3); --muted: var(--vscode-descriptionForeground, #777); }
	body { margin: 0; font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
	.bar { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 2; flex-wrap: wrap; align-items: center; }
	.tab { border: 1px solid var(--border); background: transparent; color: inherit; padding: 4px 10px; border-radius: 6px; cursor: pointer; font: inherit; }
	.tab.on { border-color: var(--red); background: #D10A0A14; }
	.tab.err { color: var(--red); }
	.conn { margin-left: auto; color: var(--muted); }
	.res { display: none; padding: 10px 12px; }
	.res.on { display: block; }
	pre.sql { margin: 0 0 8px; padding: 8px 10px; background: var(--vscode-textCodeBlock-background, #f3f3f3); border-radius: 6px; max-height: 90px; overflow: auto; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre-wrap; }
	.meta { color: var(--muted); margin-bottom: 8px; }
	.error { color: var(--red); padding: 10px; border: 1px solid #D10A0A55; border-radius: 6px; background: #D10A0A0d; white-space: pre-wrap; }
	.ok { padding: 10px; border: 1px solid #2e7d3255; border-radius: 6px; background: #2e7d320d; }
	.grid { overflow: auto; max-height: calc(100vh - 150px); border: 1px solid var(--border); border-radius: 6px; }
	table { border-collapse: collapse; font-family: var(--vscode-editor-font-family); font-size: 12px; width: max-content; min-width: 100%; }
	th, td { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 4px 10px; text-align: left; white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
	th { position: sticky; top: 0; background: var(--vscode-editorWidget-background, #f6f6f6); cursor: pointer; user-select: none; }
	th:hover { color: var(--red); }
	td.n { text-align: right; color: var(--vscode-debugTokenExpression-number, #098658); }
	td.null { color: var(--muted); font-style: italic; }
	tr:hover td { background: #0000000a; }
	td.rownum, th.rownum { color: var(--muted); text-align: right; background: var(--vscode-editorWidget-background, #f6f6f6); }
	input.filter { border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font: inherit; background: var(--vscode-input-background); color: inherit; min-width: 220px; }
	h2 { font-size: 15px; margin: 4px 0 10px; }
	h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 18px 0 6px; }
	.badge { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 11px; margin-left: 4px; }
	.pk { background: #f5c51833; color: #8a6d00; } .fk { background: #0d99ff22; color: #0b6fb8; } .nn { background: #0000000f; }
	pre.ddl { padding: 10px; background: var(--vscode-textCodeBlock-background, #f3f3f3); border-radius: 6px; font-family: var(--vscode-editor-font-family); font-size: 12px; overflow: auto; }
`;

class ResultsPanel {
	constructor(context) { this.context = context; this.panel = undefined; }

	ensure(title) {
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('devcode.db.results', title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
			this.panel.iconPath = new vscode.ThemeIcon('database');
			this.panel.onDidDispose(() => { this.panel = undefined; });
		}
		this.panel.title = title;
		this.panel.reveal(vscode.ViewColumn.Beside, true);
		return this.panel;
	}

	show(connName, results) {
		const p = this.ensure(`Resultado · ${connName}`);
		const tabs = results.map((r, i) => `<button class="tab ${i === results.length - 1 ? 'on' : ''} ${r.error ? 'err' : ''}" data-i="${i}">${r.error ? '✖' : r.columns?.length ? '▦' : '✔'} ${i + 1}</button>`).join('');
		const bodies = results.map((r, i) => {
			let body;
			if (r.error) { body = `<div class="error">Erro: ${esc(r.error)}</div>`; }
			else if (r.columns?.length) {
				const head = `<tr><th class="rownum">#</th>${r.columns.map((c, ci) => `<th data-c="${ci}" title="Clique para ordenar">${esc(c)}</th>`).join('')}</tr>`;
				const rows = r.rows.map((row, ri) => `<tr><td class="rownum">${ri + 1}</td>${row.map(v => v === null ? '<td class="null">NULL</td>' : `<td class="${typeof v === 'number' ? 'n' : ''}" title="${esc(v)}">${esc(v)}</td>`).join('')}</tr>`).join('');
				body = `<div class="meta">${r.rows.length} registro(s) · ${r.ms} ms${r.info ? ` · ${esc(r.info)}` : ''}</div>
					<div class="bar" style="position:static;border:0;padding:0 0 8px"><input class="filter" placeholder="Filtrar registros…"></div>
					<div class="grid"><table>${head}${rows}</table></div>`;
			} else {
				body = `<div class="ok">✔ Executado com sucesso${r.affected !== undefined ? ` · ${r.affected} linha(s) afetada(s)` : ''}${r.info ? ` · ${esc(r.info)}` : ''} · ${r.ms} ms</div>`;
			}
			return `<div class="res ${i === results.length - 1 ? 'on' : ''}" data-i="${i}"><pre class="sql">${esc(r.sql)}</pre>${body}</div>`;
		}).join('');
		p.webview.html = this.page(`<div class="bar">${tabs}<span class="conn">${esc(connName)} · ${results.length} instrução(ões)</span></div>${bodies}`);
	}

	showDictionary(connName, table, { cols, pk, fks, idx, trg, ddl }) {
		const p = this.ensure(`Dicionário · ${table}`);
		const fkCols = new Map(); fks.forEach(f => f.columns.forEach((c, i) => fkCols.set(c, `${f.refTable}.${f.refColumns[i]}`)));
		const colRows = cols.map((c, i) => `<tr><td class="rownum">${i + 1}</td><td><b>${esc(c.name)}</b>${pk.includes(c.name) ? '<span class="badge pk">PK</span>' : ''}${fkCols.has(c.name) ? '<span class="badge fk">FK</span>' : ''}</td><td>${esc(c.type)}</td><td>${c.nullable ? 'sim' : '<span class="badge nn">NOT NULL</span>'}</td><td>${esc(c.default ?? '')}</td><td>${esc(fkCols.get(c.name) || '')}</td></tr>`).join('');
		const tableOf = (head, rows) => rows.length ? `<div class="grid"><table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table></div>` : '<div class="meta">nenhum(a)</div>';
		const html = `<div class="res on" style="display:block"><h2>🗂 ${esc(table)} <span class="meta">· ${esc(connName)}</span></h2>
			<h3>Colunas</h3>${tableOf(['#', 'Coluna', 'Tipo', 'Nulo?', 'Padrão', 'Referência'], [colRows])}
			<h3>Chave primária</h3><div>${pk.length ? pk.map(esc).join(', ') : '<span class="meta">sem chave primária</span>'}</div>
			<h3>Chaves estrangeiras</h3>${tableOf(['Nome', 'Colunas', 'Referencia', 'Ao atualizar', 'Ao excluir'], fks.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.columns.join(', '))}</td><td>${esc(f.refTable)} (${esc(f.refColumns.join(', '))})</td><td>${esc(f.onUpdate)}</td><td>${esc(f.onDelete)}</td></tr>`))}
			<h3>Índices</h3>${tableOf(['Nome', 'Colunas', 'Único'], idx.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.columns.join(', '))}</td><td>${i.unique ? 'sim' : 'não'}</td></tr>`))}
			<h3>Triggers</h3>${tableOf(['Nome', 'Quando', 'Ativa'], trg.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.timing)}</td><td>${t.active ? 'sim' : 'não'}</td></tr>`))}
			<h3>DDL (script de criação)</h3><pre class="ddl">${esc(ddl)}</pre></div>`;
		p.webview.html = this.page(html);
	}

	page(body) {
		const nonce = Math.random().toString(36).slice(2);
		return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${STYLE}</style></head><body>${body}
<script nonce="${nonce}">
	document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
		document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
		document.querySelectorAll('.res').forEach(r => r.classList.toggle('on', r.dataset.i === t.dataset.i));
	}));
	document.querySelectorAll('input.filter').forEach(inp => inp.addEventListener('input', () => {
		const q = inp.value.toLowerCase();
		inp.closest('.res').querySelectorAll('tr').forEach((tr, i) => { if (i > 0) { tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; } });
	}));
	document.querySelectorAll('th[data-c]').forEach(th => th.addEventListener('click', () => {
		const table = th.closest('table'); const c = +th.dataset.c + 1; const asc = th.dataset.asc !== '1'; th.dataset.asc = asc ? '1' : '0';
		const rows = [...table.querySelectorAll('tr')].slice(1);
		rows.sort((a, b) => { const x = a.children[c].textContent, y = b.children[c].textContent; const nx = parseFloat(x), ny = parseFloat(y);
			const r = !isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y, 'pt-BR'); return asc ? r : -r; });
		rows.forEach(r => table.appendChild(r));
	}));
</script></body></html>`;
	}
}

module.exports = { ResultsPanel };
