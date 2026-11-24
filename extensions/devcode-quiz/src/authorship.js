'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const signature = require('./signature');

const TRUSTED_REPOS_KEY = 'devcode.trustedRepos';
const writeTimers = new Map();
const dirtyProjects = new Set();
const journalCache = new Map();
let extensionContext;

function configure(context) {
	extensionContext = context;
}

function runGit(repo, args, timeout = 300000) {
	return signature.runGit(repo, args, timeout);
}

function gitDirectory(repo) {
	const dotGit = path.join(repo, '.git');
	try {
		if (fs.statSync(dotGit).isDirectory()) { return dotGit; }
		const marker = fs.readFileSync(dotGit, 'utf8');
		const match = /^gitdir:\s*(.+?)\s*$/im.exec(marker);
		return match ? path.resolve(repo, match[1].trim()) : undefined;
	} catch { return undefined; }
}

function shellDoubleQuote(value) {
	return '"' + String(value).replace(/(["\\$])/g, '\\$1')
		.replace(new RegExp(String.fromCharCode(96), 'g'), String.fromCharCode(92, 96)) + '"';
}

async function installHooks(repo, extensionPath, nodePath = process.env.DEVCODE_NODE || process.execPath) {
	const gitDir = gitDirectory(repo);
	if (!gitDir || !extensionPath) { return false; }
	const configured = await signature.runGit(repo, ['config', '--path', 'core.hooksPath']);
	const hooksPath = configured.ok ? configured.out.replace(/[\r\n]+$/, '') : '';
	const hooksDir = hooksPath ? path.resolve(repo, hooksPath) : path.join(gitDir, 'hooks');
	const node = String(nodePath || process.env.DEVCODE_NODE || process.execPath).replace(/\\/g, '/');
	const hookScript = path.join(extensionPath, 'src', 'signHook.js').replace(/\\/g, '/');
	try {
		fs.mkdirSync(hooksDir, { recursive: true });
		for (const hookName of ['post-commit', 'post-merge']) {
			const hookFile = path.join(hooksDir, hookName);
			const command = 'ELECTRON_RUN_AS_NODE=1 ' + shellDoubleQuote(node) + ' ' + shellDoubleQuote(hookScript) + ' ' + hookName + ' >/dev/null 2>&1';
			const content = [
				'#!/bin/sh',
				'# DEV CODE: assina o commit (gerado automaticamente)',
				'[ -n "$DEVCODE_SIGNING" ] && exit 0',
				command,
				'exit 0',
				'',
			].join('\n');
			if (fs.existsSync(hookFile)) {
				let current;
				try { current = fs.readFileSync(hookFile, 'utf8'); } catch { current = ''; }
				if (!current.includes('# DEV CODE: assina o commit')) {
					console.warn('[DEV CODE] O hook Git "' + hookName + '" já existe e foi mantido.');
					continue;
				}
			}
			fs.writeFileSync(hookFile, content, { encoding: 'utf8', mode: 0o755 });
			fs.chmodSync(hookFile, 0o755);
		}
		return true;
	} catch (err) {
		console.warn('[DEV CODE] Não foi possível instalar os hooks de assinatura:', err.message || err);
		return false;
	}
}

function normalizeRemote(remote) {
	return String(remote || '').trim()
		.replace(/^(https?:\/\/)[^/@]+@/i, '$1')
		.toLowerCase()
		.replace(/(?:\.git|\/)+$/g, '');
}

function trustedRepos() {
	const repos = extensionContext?.globalState.get(TRUSTED_REPOS_KEY, []);
	return Array.isArray(repos) ? repos.map(normalizeRemote).filter(Boolean) : [];
}

async function originUrl(repo) {
	const remote = await runGit(repo, ['remote', 'get-url', 'origin']);
	return remote.ok ? normalizeRemote(remote.out) : '';
}

async function isRepoTrusted(repo) {
	const remote = await originUrl(repo);
	return !!remote && trustedRepos().includes(remote);
}

async function trustRepo(repo) {
	if (!extensionContext) { return false; }
	const remote = await originUrl(repo);
	if (!remote) { return false; }
	const repos = trustedRepos();
	if (!repos.includes(remote)) {
		await extensionContext.globalState.update(TRUSTED_REPOS_KEY, [...repos, remote]);
	}
	appendEvent(repo, 'repoConfiavel', remote, 0);
	flushJournal(repo);
	return true;
}

function journalPath(repo) {
	return path.join(repo, '.devcode', 'autoria.json');
}

function excludeJournalFromGit(repo) {
	let gitDir = path.join(repo, '.git');
	try {
		if (!fs.statSync(gitDir).isDirectory()) {
			const marker = fs.readFileSync(gitDir, 'utf8');
			const match = /^gitdir:\s*(.+)\s*$/im.exec(marker);
			if (!match) { return; }
			gitDir = path.resolve(repo, match[1]);
		}
		const excludeFile = path.join(gitDir, 'info', 'exclude');
		fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
		const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
		if (!current.split(/\r?\n/).some(line => line.trim() === '.devcode/')) {
			fs.appendFileSync(excludeFile, `${current && !current.endsWith('\n') ? '\n' : ''}.devcode/\n`, 'utf8');
		}
	} catch { /* pastas sem repositório Git mantêm o diário normalmente */ }
}

function emptyJournal() {
	return { versao: 1, arquivos: {}, eventos: [] };
}

function readJournal(repo) {
	if (journalCache.has(repo)) { return journalCache.get(repo); }
	try {
		const value = JSON.parse(fs.readFileSync(journalPath(repo), 'utf8'));
		if (value?.versao === 1 && value.arquivos && Array.isArray(value.eventos)) {
			journalCache.set(repo, value);
			return value;
		}
	} catch { /* cria um diário novo */ }
	const journal = emptyJournal();
	journalCache.set(repo, journal);
	return journal;
}

function writeJournal(repo) {
	const journal = dirtyProjects.has(repo) ? journalCache.get(repo) : undefined;
	if (!journal) { return; }
	try {
		excludeJournalFromGit(repo);
		fs.mkdirSync(path.dirname(journalPath(repo)), { recursive: true });
		fs.writeFileSync(journalPath(repo), JSON.stringify(journal, null, '\t') + '\n', 'utf8');
		dirtyProjects.delete(repo);
	} catch (err) {
		console.error('[DEV CODE authorship]', err);
	}
}

function flushJournal(repo) {
	clearTimeout(writeTimers.get(repo));
	writeTimers.delete(repo);
	writeJournal(repo);
}

function markDirty(repo) {
	excludeJournalFromGit(repo);
	dirtyProjects.add(repo);
	clearTimeout(writeTimers.get(repo));
	writeTimers.set(repo, setTimeout(() => {
		writeTimers.delete(repo);
		writeJournal(repo);
	}, 2000));
}

function ensureFileRecord(journal, rel) {
	if (!journal.arquivos[rel]) {
		journal.arquivos[rel] = { digitado: 0, recebidoAssinado: 0, quarentena: 0, liberadoProfessor: 0 };
	}
	return journal.arquivos[rel];
}

function appendEvent(repo, tipo, arquivo, linhas) {
	const journal = readJournal(repo);
	journal.eventos.push({ quando: new Date().toISOString(), tipo, arquivo, linhas });
	journal.eventos = journal.eventos.slice(-500);
	markDirty(repo);
}

function increment(repo, rel, field, amount, eventType) {
	if (!Number.isFinite(amount) || amount < 0 || (amount === 0 && !eventType)) { return; }
	const journal = readJournal(repo);
	if (amount > 0) { ensureFileRecord(journal, rel)[field] += amount; }
	if (eventType) {
		journal.eventos.push({ quando: new Date().toISOString(), tipo: eventType, arquivo: rel, linhas: amount });
		journal.eventos = journal.eventos.slice(-500);
	}
	markDirty(repo);
}

function countLines(content) {
	const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content ?? '');
	if (!text.length) { return 0; }
	const lines = text.split(/\r\n|\n|\r/).length;
	return /(?:\r\n|\n|\r)$/.test(text) ? lines - 1 : lines;
}

function recordReceivedSigned(repo, rel, content) {
	increment(repo, rel, 'recebidoAssinado', countLines(content));
}

function recordQuarantine(repo, rel, content) {
	increment(repo, rel, 'quarentena', countLines(content), 'quarentena');
}

function recordRelease(repo, rel, content) {
	increment(repo, rel, 'liberadoProfessor', countLines(content), 'liberado');
}

function recordTyping(repo, rel, characters) {
	if (!Number.isFinite(characters) || characters <= 0) { return; }
	const journal = readJournal(repo);
	ensureFileRecord(journal, rel).digitado += characters;
	markDirty(repo);
}

function escapeMarkdown(value) {
	return String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderReport(folders) {
	const rows = [];
	const events = [];
	let totals = { digitado: 0, recebidoAssinado: 0, quarentena: 0, liberadoProfessor: 0 };
	for (const folder of folders) {
		const journal = readJournal(folder.uri.fsPath);
		for (const [rel, stats] of Object.entries(journal.arquivos)) {
			rows.push({ projeto: path.basename(folder.uri.fsPath), rel, ...stats });
			for (const key of Object.keys(totals)) { totals[key] += Number(stats[key]) || 0; }
		}
		for (const event of journal.eventos) { events.push({ projeto: path.basename(folder.uri.fsPath), ...event }); }
	}
	events.sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
	const lines = [
		'# Relatório de autoria do código',
		'',
		'## Arquivos',
		'',
		'| Arquivo | Digitado (caracteres) | Recebido do GitHub (assinado) | Quarentena (linhas) | Liberado pelo professor |',
		'| --- | ---: | ---: | ---: | ---: |',
	];
	for (const row of rows.sort((a, b) => `${a.projeto}/${a.rel}`.localeCompare(`${b.projeto}/${b.rel}`))) {
		const file = folders.length > 1 ? `${row.projeto}/${row.rel}` : row.rel;
		lines.push(`| ${escapeMarkdown(file)} | ${row.digitado || 0} | ${row.recebidoAssinado || 0} | ${row.quarentena || 0} | ${row.liberadoProfessor || 0} |`);
	}
	lines.push(`| **Total** | **${totals.digitado}** | **${totals.recebidoAssinado}** | **${totals.quarentena}** | **${totals.liberadoProfessor}** |`);
	lines.push('', '## Últimos 20 eventos', '', '| Quando | Tipo | Arquivo | Linhas |', '| --- | --- | --- | ---: |');
	for (const event of events.slice(-20).reverse()) {
		const date = new Date(event.quando).toLocaleString('pt-BR');
		const file = folders.length > 1 ? `${event.projeto}/${event.arquivo}` : event.arquivo;
		lines.push(`| ${escapeMarkdown(date)} | ${escapeMarkdown(event.tipo)} | ${escapeMarkdown(file)} | ${event.linhas || 0} |`);
	}
	return lines.join('\n') + '\n';
}

async function showReport() {
	const folders = vscode.workspace.workspaceFolders || [];
	if (!folders.length) {
		vscode.window.showInformationMessage('Abra um projeto para ver o relatório de autoria.');
		return;
	}
	const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderReport(folders) });
	await vscode.window.showTextDocument(document, { preview: false });
}

function registerAuthorship(context) {
	configure(context);
	const disposable = vscode.workspace.onDidChangeTextDocument(event => {
		const doc = event.document;
		if (event.reason !== undefined || doc.uri.scheme !== 'file') { return; }
		const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
		if (!folder) { return; }
		const { isGuarded } = require('./fileGuard');
		if (!isGuarded(folder.uri.fsPath, doc.uri.fsPath)) { return; }
		const characters = event.contentChanges.reduce((sum, change) => sum + change.text.length, 0);
		if (characters) { recordTyping(folder.uri.fsPath, path.relative(folder.uri.fsPath, doc.uri.fsPath).split(path.sep).join('/'), characters); }
	});
	context.subscriptions.push(disposable, vscode.commands.registerCommand('devcode.authorship.report', showReport), {
		dispose() {
			for (const repo of dirtyProjects) {
				flushJournal(repo);
			}
		},
	});
}

function clearBlobCache() {
	signature.clearBlobCache();
}

function _resetCachesForTests() {
	signature.resetCaches();
}

module.exports = {
	configure,
	registerAuthorship,
	signHeadCommit: signature.signHead,
	isCommitSigned: signature.isCommitSigned,
	isBlobFromSignedCommit: signature.isBlobFromSignedCommit,
	installHooks,
	isRepoTrusted,
	trustRepo,
	recordReceivedSigned,
	recordQuarantine,
	recordRelease,
	recordTyping,
	countLines,
	appendEvent,
	flushJournal,
	clearBlobCache,
	_normalizeRemote: normalizeRemote,
	_parseRawDiffTree: signature.parseRawDiffTree,
	_renderReport: renderReport,
	_resetCachesForTests,
};
