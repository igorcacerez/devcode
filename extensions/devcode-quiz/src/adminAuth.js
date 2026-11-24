'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function execFile(file, args, timeout = 300000) {
	return new Promise(resolve => cp.execFile(file, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
		resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() });
	}));
}

function psLiteral(value) {
	return `'${String(value).replace(/'/g, "''")}'`;
}

async function requireAdmin(_reason) {
	if (process.platform !== 'win32') {
		vscode.window.showInformationMessage('A confirmação do professor está disponível apenas no Windows.');
		vscode.window.showWarningMessage('Liberação cancelada: é preciso a senha de administrador do computador.');
		return false;
	}

	const nonce = crypto.randomBytes(24).toString('hex');
	const base = process.env.ProgramData || 'C:\\ProgramData';
	const adminDir = path.join(base, 'DevCode', 'admin');
	const challengeFile = path.join(adminDir, nonce);
	let approved = false;
	try {
		const elevatedScript = `New-Item -ItemType Directory -Force -Path ${psLiteral(adminDir)} | Out-Null; Set-Content -LiteralPath ${psLiteral(challengeFile)} -Value ${psLiteral(nonce)}`;
		const startScript = `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',${psLiteral(elevatedScript)}`;
		const started = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Aguardando a senha do administrador (professor)…' },
			() => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', startScript]));
		if (started.ok && fs.existsSync(challengeFile)) {
			const content = fs.readFileSync(challengeFile, 'utf8').trim();
			if (content === nonce) {
				const ownerScript = `(Get-Acl -LiteralPath ${psLiteral(challengeFile)}).Owner`;
				const owner = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ownerScript]);
				const ownerName = owner.out.split(/\r?\n/).pop()?.trim() || '';
				if (owner.ok && /Administrators|Administradores|S-1-5-32-544/i.test(ownerName)) {
					approved = true;
				} else if (owner.ok && ownerName) {
					const memberScript = `$owner = ${psLiteral(ownerName)}; (Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | ForEach-Object { $_.Name }) -contains $owner`;
					const membership = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', memberScript]);
					approved = membership.ok && /^true$/i.test(membership.out);
				}
			}
		}
	} catch (err) {
		console.error('[DEV CODE adminAuth]', err);
	} finally {
		try { fs.unlinkSync(challengeFile); } catch { /* arquivo não foi criado ou já foi removido */ }
	}
	if (!approved) {
		vscode.window.showWarningMessage('Liberação cancelada: é preciso a senha de administrador do computador.');
	}
	return approved;
}

module.exports = { requireAdmin };
