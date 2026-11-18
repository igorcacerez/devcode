/*---------------------------------------------------------------------------------------------
 *  DEV CODE - vigia de arquivos do projeto.
 *
 *  Todo arquivo de código do projeto precisa ter "nascido" dentro da IDE:
 *    - criado pelo Explorer / assistente de projeto (vazio), ou
 *    - salvo pelo editor (o conteúdo no disco é igual ao que o editor salvou).
 *  Se um arquivo de código aparece ou muda no disco por fora (colado pelo Windows Explorer,
 *  baixado do navegador direto na pasta, copiado de um pendrive…):
 *    - arquivo NOVO   → é excluído (vai para a lixeira);
 *    - arquivo ALTERADO → volta ao último conteúdo conhecido.
 *  Imagens, áudios e vídeos são sempre permitidos.
 *
 *  O estado (hash + cópia de cada arquivo) fica no storage da extensão, FORA da pasta do
 *  projeto, então arquivos colados com a IDE fechada também são detectados ao abrir.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const MEDIA = /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?|avif|heic|mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|mp4|webm|mkv|mov|avi|wmv|m4v|ogv|fdb|db|sqlite|sqlite3|db3|db-journal|db-wal|db-shm)$/i;

/** Arquivos protegidos: código-fonte e afins. Dados gerados por programas (.txt, .csv…) ficam livres. */
const CODE = /\.(py|pyw|pyi|ipynb|js|mjs|cjs|jsx|ts|tsx|html?|css|scss|sass|less|php|c|h|cpp|cc|cxx|hpp|hh|cs|java|kt|kts|go|rs|rb|swift|dart|lua|r|pl|sh|bash|ps1|psm1|bat|cmd|vue|svelte|sql|json|jsonc|xml|yaml|yml|toml|md|ini|cfg|devproto|devtest)$/i;

/** Pastas ignoradas (ambientes, dependências, saídas de build). */
const IGNORED_DIRS = new Set(['.expo', '.venv', 'venv', 'env', 'node_modules', '__pycache__', '.git', '.idea', '.pytest_cache', '.mypy_cache', 'bin', 'obj', 'out', 'dist', 'build', 'target']);

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const stripBom = b => (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) ? b.subarray(3) : b;

