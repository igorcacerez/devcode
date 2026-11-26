/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Live Server embutido (sem dependências).
 *  Serve a pasta do projeto via HTTP e recarrega a página automaticamente a cada
 *  arquivo salvo (Server-Sent Events injetado nas páginas .html).
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
	'.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
	'.webp': 'image/webp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.wav': 'audio/wav',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

const RELOAD_PATH = '/__devcode_reload';
const RELOAD_SCRIPT = `<script>(function(){var s=new EventSource('${RELOAD_PATH}');s.onmessage=function(e){if(e.data==='css'){document.querySelectorAll('link[rel=stylesheet]').forEach(function(l){var u=new URL(l.href);u.searchParams.set('_r',Date.now());l.href=u.href;});}else{location.reload();}};})();</script>`;

class LiveServer {
	constructor() {
		this.server = undefined;
		this.root = undefined;
		this.port = undefined;
		this.clients = new Set();
		this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.disposables = [this.statusItem];
		this.updateStatus();
		this.statusItem.show();
	}

	get running() { return !!this.server; }

	updateStatus() {
		if (this.running) {
			this.statusItem.text = `$(broadcast) Porta ${this.port}`;
			this.statusItem.tooltip = 'DEV CODE Live Server rodando: clique para parar';
			this.statusItem.command = 'devcode.liveServer.stop';
		} else {
			this.statusItem.text = '$(globe) Go Live';
			this.statusItem.tooltip = 'Abrir o projeto HTML no navegador com recarga automática';
			this.statusItem.command = 'devcode.liveServer.start';
		}
	}

	async start(root, openFile, external = false) {
		if (this.running && this.root !== root) { this.stop(); }
		if (!this.running) {
			this.root = root;
			this.server = http.createServer((req, res) => this.handle(req, res));
			this.port = await this.listen(5500);
			this.disposables.push(vscode.workspace.onDidSaveTextDocument(doc => {
				if (doc.uri.fsPath.startsWith(this.root)) {
					this.broadcast(doc.languageId === 'css' ? 'css' : 'reload');
				}
			}));
			this.updateStatus();
		}
		const rel = openFile ? path.relative(root, openFile).split(path.sep).join('/') : '';
		const url = `http://127.0.0.1:${this.port}/${rel.endsWith('.html') || rel.endsWith('.htm') ? rel : ''}`;
		await this.open(url, external);
	}

	async open(url, external = false) {
		const where = vscode.workspace.getConfiguration('devcode').get('liveServer.browser', 'interno');
		if (external || where === 'externo') {
			await vscode.env.openExternal(vscode.Uri.parse(url));
		} else {
			// navegador embutido do VS Code (extensão simple-browser), ao lado do código
			await vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(url), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true })
				.then(undefined, () => vscode.env.openExternal(vscode.Uri.parse(url)));
		}
	}

	listen(port) {
		return new Promise((resolve, reject) => {
			const tryPort = p => {
				this.server.once('error', err => err.code === 'EADDRINUSE' && p < port + 50 ? tryPort(p + 1) : reject(err));
				this.server.listen(p, '127.0.0.1', () => resolve(p));
			};
			tryPort(port);
		});
	}

	broadcast(msg) {
		for (const res of this.clients) { res.write(`data: ${msg}\n\n`); }
	}

	handle(req, res) {
		const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
		if (urlPath === RELOAD_PATH) {
			res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
			res.write('retry: 1000\n\n');
			this.clients.add(res);
			req.on('close', () => this.clients.delete(res));
			return;
		}
		let file = path.normalize(path.join(this.root, urlPath));
		if (!file.startsWith(this.root)) { res.writeHead(403); res.end('Proibido'); return; }
		if (fs.existsSync(file) && fs.statSync(file).isDirectory()) { file = path.join(file, 'index.html'); }
		if (!fs.existsSync(file)) {
			res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(`<h2>404: arquivo não encontrado</h2><p>${urlPath}</p>${RELOAD_SCRIPT}`);
			return;
		}
		const ext = path.extname(file).toLowerCase();
		const type = MIME[ext] || 'application/octet-stream';
		const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
		if (ext === '.html' || ext === '.htm') {
			let html = fs.readFileSync(file, 'utf8');
			html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, RELOAD_SCRIPT + '</body>') : html + RELOAD_SCRIPT;
			res.writeHead(200, headers);
			res.end(html);
		} else {
			res.writeHead(200, headers);
			fs.createReadStream(file).pipe(res);
		}
	}

	stop() {
		if (!this.server) { return; }
		for (const res of this.clients) { res.end(); }
		this.clients.clear();
		this.server.close();
		this.server = undefined;
		// remove o watcher de salvamento (último registrado)
		const w = this.disposables.pop();
		if (w && w !== this.statusItem) { w.dispose(); }
		this.updateStatus();
		vscode.window.setStatusBarMessage('DEV CODE: Live Server parado.', 3000);
	}

	dispose() {
		this.stop();
		this.disposables.forEach(d => d.dispose());
	}
}

module.exports = { LiveServer };
