/*---------------------------------------------------------------------------------------------
 *  DEV CODE - ambiente dos terminais e processos (Windows).
 *
 *  1) Política de execução do PowerShell: em PCs novos ela é "Restricted" e bloqueia o
 *     npm.ps1 / npx.ps1 (e a integração de shell do terminal). Os terminais do DEV CODE abrem
 *     com PSExecutionPolicyPreference=Bypass, que vale SÓ para aquele processo, sem mudar
 *     nada no Windows e para qualquer aluno/conta.
 *  2) PATH desatualizado: logo depois de o instalador instalar o Node/Python, a IDE herda o
 *     PATH antigo. Relemos o PATH do registro (máquina + usuário) e completamos o que faltar,
 *     tanto nos terminais quanto nos processos que a extensão executa (npm, git, python…).
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

function readRegistryPath(key) {
	return new Promise(resolve => {
		cp.execFile('reg', ['query', key, '/v', 'Path'], { windowsHide: true }, (err, stdout) => {
			if (err) { return resolve([]); }
			const m = /Path\s+REG(?:_EXPAND)?_SZ\s+(.*)/i.exec(String(stdout));
			if (!m) { return resolve([]); }
			const expanded = m[1].trim().replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all);
			resolve(expanded.split(';').map(s => s.trim()).filter(Boolean));
		});
	});
}

async function registerEnvFix(context) {
	if (process.platform !== 'win32') { return; }
	const env = context.environmentVariableCollection;
	env.description = 'DEV CODE: permite npm/npx no PowerShell e atualiza o PATH';
	env.replace('PSExecutionPolicyPreference', 'Bypass');

	const [machine, user] = await Promise.all([
		readRegistryPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
		readRegistryPath('HKCU\\Environment'),
	]);
	const norm = p => path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
	const current = new Set((process.env.PATH || '').split(';').filter(Boolean).map(norm));
	const missing = [...machine, ...user].filter(p => !current.has(norm(p)));
	if (missing.length) {
		const extra = missing.join(';');
		process.env.PATH = `${process.env.PATH};${extra}`;
		env.append('PATH', `;${extra}`);
	}
}

module.exports = { registerEnvFix };
