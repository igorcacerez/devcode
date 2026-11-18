/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Cliente de API (estilo Postman).
 *    - Barra lateral: coleções, requisições salvas, histórico e ambientes (variáveis {{nome}}).
 *    - Editor: método, URL, parâmetros, cabeçalhos, corpo (JSON, texto, formulário, multipart),
 *      autenticação (Bearer / Basic), resposta formatada com status, tempo, tamanho e cabeçalhos.
 *  As requisições saem do processo da extensão (Node), então não há bloqueio de CORS.
 *  Tudo fica salvo na pasta do usuário (vale para todos os projetos).
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const uid = () => Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------------ armazenamento
class Store {
	constructor(context) {
		this.file = path.join(context.globalStorageUri.fsPath, 'api-client.json');
		this.listeners = [];
		try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = undefined; }
		if (!this.data) {
			this.data = {
				collections: [{ id: uid(), name: 'Exemplos', open: true, requests: [
					newRequest({ name: 'Listar posts (GET)', url: 'https://jsonplaceholder.typicode.com/posts?_limit=5' }),
					newRequest({ name: 'Criar post (POST)', method: 'POST', url: 'https://jsonplaceholder.typicode.com/posts', body: { mode: 'json', raw: '{\n\t"title": "Meu post",\n\t"body": "Olá, API!",\n\t"userId": 1\n}', form: [] } }),
				] }],
				envs: [{ id: uid(), name: 'Local', vars: [{ key: 'base_url', value: 'http://localhost:3000', on: true }] }],
				activeEnv: '',
				history: [],
			};
		}
	}
	save() {
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1));
		for (const fn of this.listeners) { fn(); }
	}
	onChange(fn) { this.listeners.push(fn); }
	findRequest(id) {
		for (const c of this.data.collections) {
			const r = c.requests.find(x => x.id === id);
			if (r) { return { collection: c, request: r }; }
		}
		return undefined;
	}
	vars() {
		const env = this.data.envs.find(e => e.id === this.data.activeEnv);
		const out = {};
		for (const v of env?.vars || []) { if (v.on !== false && v.key) { out[v.key.trim()] = v.value; } }
		return out;
	}
}

function newRequest(over = {}) {
	return {
		id: uid(), name: 'Nova requisição', method: 'GET', url: '',
		params: [], headers: [], body: { mode: 'none', raw: '', form: [] }, auth: { type: 'none', token: '', user: '', pass: '' },
		...over,
	};
}

// ------------------------------------------------------------------ envio
function substitute(text, vars) {
	return String(text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, k) => (k in vars ? vars[k] : all));
}

