/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Git simplificado (só cliques).
 *    - Projeto do Git: cola o link → escolhe a pasta → a IDE faz o clone e abre.
 *    - ☁↑ Enviar (commit + push): pede só a mensagem.
 *    - ☁↓ Atualizar (pull): baixa as mudanças; commits assinados ou repositórios confiados são aceitos.
 *  Git pelo terminal é bloqueado (terminalGuard) — tudo passa por aqui ou pela aba Source Control.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const gh = require('./githubAuth');
const authorship = require('./authorship');
const signature = require('./signature');
let extensionPath;

/** git com rede (clone/push/pull): usa a conta do GitHub logada na IDE, se houver. */
function gitNet(args, cwd, timeout = 600000) {
	return new Promise(resolve => cp.execFile('git', args, {
		cwd, timeout, windowsHide: gh.isLoggedIn(),
		env: { ...process.env, ...gh.gitAuthEnv(), ...(gh.isLoggedIn() ? { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } : {}) },
	}, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })));
}

function run(cwd, args, timeout = 300000) {
	return new Promise(resolve => {
		cp.execFile('git', args, { cwd, windowsHide: true, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
			(err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() }));
	});
}

async function gitAvailable() {
	const r = await run(undefined, ['--version'], 10000);
	if (!r.ok) {
		vscode.window.showErrorMessage('DEV CODE: o Git não está instalado neste computador. Peça ao professor para instalar o Git for Windows.', { modal: true });
	}
	return r.ok;
}

function repoNameFromUrl(url) {
	const m = /([^/:]+?)(\.git)?\/?$/.exec(url.trim());
	return m ? m[1] : 'projeto';
}

/** Projeto do Git: clona e registra a pasta como projeto confiável. */
async function cloneProject(trustFolderChecked, presetUrl) {
	if (!(await gitAvailable())) { return; }
	let url = presetUrl;
	const repos = url ? [] : await gh.listRepos();
	if (!url && (repos.length || !gh.isLoggedIn())) {
		const items = [
			...(gh.isLoggedIn() ? [] : [{ label: '$(github) Entrar no GitHub para ver meus repositórios', id: 'login' }]),
			{ label: '$(link) Colar o link de um repositório', id: 'paste' },
			...(repos.length ? [{ label: 'Meus repositórios', kind: vscode.QuickPickItemKind.Separator }] : []),
			...repos.map(rp => ({ label: `$(${rp.private ? 'lock' : 'repo'}) ${rp.full_name}`, description: rp.description || '', url: rp.clone_url })),
		];
		const pick = await vscode.window.showQuickPick(items, { title: 'Projeto do Git: qual projeto você quer baixar?', ignoreFocusOut: true, matchOnDescription: true });
		if (!pick) { return; }
		if (pick.id === 'login') {
			if (await gh.login()) { return cloneProject(trustFolderChecked); }
			return;
		}
		url = pick.url;
	}
	if (!url) url = await vscode.window.showInputBox({
		title: 'Projeto do Git (1/2): cole o link do repositório',
		placeHolder: 'https://github.com/usuario/meu-projeto.git',
		ignoreFocusOut: true,
		validateInput: v => /^(https?:\/\/|git@)[\w.@:/~-]+$/.test(v.trim()) ? undefined : 'Cole um link válido (ex.: https://github.com/usuario/projeto)',
	});
	if (!url) { return; }
	const parent = await vscode.window.showOpenDialog({
		title: 'Projeto do Git (2/2): onde salvar o projeto?',
		openLabel: 'Baixar aqui', canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
	});
	if (!parent?.[0]) { return; }
	const dir = path.join(parent[0].fsPath, repoNameFromUrl(url));
	if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
		vscode.window.showErrorMessage(`DEV CODE: a pasta "${dir}" já existe. Escolha outro local.`, { modal: true });
		return;
	}
	const r = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `DEV CODE: baixando ${repoNameFromUrl(url)}…` },
		() => new Promise(resolve => {
			// logado na IDE: usa a conta; senão, o Git Credential Manager abre o login
			gitNet(['clone', url.trim(), dir]).then(resolve);
		}));
	if (!r.ok) {
		vscode.window.showErrorMessage(`DEV CODE: não foi possível baixar o projeto.\n${r.err}`, { modal: true });
		return;
	}
	await trustFolderChecked(dir);
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), { forceNewWindow: !!vscode.workspace.workspaceFolders?.length });
}

function currentRepo() {
	const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	return folder && fs.existsSync(path.join(folder, '.git')) ? folder : undefined;
}