function isGuarded(root, file) {
	const rel = path.relative(root, file);
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { return false; }
	if (rel.split(path.sep).some(part => IGNORED_DIRS.has(part))) { return false; }
	if (MEDIA.test(file)) { return false; }
	// manifestos de dependências: alterados pelo npm install / npx expo install
	if (/^(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(path.basename(file))) { return false; }
	return CODE.test(file);
}

/** Chave estável da pasta (independe de maiúsculas no Windows). */
function folderKey(root) {
	const norm = path.resolve(root);
	return sha(process.platform === 'win32' ? norm.toLowerCase() : norm).slice(0, 24);
}

/** O estado fica no armazenamento GLOBAL da extensão (fora da pasta), por pasta. */
function stateDirFor(context, root) {
	return path.join(context.globalStorageUri.fsPath, 'fileguard', folderKey(root));
}

function walkGuarded(root, dir, out) {
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (!IGNORED_DIRS.has(e.name)) { walkGuarded(root, full, out); }
		} else if (e.isFile() && isGuarded(root, full)) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Registra uma pasta como projeto confiável do DEV CODE, com o conteúdo atual como base.
 * Só é chamado pelo próprio DEV CODE: assistente de Novo Projeto e clone pelo Git.
 */
function trustFolder(context, root) {
	const stateDir = stateDirFor(context, root);
	const snapDir = path.join(stateDir, 'snapshots');
	fs.rmSync(stateDir, { recursive: true, force: true });
	fs.mkdirSync(snapDir, { recursive: true });
	const manifest = {};
	for (const f of walkGuarded(root, root, [])) {
		const rel = path.relative(root, f).split(path.sep).join('/');
		const buf = fs.readFileSync(f);
		manifest[rel] = sha(stripBom(buf));
		fs.writeFileSync(path.join(snapDir, sha(rel)), buf);
	}
	fs.writeFileSync(path.join(stateDir, 'manifest.json'), JSON.stringify(manifest));
	fs.writeFileSync(path.join(stateDir, 'folder.json'), JSON.stringify({ root, trustedAt: new Date().toISOString() }));
}

function isTrustedFolder(context, root) {
	return fs.existsSync(path.join(stateDirFor(context, root), 'manifest.json'));
}

/** Lista as pastas confiáveis que ainda existem (para "Abrir projeto"). */
function listTrustedFolders(context) {
	const base = path.join(context.globalStorageUri.fsPath, 'fileguard');
	let dirs = [];
	try { dirs = fs.readdirSync(base); } catch { return []; }
	const out = [];
	for (const d of dirs) {
		try {
			const info = JSON.parse(fs.readFileSync(path.join(base, d, 'folder.json'), 'utf8'));
			if (fs.existsSync(info.root)) { out.push(info); }
		} catch { /* ignora */ }
	}
	return out.sort((a, b) => String(b.trustedAt).localeCompare(String(a.trustedAt)));
}

function git(cwd, args) {
	return new Promise(resolve => {
		cp.execFile('git', args, { cwd, windowsHide: true, timeout: 20000 }, (err, stdout) => resolve(err ? undefined : String(stdout).trim()));
	});
}

/** O conteúdo do arquivo é idêntico ao do último commit (HEAD)? => veio do git (clone/pull/checkout). */
async function matchesGitHead(root, file) {
	const rel = path.relative(root, file).split(path.sep).join('/');
	const [headBlob, diskBlob] = await Promise.all([git(root, ['rev-parse', `HEAD:./${rel}`]), git(root, ['hash-object', '--', rel])]);
	return !!headBlob && headBlob === diskBlob;
}

class FileGuard {
	constructor(context, folder) {
		this.root = folder.uri.fsPath;
		this.stateDir = stateDirFor(context, this.root);
		this.snapDir = path.join(this.stateDir, 'snapshots');
		this.manifestFile = path.join(this.stateDir, 'manifest.json');
		fs.mkdirSync(this.snapDir, { recursive: true });
		/** rel -> hash */
		this.manifest = this.readManifest();
		/** caminho absoluto -> hash salvo pelo editor */
		this.savedByEditor = new Map();
		/** caminhos criados pelo Explorer/API da IDE */
		this.createdByIde = new Set();
		/** escritas do próprio DEV CODE (restaurações): caminho -> hash escrito */
		this.selfWrites = new Map();
		this.timers = new Map();
		this.disposables = [];
	}

	// ------------------------------------------------------------------ estado

	readManifest() {
		try { return JSON.parse(fs.readFileSync(this.manifestFile, 'utf8')); } catch { return undefined; }
	}

	writeManifest() {
		fs.writeFileSync(this.manifestFile, JSON.stringify(this.manifest));
	}

	rel(file) { return path.relative(this.root, file).split(path.sep).join('/'); }
	snapPath(rel) { return path.join(this.snapDir, sha(rel)); }

	accept(file, buf) {
		const rel = this.rel(file);
		this.manifest[rel] = sha(stripBom(buf));
		fs.writeFileSync(this.snapPath(rel), buf);
		this.scheduleManifestWrite();
	}

	forget(file) {
		const rel = this.rel(file);
		if (this.manifest[rel] !== undefined) {
			delete this.manifest[rel];
			try { fs.unlinkSync(this.snapPath(rel)); } catch { /* ok */ }
			this.scheduleManifestWrite();
		}
	}

	scheduleManifestWrite() {
		clearTimeout(this.manifestTimer);
		this.manifestTimer = setTimeout(() => this.writeManifest(), 500);
	}

	knownHashes() { return new Set(Object.values(this.manifest)); }

	// ------------------------------------------------------------------ varredura inicial

	walk(dir, out) {
		let entries;
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (!IGNORED_DIRS.has(e.name)) { this.walk(full, out); }
			} else if (e.isFile() && isGuarded(this.root, full)) {
				out.push(full);
			}
		}
	}

	/** @returns {Promise<boolean>} false se a pasta não é um projeto do DEV CODE */
	async initialScan() {
		if (!this.manifest) {
			return false; // pasta que não foi criada/clonada pelo DEV CODE
		}
		const files = [];
		this.walk(this.root, files);
		const removed = [], restored = [];
		for (const f of files) {
			const r = await this.verify(f, { silent: true });
			if (r === 'removed') { removed.push(this.rel(f)); }
			if (r === 'restored') { restored.push(this.rel(f)); }
		}
		// entradas de arquivos que não existem mais
		for (const rel of Object.keys(this.manifest)) {
			if (!fs.existsSync(path.join(this.root, rel))) { this.forget(path.join(this.root, rel)); }
		}
		this.report(removed, restored);
		return true;
	}

	// ------------------------------------------------------------------ verificação

	/** @returns {'ok'|'accepted'|'removed'|'restored'|'skipped'} */
	async verify(file, { silent } = {}) {
		if (!isGuarded(this.root, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { return 'skipped'; }
		const buf = fs.readFileSync(file);
		const h = sha(stripBom(buf));
		const rel = this.rel(file);

		if (this.selfWrites.get(file) === h) { this.selfWrites.delete(file); return 'ok'; }

		if (this.manifest[rel] === h) { return 'ok'; }

		// 1) Salvo pelo editor da IDE
		if (this.savedByEditor.get(file) === h) {
			this.accept(file, buf);
			return 'accepted';
		}
		// 2) Criado pelo Explorer da IDE: vazio, ou cópia de um arquivo do próprio aluno
		if (this.createdByIde.has(file) && (buf.length === 0 || this.knownHashes().has(h))) {
			this.createdByIde.delete(file);
			this.accept(file, buf);
			return 'accepted';
		}

		// 3) Igual ao último commit do git (git pull / clone / checkout feitos pela IDE)
		if (await matchesGitHead(this.root, file)) {
			this.accept(file, buf);
			return 'accepted';
		}

		// 4) Veio de fora
		if (this.manifest[rel] !== undefined && fs.existsSync(this.snapPath(rel))) {
			const snap = fs.readFileSync(this.snapPath(rel));
			this.selfWrites.set(file, sha(stripBom(snap)));
			fs.writeFileSync(file, snap);
			if (!silent) { this.report([], [rel]); }
			return 'restored';
		}
		this.forget(file);
		try {
			await vscode.workspace.fs.delete(vscode.Uri.file(file), { useTrash: true });
		} catch {
			try { fs.unlinkSync(file); } catch { /* sem permissão */ }
		}
		if (!silent) { this.report([rel], []); }
		return 'removed';
	}

	schedule(file) {
		clearTimeout(this.timers.get(file));
		this.timers.set(file, setTimeout(() => {
			this.timers.delete(file);
			this.verify(file).catch(err => console.error('[DEV CODE fileGuard]', err));
		}, 400));
	}

	report(removed, restored) {
		if (!removed.length && !restored.length) { return; }
		const parts = [];
		if (removed.length) { parts.push(`Arquivos colados/copiados para o projeto foram EXCLUÍDOS: ${removed.join(', ')}`); }
		if (restored.length) { parts.push(`Arquivos alterados por fora da IDE voltaram ao conteúdo anterior: ${restored.join(', ')}`); }
		vscode.window.showWarningMessage(
			`DEV CODE: ${parts.join('. ')}. O código deve ser digitado no editor. (Imagens, áudios e vídeos são permitidos.)`,
			{ modal: true });
	}

	// ------------------------------------------------------------------ eventos

	async start() {
		if (!(await this.initialScan())) {
			return false;
		}

		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '**/*'));
		this.disposables.push(watcher,
			watcher.onDidCreate(u => this.schedule(u.fsPath)),
			watcher.onDidChange(u => this.schedule(u.fsPath)),
			watcher.onDidDelete(u => { if (!fs.existsSync(u.fsPath)) { this.forget(u.fsPath); } }),

			vscode.workspace.onDidSaveTextDocument(doc => {
				if (doc.uri.scheme === 'file') {
					this.savedByEditor.set(doc.uri.fsPath, sha(Buffer.from(doc.getText(), 'utf8')));
					this.schedule(doc.uri.fsPath);
				}
			}),
			vscode.workspace.onDidSaveNotebookDocument(nb => {
				if (nb.uri.scheme === 'file' && fs.existsSync(nb.uri.fsPath)) {
					this.savedByEditor.set(nb.uri.fsPath, sha(stripBom(fs.readFileSync(nb.uri.fsPath))));
					this.schedule(nb.uri.fsPath);
				}
			}),
			vscode.workspace.onDidCreateFiles(e => {
				for (const u of e.files) { this.createdByIde.add(u.fsPath); this.schedule(u.fsPath); }
			}),
			vscode.workspace.onDidRenameFiles(e => {
				for (const { oldUri, newUri } of e.files) {
					const oldRel = this.rel(oldUri.fsPath);
					const known = this.manifest[oldRel] !== undefined;
					this.forget(oldUri.fsPath);
					// arquivo do aluno renomeado/movido: continua confiável
					if (known && fs.existsSync(newUri.fsPath) && fs.statSync(newUri.fsPath).isFile()) {
						this.accept(newUri.fsPath, fs.readFileSync(newUri.fsPath));
					} else {
						// ex.: "codigo.txt" baixado e renomeado para "main.py"
						this.schedule(newUri.fsPath);
					}
				}
			}),
			vscode.workspace.onDidDeleteFiles(e => e.files.forEach(u => this.forget(u.fsPath))),
		);
		return true;
	}

	/** Revalida tudo (ex.: depois de um git pull). */
	async rescan() {
		const files = [];
		this.walk(this.root, files);
		const removed = [], restored = [];
		for (const f of files) {
			const r = await this.verify(f, { silent: true });
			if (r === 'removed') { removed.push(this.rel(f)); }
			if (r === 'restored') { restored.push(this.rel(f)); }
		}
		this.report(removed, restored);
	}

	dispose() {
		clearTimeout(this.manifestTimer);
		if (this.manifest) { this.writeManifest(); }
		this.timers.forEach(t => clearTimeout(t));
		this.disposables.forEach(d => d.dispose());
	}
}

