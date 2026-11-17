/*---------------------------------------------------------------------------------------------
 *  DEV CODE - "Novo Projeto Python" no estilo PyCharm:
 *  nome → pasta → interpretador Python → cria a pasta, a .venv, main.py e as configurações.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const { trustFolder, listTrustedFolders } = require('./fileGuard');
const { cloneProject } = require('./git');
const { newReactProject, newExpoProject } = require('./jsProjects');
const { emptyPrototype } = require('./prototypeEditor');

let extContext;
function initProjects(context) { extContext = context; }

function exec(file, args, opts) {
	return new Promise(resolve => {
		cp.execFile(file, args, { timeout: 120000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
			resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
		});
	});
}

/** Caminho do python dentro de uma venv. */
function venvPython(dir) {
	return isWin ? path.join(dir, '.venv', 'Scripts', 'python.exe') : path.join(dir, '.venv', 'bin', 'python');
}

/** Procura interpretadores Python instalados. */
async function findInterpreters() {
	const found = new Set();
	if (isWin) {
		const py = await exec('py', ['-0p']);
		for (const line of py.stdout.split(/\r?\n/)) {
			const m = /([A-Za-z]:\\.*python(?:w)?\.exe)\s*$/i.exec(line.trim());
			if (m) { found.add(m[1]); }
		}
		const where = await exec('where', ['python']);
		where.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
			.filter(p => !/WindowsApps/i.test(p)) // atalho da Microsoft Store que não é um Python real
			.forEach(p => found.add(p));
		const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : undefined;
		if (local && fs.existsSync(local)) {
			for (const d of fs.readdirSync(local)) {
				const exe = path.join(local, d, 'python.exe');
				if (fs.existsSync(exe)) { found.add(exe); }
			}
		}
	} else {
		for (const name of ['python3', 'python']) {
			const r = await exec('which', ['-a', name]);
			r.stdout.split('\n').map(s => s.trim()).filter(Boolean).forEach(p => found.add(p));
		}
	}
	const result = [];
	const seen = new Set();
	for (const p of found) {
		const v = await exec(p, ['--version']);
		const key = (fs.existsSync(p) ? fs.realpathSync(p) : p).toLowerCase();
		if (v.ok && !seen.has(key)) {
			seen.add(key);
			result.push({ path: p, version: (v.stdout || v.stderr).trim() });
		}
	}
	return result;
}

async function pickInterpreter() {
	const interpreters = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'DEV CODE: procurando instalações do Python…' },
		findInterpreters);
	const browse = { label: '$(folder-opened) Procurar python no computador…', browse: true };
	const items = interpreters.map(i => ({ label: `$(symbol-namespace) ${i.version}`, description: i.path, path: i.path }));
	const choice = await vscode.window.showQuickPick([...items, browse], {
		title: 'Novo Projeto Python (3/3): escolha o interpretador base',
		placeHolder: items.length ? 'Selecione o Python que será usado para criar a .venv' : 'Nenhum Python encontrado: procure o executável manualmente',
		ignoreFocusOut: true,
	});
	if (!choice) { return undefined; }
	if (!choice.browse) { return choice.path; }
	const file = await vscode.window.showOpenDialog({
		title: 'Selecione o executável do Python',
		canSelectMany: false,
		filters: isWin ? { 'Python': ['exe'] } : undefined,
	});
	if (!file?.[0]) { return undefined; }
	const p = file[0].fsPath;
	const v = await exec(p, ['--version']);
	if (!v.ok) {
		vscode.window.showErrorMessage(`DEV CODE: "${p}" não parece ser um Python válido.`);
		return undefined;
	}
	return p;
}

const HTML_FILES = {
	'index.html': `<!DOCTYPE html>
<html lang="pt-BR">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Meu Projeto</title>
	<link rel="stylesheet" href="css/style.css">
</head>
<body>

	<script src="js/script.js"></script>
</body>
</html>
`,
	'css/style.css': '/* Escreva o seu CSS aqui */\n',
	'js/script.js': '// Escreva o seu JavaScript aqui\n',
};

async function openProject(dir) {
	trustFolder(extContext, dir); // só pastas criadas pelo DEV CODE podem ser abertas
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), { forceNewWindow: !!vscode.workspace.workspaceFolders?.length });
}

