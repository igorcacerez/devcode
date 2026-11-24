'use strict';

const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SIGNATURE_KEY = [
	'7b4e19c0f2a6d8e1',
	'9f3c5a0b6e2d8147',
	'c5f0a38d1b7e4926',
	'0d6a2f9c8e1b7354',
].join('');
const commitCache = new Map();
const blobCache = new Map();

function asText(value) {
	if (value === undefined || value === null) { return ''; }
	return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function runGit(repo, args, timeout = 300000, extraEnv = {}) {
	return new Promise(resolve => {
		try {
			cp.execFile('git', args, {
				cwd: repo,
				timeout,
				windowsHide: true,
				env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extraEnv },
				encoding: 'buffer',
			}, (err, stdout, stderr) => resolve({
				ok: !err,
				out: asText(stdout),
				err: asText(stderr) || (err ? err.message : ''),
			}));
		} catch (err) {
			resolve({ ok: false, out: '', err: err.message || String(err) });
		}
	});
}

async function getHead(repo) {
	const result = await runGit(repo, ['rev-parse', '--verify', 'HEAD']);
	return result.ok ? result.out.trim() : undefined;
}

async function commitParentCount(repo, sha) {
	const result = await runGit(repo, ['rev-list', '--parents', '-n', '1', sha]);
	if (!result.ok) { return undefined; }
	const line = result.out.trim();
	if (!line) { return undefined; }
	return Math.max(0, line.split(/\s+/).length - 1);
}

async function headParentCount(repo) {
	const head = await getHead(repo);
	return head ? commitParentCount(repo, head) : undefined;
}

function parseRawDiffTree(output) {
	const fields = String(output ?? '').split('\0');
	const changes = [];
	for (let i = 0; i < fields.length;) {
		const header = fields[i];
		if (!header.startsWith(':')) {
			i++;
			continue;
		}

		const colonCount = /^:+/.exec(header)?.[0].length || 0;
		const parts = header.slice(colonCount).trim().split(/\s+/);
		const blobIndex = (2 * colonCount) + 1;
		const statusIndex = blobIndex + 1;
		if (!colonCount || parts.length <= statusIndex || fields[i + 1] === undefined) {
			i++;
			continue;
		}

		let rel = fields[i + 1];
		let consumed = 2;
		const status = parts[statusIndex];
		if (colonCount === 1 && /^[RC]/.test(status) && fields[i + 2] !== undefined) {
			rel = fields[i + 2];
			consumed = 3;
		}

		const blob = parts[blobIndex];
		if (!/^0+$/.test(blob)) { changes.push({ rel, blob }); }
		i += consumed;
	}
	return changes;
}

async function commitChanges(repo, sha) {
	const parents = await commitParentCount(repo, sha);
	if (parents === undefined) { return undefined; }
	const args = parents >= 2
		? ['diff-tree', '-c', '--no-commit-id', '-r', '--raw', '--no-abbrev', '-z', sha]
		: ['diff-tree', '--no-commit-id', '-r', '--root', '--no-renames', '--raw', '--no-abbrev', '-z', sha];
	const result = await runGit(repo, args);
	return result.ok ? parseRawDiffTree(result.out) : undefined;
}

function canonicalChanges(changes) {
	return changes.map(change => `${change.rel}\0${change.blob}\n`).sort().join('');
}

async function signatureForCommit(repo, sha) {
	const changes = await commitChanges(repo, sha);
	if (!changes) { return undefined; }
	return crypto.createHmac('sha256', SIGNATURE_KEY).update(canonicalChanges(changes), 'utf8').digest('hex');
}