async function send(req, vars) {
	const sub = t => substitute(t, vars);
	let url = sub(req.url).trim();
	if (!url) { throw new Error('Digite a URL da requisição.'); }
	if (!/^[a-z]+:\/\//i.test(url)) { url = 'http://' + url; }
	const u = new URL(url);
	for (const p of req.params || []) { if (p.on !== false && p.key) { u.searchParams.append(sub(p.key), sub(p.value)); } }
	const headers = new Headers();
	for (const h of req.headers || []) { if (h.on !== false && h.key) { headers.set(sub(h.key), sub(h.value)); } }
	const a = req.auth || {};
	if (a.type === 'bearer' && a.token) { headers.set('Authorization', `Bearer ${sub(a.token)}`); }
	if (a.type === 'basic') { headers.set('Authorization', 'Basic ' + Buffer.from(`${sub(a.user)}:${sub(a.pass)}`).toString('base64')); }
	let body;
	const b = req.body || {};
	if (!['GET', 'HEAD'].includes(req.method)) {
		if (b.mode === 'json') {
			body = sub(b.raw);
			if (!headers.has('Content-Type')) { headers.set('Content-Type', 'application/json'); }
		} else if (b.mode === 'text') {
			body = sub(b.raw);
			if (!headers.has('Content-Type')) { headers.set('Content-Type', 'text/plain'); }
		} else if (b.mode === 'urlencoded') {
			body = new URLSearchParams((b.form || []).filter(f => f.on !== false && f.key).map(f => [sub(f.key), sub(f.value)])).toString();
			if (!headers.has('Content-Type')) { headers.set('Content-Type', 'application/x-www-form-urlencoded'); }
		} else if (b.mode === 'multipart') {
			body = new FormData();
			for (const f of (b.form || []).filter(x => x.on !== false && x.key)) {
				if (f.type === 'file' && f.value) {
					const buf = fs.readFileSync(f.value);
					body.append(sub(f.key), new Blob([buf]), path.basename(f.value));
				} else { body.append(sub(f.key), sub(f.value)); }
			}
		}
	}
	const started = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 60000);
	try {
		const res = await fetch(u, { method: req.method, headers, body, redirect: 'follow', signal: controller.signal });
		const buf = Buffer.from(await res.arrayBuffer());
		const type = res.headers.get('content-type') || '';
		const isText = !type || /json|text|xml|html|javascript|csv|x-www-form-urlencoded/i.test(type);
		return {
			ok: true, status: res.status, statusText: res.statusText, time: Date.now() - started, size: buf.length,
			url: u.toString(), contentType: type,
			headers: [...res.headers.entries()],
			body: isText ? buf.toString('utf8') : undefined,
			image: /^image\//.test(type) ? `data:${type};base64,${buf.toString('base64')}` : undefined,
		};
	} catch (err) {
		const cause = err.cause?.code || err.cause?.message || '';
		const hint = /ECONNREFUSED/.test(cause) ? 'O servidor não está rodando nesse endereço/porta (conexão recusada). Inicie a sua API e tente de novo.'
			: /ENOTFOUND|EAI_AGAIN/.test(cause) ? 'Endereço não encontrado. Confira a URL e a internet.'
				: err.name === 'AbortError' ? 'A API demorou mais de 60 segundos para responder.'
					: /CERT|SSL|TLS/i.test(cause) ? 'Problema no certificado HTTPS do servidor.' : '';
		return { ok: false, error: `${err.message}${cause ? ` (${cause})` : ''}`, hint, time: Date.now() - started };
	} finally { clearTimeout(timer); }
}

// ------------------------------------------------------------------ editor da requisição
const editors = new Map(); // id da requisição -> painel

function openRequest(context, store, id) {
	const found = store.findRequest(id);
	if (!found) { return; }
	const existing = editors.get(id);
	if (existing) { existing.reveal(); return; }
	const panel = vscode.window.createWebviewPanel('devcode.api.request', `${found.request.method} ${found.request.name}`, vscode.ViewColumn.Active, {
		enableScripts: true, retainContextWhenHidden: true,
		localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media', 'api')],
	});
	panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'api.svg');
	editors.set(id, panel);
	panel.onDidDispose(() => editors.delete(id));
	const media = f => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'api', f));
	const nonce = uid() + uid();
	panel.webview.html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${panel.webview.cspSource}; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media('api.css')}"></head><body><div id="app"></div>