/** Ponto de entrada: escolhe o tipo do projeto. */
async function newProject() {
	const recent = listTrustedFolders(extContext).slice(0, 8).map(f => ({
		label: `$(folder) ${path.basename(f.root)}`, description: f.root, id: 'open', root: f.root,
	}));
	const items = [
		{ label: 'Criar', kind: vscode.QuickPickItemKind.Separator },
		{ label: '$(symbol-method) Novo projeto Python', description: 'com ambiente virtual (.venv), estilo PyCharm', id: 'python' },
		{ label: '$(notebook) Novo projeto Colab (notebook Python)', description: 'células de código com o resultado embaixo, como no Google Colab', id: 'colab' },
		{ label: '$(symbol-color) Novo Protótipo (telas, estilo Figma)', description: 'desenhe as telas do app/site: frames, camadas e estilos', id: 'prototipo' },
		{ label: '$(globe) Novo projeto HTML / CSS / JavaScript', description: 'site com Live Server (recarrega sozinho)', id: 'html' },
		{ label: '$(symbol-event) Novo projeto React', description: 'Vite + React, mínimo, sem TypeScript', id: 'react' },
		{ label: '$(device-mobile) Novo projeto React Native (Expo)', description: 'template blank, sem TypeScript', id: 'expo' },
		{ label: '$(github) Projeto do Git', description: 'cole o link do seu repositório e a IDE baixa (git clone)', id: 'git' },
	];
	if (recent.length) {
		items.push({ label: 'Abrir projeto recente', kind: vscode.QuickPickItemKind.Separator }, ...recent);
	}
	const type = await vscode.window.showQuickPick(items, { title: 'DEV CODE: o que você quer fazer?', ignoreFocusOut: true });
	if (!type) { return; }
	return runProjectAction(type.id, type.root);
}

/** Executa uma ação de projeto (usada pelo menu rápido e pela Tela Inicial). */
async function runProjectAction(id, root) {
	switch (id) {
		case 'python': return newPythonProject();
		case 'colab': return newColabProject();
		case 'prototipo': return newPrototypeProject();
		case 'html': return newHtmlProject();
		case 'react': return newReactProject(openProject);
		case 'expo': return newExpoProject(openProject);
		case 'git': return cloneProject(dir => trustFolder(extContext, dir));
		case 'open': return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: !!vscode.workspace.workspaceFolders?.length });
	}
}

async function newHtmlProject() {
	const name = await vscode.window.showInputBox({
		title: 'Novo Projeto HTML (1/2): nome do projeto',
		placeHolder: 'meu_site',
		ignoreFocusOut: true,
		validateInput: v => !v.trim() ? 'Digite um nome' : /[<>:"/\\|?*]/.test(v) ? 'Nome contém caracteres inválidos' : undefined,
	});
	if (!name) { return; }
	const parent = await vscode.window.showOpenDialog({
		title: 'Novo Projeto HTML (2/2): onde criar o projeto?',
		openLabel: 'Criar aqui', canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
	});
	if (!parent?.[0]) { return; }
	const dir = path.join(parent[0].fsPath, name.trim());
	if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
		vscode.window.showErrorMessage(`DEV CODE: a pasta "${dir}" já existe e não está vazia. Escolha outro nome ou local.`, { modal: true });
		return;
	}
	fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
	for (const [rel, content] of Object.entries(HTML_FILES)) {
		const file = path.join(dir, rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		if (!fs.existsSync(file)) {
			fs.writeFileSync(file, rel === 'index.html' ? content.replace('Meu Projeto', name.trim()) : content);
		}
	}
	fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), JSON.stringify({ 'devcode.projectType': 'html' }, null, '\t'));
	await openProject(dir);
}

/** Notebook inicial do projeto Colab. */
function colabNotebook(name) {
	const md = text => ({ cell_type: 'markdown', metadata: {}, source: text.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l) });
	const code = text => ({ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: text ? [text] : [] });
	return JSON.stringify({
		cells: [
			md(`# ${name}\n\nEscreva seu código nas células e clique em **▶** (ou **Ctrl+Enter**) para executar. O resultado aparece logo abaixo.\n\n- **Shift+Enter**: executa e vai para a próxima célula\n- **+ Código** / **+ Markdown**: adicionam novas células\n- As variáveis continuam valendo entre as células (como no Colab)\n- Para começar do zero, use **Reiniciar** na barra do notebook`),
			code(''),
		],
		metadata: {
			kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
			language_info: { name: 'python' },
		},
		nbformat: 4,
		nbformat_minor: 5,
	}, null, 1);
}

async function newPrototypeProject() {
	const name = await vscode.window.showInputBox({
		title: 'Novo Protótipo (1/2): nome do projeto', placeHolder: 'app-delivery', ignoreFocusOut: true,
		validateInput: v => !v.trim() ? 'Digite um nome' : /[<>:"/\\|?*]/.test(v) ? 'Nome contém caracteres inválidos' : undefined,
	});
	if (!name) { return; }
	const parent = await vscode.window.showOpenDialog({ title: 'Novo Protótipo (2/2): onde criar o projeto?', openLabel: 'Criar aqui', canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
	if (!parent?.[0]) { return; }
	const dir = path.join(parent[0].fsPath, name.trim());
	if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
		vscode.window.showErrorMessage(`DEV CODE: a pasta "${dir}" já existe e não está vazia. Escolha outro nome ou local.`, { modal: true });
		return;
	}
	fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'imagens'), { recursive: true });
	const model = emptyPrototype();
	model.nodes[0].name = 'Tela inicial (Mobile)';
	fs.writeFileSync(path.join(dir, 'telas.devproto'), JSON.stringify(model, null, '\t'));
	fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), JSON.stringify({ 'devcode.projectType': 'prototipo' }, null, '\t'));
	await openProject(dir);
}

