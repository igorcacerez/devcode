/*---------------------------------------------------------------------------------------------
 *  DEV CODE - login no GitHub pela própria IDE.
 *  Usa o provedor de autenticação embutido ("github-authentication": navegador ou código de
 *  dispositivo). O token nunca é gravado em disco pelo DEV CODE: ele é passado ao git só durante
 *  o comando, por variáveis de ambiente (GIT_CONFIG_*), e não aparece na lista de processos.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const https = require('https');

const SCOPES = ['repo', 'read:user', 'user:email'];
let session;
let accountItem;

function api(method, path, body) {
	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : undefined;
		const req = https.request({
			host: 'api.github.com', path, method,
			headers: {
				'Authorization': `Bearer ${session.accessToken}`,
				'Accept': 'application/vnd.github+json',
				'User-Agent': 'DEV-CODE-IDE',
				...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
			},
		}, res => {
			let out = '';
			res.on('data', c => out += c);
			res.on('end', () => {
				let json; try { json = JSON.parse(out || '{}'); } catch { json = {}; }
				res.statusCode >= 200 && res.statusCode < 300 ? resolve(json) : reject(new Error(json.message || `HTTP ${res.statusCode}`));
			});
		});
		req.on('error', reject);
		if (data) { req.write(data); }
		req.end();
	});
}

async function getSession(createIfNone) {
	try {
		session = await vscode.authentication.getSession('github', SCOPES, createIfNone ? { createIfNone: true } : { silent: true });
	} catch (err) {
		if (createIfNone) {
			vscode.window.showErrorMessage(`DEV CODE: não foi possível entrar no GitHub. ${err.message || err}`);
		}
		session = undefined;
	}
	updateAccountItem();
	return session;
}

async function login() {
	const s = await getSession(true);
	if (s) {
		vscode.window.showInformationMessage(`$(check) DEV CODE: conectado ao GitHub como ${s.account.label}.`);
	}
	return s;
}

async function logout() {
	if (!session) { return; }
	const ok = await vscode.window.showWarningMessage(`Sair da conta ${session.account.label} do GitHub?`, { modal: true }, 'Sair');
	if (ok !== 'Sair') { return; }
	// remove a conta da IDE (computador compartilhado do laboratório)
	await vscode.commands.executeCommand('workbench.action.removeAccountSession', { providerId: 'github', accountLabel: session.account.label })
		.then(undefined, () => undefined);
	session = undefined;
	await getSession(false);
	updateAccountItem();
}

const listeners = [];
function onDidChange(fn) { listeners.push(fn); }
function account() { return session?.account.label; }

function updateAccountItem() {
	for (const fn of listeners) { try { fn(); } catch { } }
	if (!accountItem) { return; }
	if (session) {
		accountItem.text = `$(github) ${session.account.label}`;
		accountItem.tooltip = 'Conectado ao GitHub. Clique para sair (importante em computadores do laboratório).';
		accountItem.command = 'devcode.github.logout';
	} else {
		accountItem.text = '$(github) Entrar no GitHub';
		accountItem.tooltip = 'Entrar na sua conta do GitHub para baixar e enviar projetos';
		accountItem.command = 'devcode.github.login';
	}
	accountItem.show();
}

/** Variáveis de ambiente que autenticam o git em https://github.com/ (sem gravar nada). */
function gitAuthEnv() {
	if (!session) { return {}; }
	const basic = Buffer.from(`x-access-token:${session.accessToken}`).toString('base64');
	return {
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
		GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
	};
}

/** Nome e e-mail do perfil (para os commits). */
async function profile() {
	if (!session) { return undefined; }
	try {
		const user = await api('GET', '/user');
		let email = user.email;
		if (!email) {
			const emails = await api('GET', '/user/emails').catch(() => []);
			email = (emails.find(e => e.primary) || emails[0] || {}).email;
		}
		return { name: user.name || user.login, email: email || `${user.id}+${user.login}@users.noreply.github.com`, login: user.login };
	} catch {
		return undefined;
	}
}

async function listRepos() {
	if (!session) { return []; }
	try { return await api('GET', '/user/repos?per_page=50&sort=updated&affiliation=owner,collaborator,organization_member'); } catch { return []; }
}

async function createRepo(name, isPrivate) {
	return api('POST', '/user/repos', { name, private: isPrivate, auto_init: false });
}

function isLoggedIn() { return !!session; }

function registerGithubAuth(context) {
	accountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 51);
	context.subscriptions.push(accountItem,
		vscode.commands.registerCommand('devcode.github.login', login),
		vscode.commands.registerCommand('devcode.github.logout', logout),
		vscode.authentication.onDidChangeSessions(e => { if (e.provider.id === 'github') { getSession(false); } }),
	);
	getSession(false);
}

module.exports = { registerGithubAuth, onDidChange, account, logout, login, isLoggedIn, gitAuthEnv, profile, listRepos, createRepo };