/** Garante user.name / user.email (primeiro commit no computador do laboratório). */
async function ensureIdentity(repo) {
	const name = (await run(repo, ['config', 'user.name'])).out;
	const email = (await run(repo, ['config', 'user.email'])).out;
	if (name && email) { return true; }
	const prof = await gh.profile();
	if (prof) {
		await run(repo, ['config', 'user.name', prof.name]);
		await run(repo, ['config', 'user.email', prof.email]);
		return true;
	}
	const n = name || await vscode.window.showInputBox({ title: 'Git: seu nome (aparece nos commits)', ignoreFocusOut: true, validateInput: v => v.trim() ? undefined : 'Digite seu nome' });
	if (!n) { return false; }
	const e = email || await vscode.window.showInputBox({ title: 'Git: seu e-mail do GitHub', ignoreFocusOut: true, validateInput: v => /.+@.+/.test(v) ? undefined : 'Digite um e-mail válido' });
	if (!e) { return false; }
	await run(repo, ['config', 'user.name', n.trim()]);
	await run(repo, ['config', 'user.email', e.trim()]);
	return true;
}

/** ☁↑ Enviar: add + commit + push. */
async function commitAndPush() {
	const repo = currentRepo();
	if (!repo) {
		const init = await vscode.window.showInformationMessage('DEV CODE: este projeto ainda não está no Git. Para enviar, crie um repositório vazio no GitHub e cole o link.', 'Conectar ao GitHub');
		if (init === 'Conectar ao GitHub') { await connectRemote(); }
		return;
	}
	if (!(await gitAvailable()) || !(await ensureIdentity(repo))) { return; }
	await vscode.workspace.saveAll(false);
	const status = await run(repo, ['status', '--porcelain']);
	if (status.ok && !status.out) {
		// nada para commitar: tenta só enviar commits pendentes
		return push(repo, 'Nada novo para salvar. Enviando commits pendentes…');
	}
	const message = await vscode.window.showInputBox({
		title: 'Enviar para o GitHub: o que você fez?',
		placeHolder: 'ex.: Criei a função de calcular média',
		ignoreFocusOut: true,
		validateInput: v => v.trim().length >= 3 ? undefined : 'Escreva uma mensagem curta descrevendo a mudança',
	});
	if (!message) { return; }
	const add = await run(repo, ['add', '-A']);
	const commit = add.ok ? await run(repo, ['commit', '-m', message.trim()]) : add;
	if (!commit.ok) {
		vscode.window.showErrorMessage(`DEV CODE: falha ao salvar (commit).\n${commit.err || commit.out}`, { modal: true });
		return;
	}
	if (!(await authorship.signHeadCommit(repo))) {
		vscode.window.showErrorMessage('DEV CODE: o commit foi criado, mas não foi possível assinar suas alterações. O envio foi cancelado.', { modal: true });
		return;
	}
	return push(repo, 'Enviando para o GitHub…');
}

async function push(repo, title) {
	const remote = (await run(repo, ['remote'])).out;
	if (!remote) {
		vscode.window.showInformationMessage('DEV CODE: commit salvo localmente. Conecte o projeto a um repositório do GitHub para enviar.', 'Conectar ao GitHub')
			.then(c => c && connectRemote());
		return;
	}
	const branch = (await run(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).out || 'main';
	const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `DEV CODE: ${title}` },
		() => gitNet(['push', '-u', 'origin', branch], repo, 300000));
	if (r.ok) {
		vscode.window.showInformationMessage('$(check) DEV CODE: projeto enviado para o GitHub!');
	} else if (/rejected|fetch first|non-fast-forward/i.test(r.err)) {
		const c = await vscode.window.showWarningMessage('DEV CODE: o GitHub tem mudanças que você ainda não baixou. Atualize (pull) primeiro.', 'Atualizar agora');
		if (c) { await pull(); }
	} else {
		vscode.window.showErrorMessage(`DEV CODE: falha ao enviar.\n${r.err}`, { modal: true });
	}
}

/** ☁↓ Atualizar: git pull e revalida os arquivos (os vindos do git são aceitos). */
async function pull(rescan) {
	const repo = currentRepo();
	if (!repo || !(await gitAvailable())) { return; }
	await vscode.workspace.saveAll(false);
	const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DEV CODE: baixando atualizações do GitHub…' },
		() => gitNet(['pull', '--no-rebase', '--no-edit'], repo, 300000));
	if (r.ok && (await signature.headParentCount(repo)) >= 2) {
		await signature.signHead(repo);
	}
	if (rescan) { await rescan(); }
	if (r.ok) {
		vscode.window.showInformationMessage(/Already up to date|Já está atualizado/i.test(r.out) ? 'DEV CODE: o projeto já está atualizado.' : '$(check) DEV CODE: projeto atualizado!');
	} else if (/conflict/i.test(r.out + r.err)) {
		vscode.window.showWarningMessage('DEV CODE: há conflitos entre a sua versão e a do GitHub. Abra a aba Controle de Código-Fonte para resolver.');
		vscode.commands.executeCommand('workbench.view.scm');
	} else {
		vscode.window.showErrorMessage(`DEV CODE: falha ao atualizar.\n${r.err}`, { modal: true });
	}
}