async function newColabProject() {
	return newPythonProject('colab');
}

async function newPythonProject(kind = 'python') {
	const kindLabel = kind === 'colab' ? 'Colab' : 'Python';
	// 1) Nome
	const name = await vscode.window.showInputBox({
		title: `Novo Projeto ${kindLabel} (1/3): nome do projeto`,
		placeHolder: 'meu_projeto',
		ignoreFocusOut: true,
		validateInput: v => !v.trim() ? 'Digite um nome' : /[<>:"/\\|?*]/.test(v) ? 'Nome contém caracteres inválidos' : undefined,
	});
	if (!name) { return; }

	// 2) Local
	const parent = await vscode.window.showOpenDialog({
		title: `Novo Projeto ${kindLabel} (2/3): onde criar o projeto?`,
		openLabel: 'Criar aqui',
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
	});
	if (!parent?.[0]) { return; }
	const dir = path.join(parent[0].fsPath, name.trim());
	if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
		vscode.window.showErrorMessage(`DEV CODE: a pasta "${dir}" já existe e não está vazia. Escolha outro nome ou local.`, { modal: true });
		return;
	}

	// 3) Interpretador
	const basePython = await pickInterpreter();
	if (!basePython) { return; }

	// 4) Criar pasta + venv + arquivos
	const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `DEV CODE: criando o projeto "${name}"…` }, async progress => {
		fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
		progress.report({ message: 'criando o ambiente virtual (.venv)…' });
		const r = await exec(basePython, ['-m', 'venv', '.venv'], { cwd: dir });
		if (!r.ok || !fs.existsSync(venvPython(dir))) {
			vscode.window.showErrorMessage(`DEV CODE: falha ao criar a venv.\n${r.stderr}`, { modal: true });
			return false;
		}
		progress.report({ message: 'escrevendo arquivos…' });
		if (kind === 'colab') {
			const nb = path.join(dir, 'aula.ipynb');
			if (!fs.existsSync(nb)) { fs.writeFileSync(nb, colabNotebook(name.trim())); }
		} else {
			const mainPy = path.join(dir, 'main.py');
			if (!fs.existsSync(mainPy)) {
				fs.writeFileSync(mainPy, '# Escreva o seu código aqui\n\n');
			}
		}
		const scripts = isWin ? '${workspaceFolder}\\.venv\\Scripts' : '${workspaceFolder}/.venv/bin';
		const sep = isWin ? ';' : ':';
		const envKey = isWin ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
		const settings = {
			'devcode.pythonPath': isWin ? '${workspaceFolder}\\.venv\\Scripts\\python.exe' : '${workspaceFolder}/.venv/bin/python',
			'python.defaultInterpreterPath': isWin ? '${workspaceFolder}\\.venv\\Scripts\\python.exe' : '${workspaceFolder}/.venv/bin/python',
			[`terminal.integrated.env.${envKey}`]: {
				'VIRTUAL_ENV': isWin ? '${workspaceFolder}\\.venv' : '${workspaceFolder}/.venv',
				'PATH': `${scripts}${sep}\${env:PATH}`,
			},
			'files.exclude': { '**/__pycache__': true },
			'devcode.projectType': kind,
		};
		fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), JSON.stringify(settings, null, '\t'));
		// basedpyright: autocomplete enxerga os pacotes instalados na .venv
		fs.writeFileSync(path.join(dir, 'pyrightconfig.json'), JSON.stringify({ venvPath: '.', venv: '.venv', typeCheckingMode: 'basic' }, null, '\t'));
		fs.writeFileSync(path.join(dir, 'requirements.txt'), '');
		fs.writeFileSync(path.join(dir, '.gitignore'), '.venv/\n__pycache__/\n');
		return true;
	});
	if (!ok) { return; }

	// 5) Abrir o projeto (main.py é aberto na ativação, ver extension.js)
	await openProject(dir);
}

/** Ao abrir um projeto recém-criado sem editores abertos, abre o main.py. */
function openMainIfEmpty() {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder || vscode.window.visibleTextEditors.length) { return; }
	for (const f of ['telas.devproto', 'aula.ipynb', 'main.py', 'index.html', 'src/App.jsx', 'App.js']) {
		const main = path.join(folder.uri.fsPath, f);
		if (fs.existsSync(main) && fs.statSync(main).size < 4000) {
			if (f.endsWith('.devproto')) {
				vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(main), 'devcode.prototype');
			} else if (f.endsWith('.ipynb')) {
				vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(main), 'jupyter-notebook');
			} else {
				vscode.window.showTextDocument(vscode.Uri.file(main));
			}
			return;
		}
	}
}

function recentProjects() {
	return listTrustedFolders(extContext).slice(0, 8);
}

module.exports = { initProjects, newProject, newColabProject, newPrototypeProject, runProjectAction, recentProjects, newHtmlProject, newPythonProject, openMainIfEmpty, venvPython };
