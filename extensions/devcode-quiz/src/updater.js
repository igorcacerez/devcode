/*---------------------------------------------------------------------------------------------
 *  DEV CODE - atualização automática pelo GitHub.
 *  Ao abrir (e a cada 6 horas) consulta a última release do repositório do projeto
 *  (product.json → devcodeRepo). Se houver versão nova, mostra uma notificação; ao clicar em
 *  "Atualizar agora", baixa o instalador (DEV-CODE-Setup.exe), fecha a IDE, instala em modo
 *  silencioso e reabre a IDE já atualizada.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function readProduct() {
	try { return JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8')); } catch { return {}; }
}

function compareVersions(a, b) {
	const pa = String(a).replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
	const pb = String(b).replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		if ((pa[i] || 0) !== (pb[i] || 0)) { return (pa[i] || 0) - (pb[i] || 0); }
	}
	return 0;
}

/** Tag da última release, lida do redirecionamento de /releases/latest (ex.: .../releases/tag/v1.0.1). */
function latestTag(repo) {
	return new Promise((resolve, reject) => {
		https.request(`https://github.com/${repo}/releases/latest`, { method: 'HEAD', headers: { 'User-Agent': 'DEV-CODE-updater' } }, res => {
			const m = /\/releases\/tag\/([^/?#]+)/.exec(res.headers.location || '');
			res.resume();
			m ? resolve(decodeURIComponent(m[1])) : reject(new Error(res.statusCode === 404 ? 'nenhuma versão publicada' : `HTTP ${res.statusCode}`));
		}).on('error', reject).end();
	});
}

function download(url, dest, onProgress, token) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: { 'User-Agent': 'DEV-CODE-updater' } }, res => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				return download(res.headers.location, dest, onProgress, token).then(resolve, reject);
			}
			if (res.statusCode !== 200) { return reject(new Error(`HTTP ${res.statusCode}`)); }
			const total = parseInt(res.headers['content-length'] || '0', 10);
			let received = 0;
			const file = fs.createWriteStream(dest);
			res.on('data', chunk => { received += chunk.length; onProgress(received, total); });
			res.pipe(file);
			file.on('finish', () => file.close(() => resolve(dest)));
			file.on('error', reject);
		});
		req.on('error', reject);
		token?.onCancellationRequested(() => { req.destroy(new Error('cancelado')); });
	});
}

async function installUpdate(release, asset) {
	const dest = path.join(os.tmpdir(), `DEV-CODE-Setup-${release.tag_name}.exe`);
	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `DEV CODE: baixando a versão ${release.tag_name}`,
			cancellable: true,
		}, async (progress, token) => {
			let last = 0;
			await download(asset.browser_download_url, dest, (rec, total) => {
				if (!total) { return; }
				const pct = Math.floor(rec / total * 100);
				if (pct > last) { progress.report({ increment: pct - last, message: `${pct}%` }); last = pct; }
			}, token);
		});
	} catch (err) {
		vscode.window.showErrorMessage(`DEV CODE: não foi possível baixar a atualização. ${err.message || err}`);
		return;
	}
	const ok = await vscode.window.showInformationMessage(
		`A versão ${release.tag_name} foi baixada. O DEV CODE vai fechar, instalar e abrir de novo. Salve seus arquivos!`,
		{ modal: true }, 'Instalar agora');
	if (ok !== 'Instalar agora') { return; }
	await vscode.workspace.saveAll(false);
	// O instalador cancela em silêncio se a IDE ainda estiver aberta. Por isso um processo auxiliar
	// (PowerShell, separado da IDE) espera TODOS os processos do DEV CODE fecharem e só então instala.
	// /DEVCODEUPDATE=1 faz o instalador reabrir a IDE no final e só verificar o Node.
	const exe = process.execPath.replace(/'/g, '\'\'');
	const setup = dest.replace(/'/g, '\'\'');
	const log = path.join(os.tmpdir(), 'devcode-update.log').replace(/'/g, '\'\'');
	const script = [
		`$exe = '${exe}'`,
		`Add-Content -Path '${log}' -Value "$(Get-Date) aguardando o DEV CODE fechar..."`,
		'for ($i = 0; $i -lt 120; $i++) { if (-not (Get-Process | Where-Object { $_.Path -eq $exe })) { break }; Start-Sleep -Milliseconds 500 }',
		'Get-Process | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue',
		'Start-Sleep -Seconds 1',
		`Add-Content -Path '${log}' -Value "$(Get-Date) instalando ${release.tag_name}..."`,
		`$p = Start-Process -FilePath '${setup}' -ArgumentList '/SILENT','/SP-','/SUPPRESSMSGBOXES','/NORESTART','/DEVCODEUPDATE=1','/LOG="${log.replace(/\.log$/, '-setup.log')}"' -Wait -PassThru`,
		`Add-Content -Path '${log}' -Value "$(Get-Date) instalador terminou com código $($p.ExitCode)"`,
	].join('; ');
	const child = cp.spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true });
	child.unref();
	setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 800);
}

async function checkForUpdates(context, { manual } = {}) {
	const product = readProduct();
	const repo = product.devcodeRepo;
	const current = product.devcodeVersion;
	if (!repo || !current || process.platform !== 'win32') {
		if (manual) { vscode.window.showInformationMessage('DEV CODE: atualização automática disponível só na versão instalada no Windows.'); }
		return;
	}
	// Usa o redirecionamento de github.com/<repo>/releases/latest (sem o limite de 60 consultas/hora
	// da API, que um laboratório inteiro saindo pelo mesmo IP estouraria).
	let latest;
	try {
		latest = await latestTag(repo);
	} catch (err) {
		if (manual) { vscode.window.showWarningMessage(`DEV CODE: não foi possível verificar atualizações (${err.message}).`); }
		return;
	}
	if (compareVersions(latest, current) <= 0) {
		if (manual) { vscode.window.showInformationMessage(`DEV CODE: você já está na versão mais recente (${current}).`); }
		return;
	}
	const release = { tag_name: latest, html_url: `https://github.com/${repo}/releases/tag/${latest}` };
	const asset = { browser_download_url: `https://github.com/${repo}/releases/download/${latest}/DEV-CODE-Setup.exe` };
	const skipped = context.globalState.get('devcode.skipVersion');
	if (!manual && skipped === latest) { return; }
	const choice = await vscode.window.showInformationMessage(
		`🎉 Nova versão do DEV CODE disponível: ${latest} (você está na ${current}).`,
		'Atualizar agora', 'Depois', 'Novidades');
	if (choice === 'Atualizar agora') {
		await installUpdate(release, asset);
	} else if (choice === 'Novidades') {
		await vscode.env.openExternal(vscode.Uri.parse(release.html_url));
	} else if (choice === 'Depois') {
		// não insiste até a próxima abertura da IDE
		await context.globalState.update('devcode.skipVersion', latest);
		setTimeout(() => context.globalState.update('devcode.skipVersion', undefined), CHECK_INTERVAL);
	}
}

function registerUpdater(context) {
	context.subscriptions.push(vscode.commands.registerCommand('devcode.checkForUpdates', () => checkForUpdates(context, { manual: true })));
	context.globalState.update('devcode.skipVersion', undefined);
	setTimeout(() => checkForUpdates(context), 8000);
	const timer = setInterval(() => checkForUpdates(context), CHECK_INTERVAL);
	context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

module.exports = { registerUpdater, compareVersions };