const guards = [];

async function registerFileGuard(context) {
	for (const folder of vscode.workspace.workspaceFolders || []) {
		if (folder.uri.scheme !== 'file') { continue; }
		const guard = new FileGuard(context, folder);
		context.subscriptions.push(guard);
		let ok = false;
		try { ok = await guard.start(); } catch (err) { console.error('[DEV CODE fileGuard]', err); }
		if (!ok) {
			await vscode.window.showErrorMessage(
				`DEV CODE: a pasta "${path.basename(folder.uri.fsPath)}" não é um projeto do DEV CODE e será fechada.\n\n` +
				'Projetos só podem ser abertos se foram criados pelo "Novo Projeto" (Python / HTML) ou baixados pelo "Projeto do Git".',
				{ modal: true });
			await vscode.commands.executeCommand('workbench.action.closeFolder');
			return;
		}
		guards.push(guard);
	}
}

/**
 * Aceita um arquivo gravado pelo próprio DEV CODE (ex.: nova tela do protótipo, imagem importada).
 * Com `content`, pode ser chamado ANTES de gravar: o vigia já conhece o conteúdo quando o arquivo aparecer.
 * Sem `content`, lê o arquivo do disco (precisa já existir).
 */
function acceptOwnFile(file, content) {
	for (const g of guards) {
		if (!isGuarded(g.root, file)) { continue; }
		const buf = content ?? (fs.existsSync(file) ? fs.readFileSync(file) : undefined);
		if (buf) { g.accept(file, Buffer.isBuffer(buf) ? buf : Buffer.from(buf)); }
	}
}

async function rescanAll() {
	for (const g of guards) { await g.rescan(); }
}

module.exports = { registerFileGuard, rescanAll, acceptOwnFile, trustFolder, isTrustedFolder, listTrustedFolders, FileGuard, isGuarded };
