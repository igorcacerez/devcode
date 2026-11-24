/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Verificação de entendimento antes de executar.
 *
 *  - F5 / Ctrl+F5 / botão ▶ chamam "devcode.run": pergunta → se acertar, executa.
 *  - Sessões de depuração (launch.json) são canceladas se o código não foi aprovado.
 *  - Tarefas (tasks.json) são encerradas se o código não foi aprovado.
 *  - Comandos de execução digitados no terminal (python x.py, node x.js, gcc ...) fazem o
 *    terminal ser fechado se o código ainda não foi aprovado.
 *  A aprovação vale para o CONTEÚDO exato do arquivo: qualquer alteração exige nova pergunta.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const path = require('path');
const { generateQuestion } = require('./questions');
const fs = require('fs');
const { initProjects, newProject, newPythonProject, newHtmlProject, openMainIfEmpty, venvPython } = require('./project');
const { registerTerminalGuard } = require('./terminalGuard');
const { registerFileGuard, rescanAll, isTrustedFolder } = require('./fileGuard');
const authorship = require('./authorship');
let extContextRef;
const { registerGit } = require('./git');
const { registerStartPage, showStartPage } = require('./startPage');
const { registerNotebookKernel } = require('./notebookKernel');
const { registerUpdater } = require('./updater');
const { registerEnvFix } = require('./envFix');
const { registerPrototypeEditor } = require('./prototypeEditor');
const { registerTestEditor } = require('./testEditor');
const { registerDiagramEditor } = require('./diagramEditor');
const { registerAndroid, prepareForExpo } = require('./android');
const { registerDatabase } = require('./db');
const { DEV_COMMANDS } = require('./jsProjects');
const { LiveServer } = require('./liveServer');

let liveServer;
const WEB_LANGS = new Set(['html', 'css', 'javascript']);

/** Projeto web = marcado como html, ou pasta com index.html. */
function projectTypeOf(doc) {
	const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
	return folder ? vscode.workspace.getConfiguration('devcode', folder.uri).get('projectType') : undefined;
}

function isWebProject(doc) {
	const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
	if (DEV_COMMANDS[projectTypeOf(doc)]) { return false; }
	if (doc.languageId === 'html') { return true; }
	if (!folder || !WEB_LANGS.has(doc.languageId)) { return false; }
	if (vscode.workspace.getConfiguration('devcode', folder.uri).get('projectType') === 'html') { return true; }
	return fs.existsSync(path.join(folder.uri.fsPath, 'index.html'));
}

async function startLiveServer() {
	const doc = vscode.window.activeTextEditor?.document;
	if (!doc || !WEB_LANGS.has(doc.languageId)) {
		vscode.window.showInformationMessage('DEV CODE: abra um arquivo .html, .css ou .js do projeto para iniciar o Live Server.');
		return;
	}
	if (!(await quiz(doc))) {
		return;
	}
	await vscode.workspace.saveAll(false);
	const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath || path.dirname(doc.fileName);
	await liveServer.start(root, doc.languageId === 'html' ? doc.fileName : undefined);
}

/** uri -> hash do conteúdo aprovado */
const approved = new Map();
/** uri -> { failures, lockedUntil } */
const penalties = new Map();

const RUN_TERMINAL_NAME = 'DEV CODE ▶ Executar';
let lineDecoration;

function hash(text) {
	return crypto.createHash('sha256').update(text).digest('hex');
}

function isApproved(doc) {
	return !!doc && approved.get(doc.uri.toString()) === hash(doc.getText());
}

function anyWorkspaceDocApproved() {
	return vscode.window.visibleTextEditors.some(e => isApproved(e.document));
}

/**
 * Faz a pergunta para o documento. Resolve true se o aluno acertar.
 */