<script nonce="${nonce}">window.METHODS = ${JSON.stringify(METHODS)};</script>
<script nonce="${nonce}" src="${media('api.js')}"></script></body></html>`;
	const post = () => {
		const f = store.findRequest(id);
		if (!f) { panel.dispose(); return; }
		panel.title = `${f.request.method} ${f.request.name}`;
		panel.webview.postMessage({ type: 'load', request: f.request, collection: f.collection.name, envs: store.data.envs, activeEnv: store.data.activeEnv });
	};
	panel.webview.onDidReceiveMessage(async m => {
		const f = store.findRequest(id);
		if (!f) { return; }
		switch (m.type) {
			case 'ready': post(); break;
			case 'update': Object.assign(f.request, m.request, { id }); panel.title = `${f.request.method} ${f.request.name}`; store.save(); break;
			case 'env': store.data.activeEnv = m.id; store.save(); break;
			case 'pickFile': {
				const pick = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Enviar este arquivo' });
				if (pick?.[0]) { panel.webview.postMessage({ type: 'file', index: m.index, path: pick[0].fsPath }); }
				break;
			}
			case 'send': {
				Object.assign(f.request, m.request, { id });
				store.data.history.unshift({ id: uid(), at: Date.now(), method: f.request.method, url: substitute(f.request.url, store.vars()), request: JSON.parse(JSON.stringify(f.request)) });
				store.data.history = store.data.history.slice(0, 50);
				store.save();
				const res = await send(f.request, store.vars());
				panel.webview.postMessage({ type: 'response', response: res });
				break;
			}
			case 'copy': await vscode.env.clipboard.writeText(m.text); vscode.window.setStatusBarMessage('$(check) DEV CODE: copiado.', 2000); break;
			case 'saveResponse': {
				const target = await vscode.window.showSaveDialog({ saveLabel: 'Salvar resposta', filters: { 'JSON': ['json'], 'Texto': ['txt'] } });
				if (target) { fs.writeFileSync(target.fsPath, m.text); }
				break;
			}
		}
	});
	store.onChange(() => { if (editors.get(id) === panel) { panel.webview.postMessage({ type: 'envs', envs: store.data.envs, activeEnv: store.data.activeEnv }); } });
}

// ------------------------------------------------------------------ barra lateral
class ApiSidebar {
	constructor(context, store) { this.context = context; this.store = store; store.onChange(() => this.refresh()); }
	resolveWebviewView(view) {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media', 'api')] };
		const nonce = uid() + uid();
		const media = f => view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'api', f));
		view.webview.html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${media('sidebar.css')}"></head><body><div id="app"></div>
<script nonce="${nonce}" src="${media('sidebar.js')}"></script></body></html>`;
		view.webview.onDidReceiveMessage(m => this.onMessage(m));
	}
	refresh() { this.view?.webview.postMessage({ type: 'state', data: this.store.data }); }
	async onMessage(m) {
		const d = this.store.data;
		const ask = (title, value) => vscode.window.showInputBox({ title, value, ignoreFocusOut: true, validateInput: v => v.trim() ? undefined : 'Digite um nome' });
		switch (m.type) {
			case 'ready': return this.refresh();
			case 'open': return openRequest(this.context, this.store, m.id);
			case 'newCollection': {
				const name = await ask('Nome da nova coleção', 'Minha API');
				if (name) { d.collections.push({ id: uid(), name: name.trim(), open: true, requests: [] }); }
				break;
			}
			case 'newRequest': {
				let col = d.collections.find(c => c.id === m.collection);
				if (!col) {
					if (!d.collections.length) { d.collections.push({ id: uid(), name: 'Minha API', open: true, requests: [] }); }
					col = d.collections[0];
				}
				const r = newRequest();
				col.requests.push(r); col.open = true;
				this.store.save();
				return openRequest(this.context, this.store, r.id);
			}
			case 'toggle': { const c = d.collections.find(x => x.id === m.id); if (c) { c.open = !c.open; } break; }
			case 'rename': {
				const c = d.collections.find(x => x.id === m.id) || this.store.findRequest(m.id)?.request;
				const name = c && await ask('Novo nome', c.name);
				if (name) { c.name = name.trim(); }
				break;
			}
			case 'duplicate': {
				const f = this.store.findRequest(m.id);
				if (f) { f.collection.requests.push({ ...JSON.parse(JSON.stringify(f.request)), id: uid(), name: `${f.request.name} (cópia)` }); }
				break;
			}
			case 'delete': {
				const c = d.collections.find(x => x.id === m.id);
				const f = !c && this.store.findRequest(m.id);
				const label = c ? `a coleção "${c.name}" e todas as suas requisições` : f ? `a requisição "${f.request.name}"` : '';
				if (!label || await vscode.window.showWarningMessage(`Apagar ${label}?`, { modal: true }, 'Apagar') !== 'Apagar') { return; }
				if (c) { d.collections = d.collections.filter(x => x !== c); } else { f.collection.requests = f.collection.requests.filter(x => x !== f.request); editors.get(m.id)?.dispose(); }
				break;
			}
			case 'fromHistory': {
				const h = d.history.find(x => x.id === m.id);
				if (!h) { return; }
				let col = d.collections.find(c => c.name === 'Histórico');
				if (!col) { col = { id: uid(), name: 'Histórico', open: true, requests: [] }; d.collections.push(col); }
				const r = { ...JSON.parse(JSON.stringify(h.request)), id: uid() };
				col.requests.push(r);
				this.store.save();
				return openRequest(this.context, this.store, r.id);
			}
			case 'clearHistory': d.history = []; break;
			case 'env': d.activeEnv = m.id; break;
			case 'newEnv': {
				const name = await ask('Nome do ambiente', 'Produção');
				if (name) { const e = { id: uid(), name: name.trim(), vars: [] }; d.envs.push(e); d.activeEnv = e.id; }
				break;
			}
			case 'saveEnv': { const e = d.envs.find(x => x.id === m.id); if (e) { e.vars = m.vars; } break; }
			case 'deleteEnv': {
				const e = d.envs.find(x => x.id === m.id);
				if (!e || await vscode.window.showWarningMessage(`Apagar o ambiente "${e.name}"?`, { modal: true }, 'Apagar') !== 'Apagar') { return; }
				d.envs = d.envs.filter(x => x !== e);
				if (d.activeEnv === e.id) { d.activeEnv = ''; }
				break;
			}
			case 'importCurl': {
				const text = await vscode.window.showInputBox({ title: 'Importar cURL', placeHolder: 'curl -X POST https://... -H "Content-Type: application/json" -d \'{...}\'', ignoreFocusOut: true });
				if (!text) { return; }
				try {
					const r = parseCurl(text);
					let col = d.collections[0];
					if (!col) { col = { id: uid(), name: 'Minha API', open: true, requests: [] }; d.collections.push(col); }
					col.requests.push(r); col.open = true;
					this.store.save();
					return openRequest(this.context, this.store, r.id);
				} catch (err) { vscode.window.showErrorMessage(`DEV CODE: cURL inválido. ${err.message}`); return; }
			}
		}
		this.store.save();
	}
}