async function isCommitSigned(repo, sha) {
	if (commitCache.has(sha)) { return commitCache.get(sha); }
	const message = await runGit(repo, ['log', '-1', '--format=%B', sha]);
	let signed = false;
	if (message.ok) {
		const lastLine = message.out.trimEnd().split(/\r?\n/).pop() || '';
		const trailer = /^DevCode-Assinatura:\s*([a-f0-9]{64})$/i.exec(lastLine);
		if (trailer) {
			const computed = await signatureForCommit(repo, sha);
			if (computed) {
				const suppliedBytes = Buffer.from(trailer[1], 'hex');
				const computedBytes = Buffer.from(computed, 'hex');
				signed = suppliedBytes.length === computedBytes.length && crypto.timingSafeEqual(suppliedBytes, computedBytes);
			}
		}
	}
	commitCache.set(sha, signed);
	return signed;
}

async function isBlobFromSignedCommit(repo, rel, blob) {
	const key = `${path.resolve(repo)}\0${rel}\0${blob}`;
	if (blobCache.has(key)) { return blobCache.get(key); }
	const commits = await runGit(repo, ['log', '--format=%H', '-n', '200', '--', rel]);
	let found = false;
	if (commits.ok) {
		for (const sha of commits.out.split(/\r?\n/).filter(Boolean)) {
			const changes = await commitChanges(repo, sha);
			if (changes?.some(change => change.rel === rel && change.blob === blob) && await isCommitSigned(repo, sha)) {
				found = true;
				break;
			}
		}
	}
	blobCache.set(key, found);
	return found;
}

async function signHead(repo) {
	const head = await getHead(repo);
	if (!head) { return false; }
	if (await isCommitSigned(repo, head)) { return true; }

	const signature = await signatureForCommit(repo, head);
	if (!signature) { return false; }
	const message = await runGit(repo, ['log', '-1', '--format=%B', head]);
	if (!message.ok) { return false; }
	const cleanMessage = message.out
		.replace(/^[ \t]*DevCode-Assinatura:[^\r\n]*\r?\n?/gim, '')
		.trimEnd();
	const signedMessage = `${cleanMessage}\n\nDevCode-Assinatura: ${signature}\n`;
	const tempFile = path.join(os.tmpdir(), `devcode-commit-${process.pid}-${crypto.randomBytes(8).toString('hex')}.txt`);
	let stagedMergeHead;
	let mergeHeadPath;
	try {
		if ((await commitParentCount(repo, head)) >= 2) {
			const mergeHead = await runGit(repo, ['rev-parse', '--git-path', 'MERGE_HEAD']);
			mergeHeadPath = mergeHead.ok && mergeHead.out.trim() ? path.resolve(repo, mergeHead.out.trim()) : '';
			if (mergeHeadPath && fs.existsSync(mergeHeadPath)) {
				stagedMergeHead = mergeHeadPath + '.devcode-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
				fs.renameSync(mergeHeadPath, stagedMergeHead);
			}
		}
		fs.writeFileSync(tempFile, signedMessage, { flag: 'wx', encoding: 'utf8' });
		const amend = await runGit(repo, ['commit', '--amend', '--no-verify', '--allow-empty', '-F', tempFile], 300000, { DEVCODE_SIGNING: '1' });
		if (!amend.ok) { return false; }
		resetCaches();
		return true;
	} catch (err) {
		console.error('[DEV CODE authorship]', err);
		return false;
	} finally {
		if (stagedMergeHead) {
			try { fs.renameSync(stagedMergeHead, mergeHeadPath); }
			catch (err) { console.error('[DEV CODE authorship]', err); }
		}
		try { fs.unlinkSync(tempFile); } catch { /* arquivo temporário já removido */ }
	}
}

function clearBlobCache() {
	blobCache.clear();
}

function resetCaches() {
	commitCache.clear();
	blobCache.clear();
}

module.exports = {
	runGit,
	getHead,
	commitParentCount,
	headParentCount,
	parseRawDiffTree,
	commitChanges,
	canonicalChanges,
	signatureForCommit,
	isCommitSigned,
	isBlobFromSignedCommit,
	signHead,
	clearBlobCache,
	resetCaches,
};
