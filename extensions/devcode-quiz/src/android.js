/*---------------------------------------------------------------------------------------------
 *  DEV CODE - emulador Android para projetos React Native (Expo).
 *
 *  Instalação única e sob demanda (só o que faltar, reaproveitando um SDK já existente, como o
 *  do Android Studio): Java 17, Android command-line tools, platform-tools, emulator e uma
 *  imagem Android 14 AOSP x86_64 (a mais leve, sem Google Play). Cria o aparelho "DevCode"
 *  (2 GB de RAM, sem animação de boot) e, ao executar um projeto Expo, liga o emulador e roda
 *  "npx expo start --android" — o Expo instala o Expo Go no emulador e abre o app.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const AVD = 'DevCode';
const API = '34';
const IMAGE = `system-images;android-${API};default;x86_64`;
const BASE = path.join(process.env.LOCALAPPDATA || os.homedir(), 'DevCode', 'android');
// instalado pelo instalador do DEV CODE (opção "Emulador Android"), para todos os usuários
const MACHINE = 'C:\\DevCode\\android';
const isWin = process.platform === 'win32';
const exe = name => (isWin ? `${name}.exe` : name);
const bat = name => (isWin ? `${name}.bat` : name);

// ------------------------------------------------------------------ localizar ferramentas
function candidateSdks() {
	return [path.join(MACHINE, 'sdk'), process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), path.join(BASE, 'sdk')]
		.filter(Boolean).filter((p, i, a) => a.indexOf(p) === i);
}
function findSdk() {
	return candidateSdks().find(p => fs.existsSync(path.join(p, 'emulator', exe('emulator'))) && fs.existsSync(path.join(p, 'platform-tools', exe('adb'))))
		|| candidateSdks().find(p => fs.existsSync(p) && fs.existsSync(path.join(p, 'platform-tools')))
		|| path.join(BASE, 'sdk');
}
function sdkManager(sdk) {
	for (const dir of ['latest', ...safeReaddir(path.join(sdk, 'cmdline-tools'))]) {
		const p = path.join(sdk, 'cmdline-tools', dir, 'bin', bat('sdkmanager'));
		if (fs.existsSync(p)) { return p; }
	}
	return undefined;
}
function safeReaddir(p) { try { return fs.readdirSync(p); } catch { return []; } }
function findJava() {
	const homes = [path.join(MACHINE, 'jre'), process.env.JAVA_HOME, path.join(BASE, 'jre'), 'C:\\Program Files\\Android\\Android Studio\\jbr', 'C:\\Program Files\\Android\\Android Studio\\jre']
		.filter(Boolean);
	for (const h of homes) {
		if (fs.existsSync(path.join(h, 'bin', exe('java')))) { return h; }
		// zip do Adoptium extrai numa subpasta (jdk-17.x-jre)
		for (const sub of safeReaddir(h)) { if (fs.existsSync(path.join(h, sub, 'bin', exe('java')))) { return path.join(h, sub); } }
	}
	return undefined;
}
function avdExists() {
	const dir = path.join(process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd'), `${AVD}.ini`);
	return fs.existsSync(dir);
}
function isReady() {
	const sdk = findSdk();
	return fs.existsSync(path.join(sdk, 'emulator', exe('emulator'))) && fs.existsSync(path.join(sdk, 'platform-tools', exe('adb'))) && avdExists();
}

function androidEnv(sdk, javaHome) {
	const extra = [path.join(sdk, 'platform-tools'), path.join(sdk, 'emulator')];
	if (javaHome) { extra.unshift(path.join(javaHome, 'bin')); }
	return { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ...(javaHome ? { JAVA_HOME: javaHome } : {}), PATH: `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH}` };
}

// ------------------------------------------------------------------ downloads
function download(url, dest, onProgress) {
	return new Promise((resolve, reject) => {
		https.get(url, { headers: { 'User-Agent': 'DEV-CODE' } }, res => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return download(new URL(res.headers.location, url).toString(), dest, onProgress).then(resolve, reject); }
			if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} em ${url}`)); }
			const total = +res.headers['content-length'] || 0; let got = 0;
			const out = fs.createWriteStream(dest);
			res.on('data', c => { got += c.length; if (total) { onProgress?.(got / total); } });
			res.pipe(out); out.on('finish', () => out.close(resolve)); out.on('error', reject);
		}).on('error', reject);
	});
}
function getText(url) {
	return new Promise((resolve, reject) => {
		https.get(url, { headers: { 'User-Agent': 'DEV-CODE' } }, res => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return getText(res.headers.location).then(resolve, reject); }
			let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
		}).on('error', reject);
	});
}
function unzip(zip, destDir) {
	fs.mkdirSync(destDir, { recursive: true });
	// tar.exe do próprio Windows (bsdtar) extrai .zip bem mais rápido que o Expand-Archive.
	// Caminho completo: o "tar" do Git (GNU) entenderia "C:" como um servidor remoto.
	const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
	return new Promise((resolve, reject) => {
		const fallback = () => cp.execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, '\'\'')}' -DestinationPath '${destDir.replace(/'/g, '\'\'')}' -Force`],
			{ windowsHide: true, maxBuffer: 1 << 26 }, err => err ? reject(err) : resolve());
		if (!fs.existsSync(winTar)) { return fallback(); }
		cp.execFile(winTar, ['-xf', zip, '-C', destDir], { windowsHide: true, maxBuffer: 1 << 26 }, err => err ? fallback() : resolve());
	});
}
function run(cmd, args, env, onLine, input) {
	return new Promise((resolve, reject) => {
		// .bat roda pelo cmd: sem aspas, o ";" de "system-images;android-34;..." separaria os argumentos
		const isBat = cmd.endsWith('.bat');
		const q = a => `"${String(a).replace(/"/g, '""')}"`;
		const p = isBat
			? cp.spawn(`${q(cmd)} ${args.map(q).join(' ')}`, { env: { ...process.env, ...env }, windowsHide: true, shell: true })
			: cp.spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
		const tail = [];
		const feed = d => String(d).split(/\r|\n/).forEach(l => { l = l.trim(); if (!l) { return; } tail.push(l); if (tail.length > 6) { tail.shift(); } onLine?.(l); });
		p.stdout.on('data', feed); p.stderr.on('data', feed);
		if (input) { p.stdin.write(input); }
		p.stdin.end();
		p.on('error', reject);
		p.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} terminou com código ${code}: ${tail.filter(l => !/^\[=*\s*\]/.test(l)).slice(-3).join(' | ')}`)));
	});
}

// ------------------------------------------------------------------ instalação
function imageInstalled(sdk) {
	return fs.existsSync(path.join(sdk, 'system-images', `android-${API}`, 'default', 'x86_64'))
		&& fs.existsSync(path.join(sdk, 'emulator', exe('emulator'))) && fs.existsSync(path.join(sdk, 'platform-tools', exe('adb')));
}

async function setup() {
	if (isReady()) {
		vscode.window.showInformationMessage('DEV CODE: o emulador Android já está instalado. ✔');
		return true;
	}
	const sdkNow = findSdk();
	const onlyAvd = imageInstalled(sdkNow) && !!sdkManager(sdkNow) && !!findJava();
	const ok = onlyAvd ? 'Instalar' : await vscode.window.showInformationMessage(
		'Instalar o emulador Android do DEV CODE? Ele é baixado uma única vez (cerca de 1,5 GB) e fica disponível para todos os projetos React Native.',
		{ modal: true }, 'Instalar');
	if (ok !== 'Instalar') { return false; }

	try {
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: onlyAvd ? 'DEV CODE: preparando o emulador Android' : 'DEV CODE: instalando o emulador Android', cancellable: false }, async progress => {
			const step = m => progress.report({ message: m });
			fs.mkdirSync(BASE, { recursive: true });
			const tmp = os.tmpdir();
			const sdk = findSdk();
			fs.mkdirSync(sdk, { recursive: true });

			// 1) Java 17 (necessário para o sdkmanager)
			let javaHome = findJava();
			if (!javaHome) {
				step('baixando o Java 17…');
				const zip = path.join(tmp, 'devcode-jre17.zip');
				await download('https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse', zip, f => step(`baixando o Java 17… ${Math.round(f * 100)}%`));
				step('extraindo o Java…');
				await unzip(zip, path.join(BASE, 'jre'));
				javaHome = findJava();
				if (!javaHome) { throw new Error('não foi possível preparar o Java.'); }
			}

			// 2) Android command-line tools
			let mgr = sdkManager(sdk);
			if (!mgr) {
				step('procurando as ferramentas do Android…');
				const xml = await getText('https://dl.google.com/android/repository/repository2-3.xml');
				const m = /commandlinetools-win-(\d+)_latest\.zip/.exec(xml);
				if (!m) { throw new Error('não encontrei as command-line tools do Android.'); }
				const zip = path.join(tmp, m[0]);
				if (!fs.existsSync(zip)) { await download(`https://dl.google.com/android/repository/${m[0]}`, zip, f => step(`baixando as ferramentas do Android… ${Math.round(f * 100)}%`)); }
				step('extraindo as ferramentas…');
				const extract = path.join(BASE, 'cmdline-extract');
				fs.rmSync(extract, { recursive: true, force: true });
				await unzip(zip, extract);
				const latest = path.join(sdk, 'cmdline-tools', 'latest');
				fs.rmSync(latest, { recursive: true, force: true });
				fs.mkdirSync(path.dirname(latest), { recursive: true });
				fs.renameSync(path.join(extract, 'cmdline-tools'), latest);
				mgr = sdkManager(sdk);
			}
			const env = androidEnv(sdk, javaHome);

			// 3) licenças + pacotes (pulado se o instalador já deixou tudo pronto)
			if (!onlyAvd) {
			step('aceitando as licenças do Android SDK…');
			await run(mgr, [`--sdk_root=${sdk}`, '--licenses'], env, undefined, 'y\n'.repeat(30)).catch(() => undefined);
			step('baixando o Android (pode levar alguns minutos)…');
			await run(mgr, [`--sdk_root=${sdk}`, 'platform-tools', 'emulator', IMAGE], env, line => {
				const pct = /(\d+)%/.exec(line);
				if (pct) { step(`baixando o Android… ${pct[1]}%`); }
			});

			}

			// 4) aparelho virtual leve
			step('criando o aparelho virtual "DevCode"…');
			const avdmanager = path.join(path.dirname(mgr), bat('avdmanager'));
			await run(avdmanager, ['create', 'avd', '-n', AVD, '-k', IMAGE, '-d', 'pixel_4', '--force'], env, undefined, 'no\n');
			const cfg = path.join(process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd'), `${AVD}.avd`, 'config.ini');
			if (fs.existsSync(cfg)) {
				let c = fs.readFileSync(cfg, 'utf8');
				const set = (k, v) => { c = new RegExp(`^${k.replace(/\./g, '\\.')}=.*$`, 'm').test(c) ? c.replace(new RegExp(`^${k.replace(/\./g, '\\.')}=.*$`, 'm'), `${k}=${v}`) : `${c}\n${k}=${v}`; };
				set('hw.ramSize', '2048'); set('vm.heapSize', '256'); set('hw.keyboard', 'yes'); set('hw.gpu.enabled', 'yes');
				set('hw.gpu.mode', 'auto'); set('showDeviceFrame', 'no'); set('fastboot.forceColdBoot', 'no'); set('hw.audioInput', 'no');
				fs.writeFileSync(cfg, c);
			}
		});
		if (!onlyAvd) { vscode.window.showInformationMessage('DEV CODE: emulador Android instalado! Agora o ▶/F5 dos projetos React Native abre o app nele. ✔'); }
		return true;
	} catch (err) {
		vscode.window.showErrorMessage(`DEV CODE: não foi possível instalar o emulador Android. ${err.message || err}`, { modal: true });
		return false;
	}
}

// ------------------------------------------------------------------ ligar o emulador
function adb(sdk, args) {
	return new Promise(resolve => cp.execFile(path.join(sdk, 'platform-tools', exe('adb')), args, { windowsHide: true, timeout: 15000 }, (err, out) => resolve(err ? '' : String(out))));
}
async function runningEmulator(sdk) {
	const out = await adb(sdk, ['devices']);
	return /emulator-\d+\s+device/.test(out);
}
async function startEmulator() {
	const sdk = findSdk();
	if (await runningEmulator(sdk)) { return sdk; }
	await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DEV CODE: ligando o emulador Android…' }, async progress => {
		const child = cp.spawn(path.join(sdk, 'emulator', exe('emulator')),
			['-avd', AVD, '-no-boot-anim', '-netdelay', 'none', '-netspeed', 'full', '-no-audio', '-gpu', 'auto'],
			{ detached: true, stdio: 'ignore', env: { ...process.env, ...androidEnv(sdk, findJava()) } });
		child.unref();
		const start = Date.now();
		while (Date.now() - start < 240000) {
			await new Promise(r => setTimeout(r, 3000));
			if (await runningEmulator(sdk)) {
				const booted = (await adb(sdk, ['shell', 'getprop', 'sys.boot_completed'])).trim();
				progress.report({ message: booted === '1' ? 'pronto!' : 'iniciando o Android…' });
				if (booted === '1') { return; }
			}
		}
		throw new Error('o emulador demorou demais para iniciar. Verifique se a virtualização (Plataforma do Hipervisor do Windows) está ativada.');
	});
	return sdk;
}

/**
 * Prepara o emulador para rodar um projeto Expo.
 * @returns {Promise<{env: object} | undefined>} variáveis de ambiente para o terminal, ou undefined para usar o celular (QR Code)
 */