/** Converte um comando cURL (copiado da documentação de uma API) numa requisição. */
function parseCurl(text) {
	const tokens = [];
	const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g;
	let m;
	const clean = text.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
	while ((m = re.exec(clean))) { tokens.push(m[1] ?? m[2] ?? m[3]); }
	if (!/^curl(\.exe)?$/i.test(tokens[0] || '')) { throw new Error('O comando deve começar com "curl".'); }
	const r = newRequest({ name: 'Importada do cURL' });
	let data;
	for (let i = 1; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === '-X' || t === '--request') { r.method = tokens[++i].toUpperCase(); }
		else if (t === '-H' || t === '--header') { const [k, ...v] = tokens[++i].split(':'); r.headers.push({ key: k.trim(), value: v.join(':').trim(), on: true }); }
		else if (/^(-d|--data|--data-raw|--data-binary)$/.test(t)) { data = tokens[++i]; }
		else if (t === '-u' || t === '--user') { const [user, ...pass] = tokens[++i].split(':'); r.auth = { type: 'basic', user, pass: pass.join(':'), token: '' }; }
		else if (/^https?:\/\//i.test(t)) { r.url = t; }
		else if (t === '--url') { r.url = tokens[++i]; }
	}
	if (data !== undefined) {
		if (r.method === 'GET') { r.method = 'POST'; }
		let json = false;
		try { JSON.parse(data); json = true; } catch { }
		r.body = { mode: json ? 'json' : 'text', raw: data, form: [] };
		if (json) { r.headers = r.headers.filter(h => h.key.toLowerCase() !== 'content-type'); }
	}
	try { r.name = `${r.method} ${new URL(r.url).pathname}`; } catch { }
	return r;
}

function registerApiClient(context) {
	const store = new Store(context);
	const sidebar = new ApiSidebar(context, store);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('devcode.api.sidebar', sidebar, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('devcode.api.newRequest', () => sidebar.onMessage({ type: 'newRequest' })),
	);
}

module.exports = { registerApiClient, send, substitute, parseCurl, newRequest };