async function quiz(doc, trustUri) {
	// Só executa código que pertence a um projeto do DEV CODE aberto (não arquivo solto/baixado)
	const base = trustUri || doc.uri;
	const folder = vscode.workspace.getWorkspaceFolder(base);
	if (!folder || base.scheme !== 'file' || !isTrustedFolder(extContextRef, folder.uri.fsPath)) {
		vscode.window.showErrorMessage('DEV CODE: só é possível executar arquivos de um projeto do DEV CODE. Use "Novo Projeto" ou "Projeto do Git".', { modal: true });
		return false;
	}
	if (isApproved(doc)) {
		return true;
	}
	const key = doc.uri.toString();
	const pen = penalties.get(key) || { failures: 0, lockedUntil: 0 };
	const wait = Math.ceil((pen.lockedUntil - Date.now()) / 1000);
	if (wait > 0) {
		vscode.window.showWarningMessage(`DEV CODE: aguarde ${wait}s antes de tentar novamente. Use esse tempo para reler o seu código!`);
		return false;
	}

	const q = generateQuestion(doc.getText(), doc.languageId);
	if (!q) {
		vscode.window.showWarningMessage('DEV CODE: escreva algum código antes de executar.');
		return false;
	}

	// Destaca a linha da pergunta no editor
	const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
	if (editor && q.kind !== 'lines') {
		const range = doc.lineAt(Math.min(q.line, doc.lineCount - 1)).range;
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		editor.setDecorations(lineDecoration, [range]);
	}

	const choice = await vscode.window.showQuickPick(
		q.options.map((o, i) => ({ label: `${String.fromCharCode(65 + i)})  ${o}`, value: o })),
		{
			title: `🎓 DEV CODE — responda para executar (${path.basename(doc.fileName)})`,
			placeHolder: q.text,
			ignoreFocusOut: true,
			matchOnDescription: false,
		}
	);
	if (editor) {
		editor.setDecorations(lineDecoration, []);
	}
	if (!choice) {
		return false;
	}

	if (choice.value === q.correct) {
		penalties.delete(key);
		approved.set(key, hash(doc.getText()));
		vscode.window.setStatusBarMessage('$(check) DEV CODE: resposta correta! Executando…', 4000);
		return true;
	}

	pen.failures++;
	const seconds = Math.min(10 * pen.failures, 60);
	pen.lockedUntil = Date.now() + seconds * 1000;
	penalties.set(key, pen);
	vscode.window.showErrorMessage(
		`DEV CODE: resposta incorreta. A resposta certa era "${q.correct}". Releia a linha ${q.line + 1} e tente novamente em ${seconds}s (será outra pergunta).`,
		{ modal: true }
	);
	return false;
}

/** Comando de execução por linguagem. */
function runCommandFor(doc) {
	const file = doc.fileName;
	const q = s => `"${s}"`;
	const dir = path.dirname(file);
	const base = path.basename(file, path.extname(file));
	const isWin = process.platform === 'win32';
	const exe = path.join(dir, base + (isWin ? '.exe' : ''));
	const cfg = vscode.workspace.getConfiguration('devcode');
	const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
	let python = (cfg.get('pythonPath') || '').replace(/\$\{workspaceFolder\}/g, folder || '');
	if (!python && folder && fs.existsSync(venvPython(folder))) {
		python = venvPython(folder);
	}
	python = python ? q(python) : (isWin ? 'python' : 'python3');
	switch (doc.languageId) {
		case 'python': return `${python} ${q(file)}`;
		case 'javascript': return `node ${q(file)}`;
		case 'typescript': return `npx --yes tsx ${q(file)}`;
		case 'java': return `java ${q(file)}`;
		case 'c': return `gcc ${q(file)} -o ${q(exe)} -lm && ${q(exe)}`;
		case 'cpp': return `g++ ${q(file)} -o ${q(exe)} && ${q(exe)}`;
		case 'csharp': return `dotnet run --project ${q(dir)}`;
		case 'go': return `go run ${q(file)}`;
		case 'php': return `php ${q(file)}`;
		case 'ruby': return `ruby ${q(file)}`;
		case 'rust': return `rustc ${q(file)} -o ${q(exe)} && ${q(exe)}`;
		case 'powershell': return `& ${q(file)}`;
		default: return undefined;
	}
}