async function prepareForExpo(context) {
	if (process.platform !== 'win32') { return undefined; }
	const pref = vscode.workspace.getConfiguration('devcode').get('expo.target', 'perguntar');
	if (pref === 'celular') { return undefined; }
	if (!isReady() && imageInstalled(findSdk()) && pref !== 'celular') {
		if (!(await setup())) { return undefined; }
	}
	if (!isReady()) {
		const c = await vscode.window.showInformationMessage(
			'Onde você quer ver o app React Native?',
			{ modal: true, detail: 'O emulador Android abre o app no próprio computador (instalação única de ~1,5 GB). Pelo celular, use o app Expo Go e leia o QR Code.' },
			'Emulador Android', 'No meu celular (QR Code)');
		if (c !== 'Emulador Android') { return undefined; }
		if (!(await setup())) { return undefined; }
	}
	try {
		const sdk = await startEmulator();
		return androidEnv(sdk, findJava());
	} catch (err) {
		vscode.window.showErrorMessage(`DEV CODE: ${err.message || err}`, { modal: true });
		return undefined;
	}
	void context;
}

function registerAndroid(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand('devcode.android.setup', setup),
		vscode.commands.registerCommand('devcode.android.start', async () => { if (isReady() || await setup()) { await startEmulator().catch(err => vscode.window.showErrorMessage(`DEV CODE: ${err.message}`)); } }),
	);
}

module.exports = { registerAndroid, prepareForExpo, isReady };