/** Conecta um projeto local (criado pelo assistente) a um repositório vazio do GitHub. */
async function connectRemote() {
	const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!folder || !(await gitAvailable())) { return; }
	let url;
	const how = await vscode.window.showQuickPick([
		{ label: '$(add) Criar um repositório novo na minha conta', description: gh.isLoggedIn() ? '' : 'pede para entrar no GitHub', id: 'create' },
		{ label: '$(link) Colar o link de um repositório vazio que já criei', id: 'paste' },
	], { title: 'Conectar ao GitHub', ignoreFocusOut: true });
	if (!how) { return; }
	if (how.id === 'create') {
		if (!gh.isLoggedIn() && !(await gh.login())) { return; }
		const name = await vscode.window.showInputBox({
			title: 'Nome do repositório no GitHub', value: path.basename(folder), ignoreFocusOut: true,
			validateInput: v => /^[\w.-]+$/.test(v.trim()) ? undefined : 'Use letras, números, ponto, - ou _',
		});
		if (!name) { return; }
		const vis = await vscode.window.showQuickPick([
			{ label: '$(lock) Privado', description: 'só você (e quem você convidar) vê', priv: true },
			{ label: '$(globe) Público', description: 'qualquer pessoa vê', priv: false },
		], { title: 'Visibilidade do repositório', ignoreFocusOut: true });
		if (!vis) { return; }
		try {
			const repo = await gh.createRepo(name.trim(), vis.priv);
			url = repo.clone_url;
		} catch (err) {
			vscode.window.showErrorMessage(`DEV CODE: não foi possível criar o repositório. ${err.message}`, { modal: true });
			return;
		}
	}
	if (!url) url = await vscode.window.showInputBox({
		title: 'Conectar ao GitHub: cole o link do repositório VAZIO',
		placeHolder: 'https://github.com/usuario/meu-projeto.git',
		ignoreFocusOut: true,
		validateInput: v => /^(https?:\/\/|git@)[\w.@:/~-]+$/.test(v.trim()) ? undefined : 'Cole um link válido',
	});
	if (!url) { return; }
	if (!fs.existsSync(path.join(folder, '.git'))) {
		await run(folder, ['init', '-b', 'main']);
		if (!fs.existsSync(path.join(folder, '.gitignore'))) {
			fs.writeFileSync(path.join(folder, '.gitignore'), '.venv/\n__pycache__/\nnode_modules/\n');
		}
	}
	await authorship.installHooks(folder, extensionPath);
	await run(folder, ['remote', 'remove', 'origin']);
	await run(folder, ['remote', 'add', 'origin', url.trim()]);
	updateStatusBar();
	await commitAndPush();
}

let pushItem, pullItem;

function updateStatusBar() {
	const has = !!currentRepo();
	pushItem.text = has ? '$(cloud-upload) Enviar' : '$(github) Conectar ao GitHub';
	pushItem.tooltip = has ? 'Salvar (commit) e enviar (push) para o GitHub' : 'Conectar este projeto a um repositório do GitHub';
	pushItem.command = has ? 'devcode.git.commitPush' : 'devcode.git.connect';
	if (vscode.workspace.workspaceFolders?.length) { pushItem.show(); } else { pushItem.hide(); }
	if (has) { pullItem.show(); } else { pullItem.hide(); }
}

function registerGit(context, { rescan }) {
	extensionPath = context.extensionPath;
	gh.registerGithubAuth(context);
	pushItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	pullItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
	pullItem.text = '$(cloud-download) Atualizar';
	pullItem.tooltip = 'Baixar as atualizações do GitHub (pull)';
	pullItem.command = 'devcode.git.pull';
	context.subscriptions.push(pushItem, pullItem,
		vscode.commands.registerCommand('devcode.git.commitPush', commitAndPush),
		vscode.commands.registerCommand('devcode.git.pull', () => pull(rescan)),
		vscode.commands.registerCommand('devcode.git.connect', connectRemote),
	);
	updateStatusBar();
}

module.exports = { registerGit, cloneProject, run, gitNet, currentRepo, ensureIdentity, push, pull, connectRemote, gitAvailable, updateStatusBar };