/** React (Vite) / Expo: pergunta sobre o arquivo aberto → servidor de desenvolvimento. */
async function runDevServer(doc, dev) {
	if (!(await quiz(doc))) {
		return;
	}
	await vscode.workspace.saveAll(false);
	const folder = vscode.workspace.getWorkspaceFolder(doc.uri).uri.fsPath;
	// React Native: roda no emulador Android integrado (ou no celular, pelo QR Code)
	let cmd = dev.cmd;
	let env;
	if (dev === DEV_COMMANDS.expo) {
		env = await prepareForExpo(extContextRef);
		// --localhost: o Expo usa "adb reverse" (127.0.0.1); o IP da rede local costuma ser bloqueado pelo firewall/rede do laboratório
		if (env) { cmd = 'npx expo start --android --localhost'; }
	}
	let term = vscode.window.terminals.find(t => t.name === RUN_TERMINAL_NAME);
	if (term) { term.dispose(); }
	term = vscode.window.createTerminal({ name: RUN_TERMINAL_NAME, cwd: folder, env });
	term.show(true);
	term.sendText(cmd, true);
	if (dev === DEV_COMMANDS.expo && env) {
		vscode.window.showInformationMessage('DEV CODE: o app vai abrir no emulador Android (na primeira vez o Expo instala o Expo Go nele). Para recarregar, salve o arquivo.');
	} else if (dev.url) {
		// abre a pré-visualização ao lado quando o Vite subir (recarrega sozinho a cada salvamento)
		setTimeout(() => vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(dev.url), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true })
			.then(undefined, () => vscode.env.openExternal(vscode.Uri.parse(dev.url))), 3500);
	} else {
		vscode.window.showInformationMessage('DEV CODE: abra o app Expo Go no celular e leia o QR Code que aparece no terminal.');
	}
}

async function runActive() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('DEV CODE: abra um arquivo de código para executar.');
		return;
	}
	const doc = editor.document;
	const dev = DEV_COMMANDS[projectTypeOf(doc)];
	if (dev) {
		return runDevServer(doc, dev);
	}
	if (isWebProject(doc)) {
		return startLiveServer();
	}
	if (doc.isUntitled) {
		vscode.window.showWarningMessage('DEV CODE: salve o arquivo antes de executar.');
		return;
	}
	const cmd = runCommandFor(doc);
	if (!cmd) {
		vscode.window.showWarningMessage(`DEV CODE: a linguagem "${doc.languageId}" não é suportada pelo botão Executar.`);
		return;
	}
	if (!(await quiz(doc))) {
		return;
	}
	await doc.save();
	approved.set(doc.uri.toString(), hash(doc.getText()));
	let term = vscode.window.terminals.find(t => t.name === RUN_TERMINAL_NAME);
	if (!term) {
		term = vscode.window.createTerminal({ name: RUN_TERMINAL_NAME, cwd: path.dirname(doc.fileName) });
	}
	term.show(true);
	term.sendText(forShell(cmd), true);
}

/** PowerShell não executa "c:\...\python.exe" "arquivo" sem o operador & (e o 5.1 não tem &&). */
function forShell(cmd) {
	const shell = (vscode.env.shell || '').toLowerCase();
	if (process.platform !== 'win32' || !/powershell|pwsh/.test(shell)) { return cmd; }
	return cmd.split(' && ').map(c => c.startsWith('"') ? `& ${c}` : c)
		.reduce((acc, c) => acc ? `${acc}; if ($?) { ${c} }` : c, '');
}

/** Heurística: a linha de comando executa/compila código-fonte? */
const RUN_PATTERN = /(^|[\s;&|])(python3?|py|node|deno|bun|tsx|ts-node|java|javac|gcc|g\+\+|clang\+?\+?|cc|dotnet|go|php|ruby|rustc|cargo|vite|expo|react-native|(?:npm|pnpm|yarn)(?:\s+run)?\s+(?:dev|start|serve|preview|web|android|ios)|\.\/[\w.-]+|[\w.-]+\.exe)(\s|$)/i;

function activate(context) {
	// npm/npx no PowerShell (política Restricted) e PATH atualizado após instalar o Node
	registerEnvFix(context).catch(err => console.error('[DEV CODE envFix]', err));
	lineDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
		border: '1px solid',
		borderColor: new vscode.ThemeColor('editorWarning.foreground'),
	});
	context.subscriptions.push(lineDecoration);

	context.subscriptions.push(vscode.commands.registerCommand('devcode.run', runActive));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.newProject', newProject));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.newPythonProject', () => newPythonProject()));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.newColabProject', () => require('./project').newColabProject()));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.newPrototypeProject', () => require('./project').newPrototypeProject()));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.newHtmlProject', newHtmlProject));
	extContextRef = context;
	authorship.registerAuthorship(context);
	require('./quarantine').registerQuarantine(context);
	initProjects(context);
	registerFileGuard(context);
	for (const folder of vscode.workspace.workspaceFolders || []) {
		authorship.installHooks(folder.uri.fsPath, context.extensionPath)
			.catch(err => console.warn('[DEV CODE hooks]', err));
	}
	registerGit(context, { rescan: rescanAll });
	require('./apiClient').registerApiClient(context);
	require('./githubPanel').registerGithubPanel(context, dir => require('./fileGuard').trustFolderChecked(context, dir), rescanAll);
	registerStartPage(context);
	registerUpdater(context);
	registerPrototypeEditor(context);
	registerTestEditor(context);
	registerDiagramEditor(context);
	registerAndroid(context);
	registerDatabase(context);
	// notebooks estilo Colab: pergunta antes de rodar cada célula alterada
	registerNotebookKernel(context, cell => quiz(cell.document, cell.notebook.uri));
	// Ao abrir a IDE sem projeto: mostra o menu Novo Projeto / Projeto do Git / Recentes
	if (!vscode.workspace.workspaceFolders?.length && vscode.workspace.getConfiguration('devcode').get('startupChooser', true)) {
		setTimeout(() => showStartPage(context), 300);
	}
	liveServer = new LiveServer();
	context.subscriptions.push(liveServer);
	context.subscriptions.push(vscode.commands.registerCommand('devcode.liveServer.start', startLiveServer));
	context.subscriptions.push(vscode.commands.registerCommand('devcode.liveServer.stop', () => liveServer.stop()));
	openMainIfEmpty();

	// 1) Depuração (F5 via launch.json, botão Run and Debug, etc.)
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('*', {
		async resolveDebugConfigurationWithSubstitutedVariables(_folder, config) {
			const doc = vscode.window.activeTextEditor?.document;
			if (!doc) {
				vscode.window.showWarningMessage('DEV CODE: abra o arquivo que deseja executar.');
				return undefined;
			}
			return (await quiz(doc)) ? config : undefined; // undefined = cancela a sessão
		}
	}));

	// 2) Tarefas (tasks.json / build)
	context.subscriptions.push(vscode.tasks.onDidStartTask(e => {
		if (!anyWorkspaceDocApproved()) {
			e.execution.terminate();
			vscode.window.showWarningMessage('DEV CODE: tarefas só podem ser executadas depois de responder a pergunta. Use o botão ▶ (F5).');
		}
	}));

	// 3) Terminal: bloqueia código inline / REPL / outros shells, e execução sem aprovação
	registerTerminalGuard(context, (line, terminal) => {
		if (/-m\s+(pip|venv)\b|^\s*pip3?\s|\b(npm|pnpm|yarn)\s+(install|i|add|remove|uninstall|ci)\b|\bexpo\s+install\b/.test(line)) {
			return true; // instalar pacotes / criar venv é permitido
		}
		if (terminal.name === RUN_TERMINAL_NAME && anyWorkspaceDocApproved()) {
			return true;
		}
		return !RUN_PATTERN.test(line) || anyWorkspaceDocApproved();
	});
	// Terminais sem integração de shell também são verificados via eco do texto enviado
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
		// qualquer edição invalida a aprovação (o hash já cobre isso; aqui só limpamos memória)
		const key = e.document.uri.toString();
		if (approved.has(key) && approved.get(key) !== hash(e.document.getText())) {
			approved.delete(key);
		}
	}));
}

function deactivate() { }

module.exports = { activate, deactivate };
