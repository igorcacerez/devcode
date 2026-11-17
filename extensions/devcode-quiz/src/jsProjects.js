/*---------------------------------------------------------------------------------------------
 *  DEV CODE - projetos React (Vite) e React Native (Expo), versão mínima/blank, sem TypeScript.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';

/** Executa npm/npx (no Windows são .cmd, por isso shell). */
function npmExec(cmd, args, cwd, timeout = 900000) {
	return new Promise(resolve => {
		const quoted = args.map(a => /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
		cp.exec([cmd, ...quoted].join(' '), { cwd, timeout, windowsHide: true, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' }, maxBuffer: 20 * 1024 * 1024 },
			(err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
	});
}

async function nodeAvailable() {
	const r = await npmExec('npm', ['--version'], undefined, 30000);
	if (!r.ok) {
		vscode.window.showErrorMessage('DEV CODE: o Node.js não está instalado neste computador. Peça ao professor para instalar o Node.js (LTS).', { modal: true });
	}
	return r.ok;
}

async function askNameAndParent(kind) {
	const name = await vscode.window.showInputBox({
		title: `Novo Projeto ${kind} (1/2): nome do projeto`,
		placeHolder: 'meu-app',
		ignoreFocusOut: true,
		// npm exige nomes minúsculos, sem espaços
		validateInput: v => /^[a-z0-9][a-z0-9-_]*$/.test(v.trim()) ? undefined : 'Use só letras minúsculas, números, - ou _ (ex.: meu-app)',
	});
	if (!name) { return undefined; }
	const parent = await vscode.window.showOpenDialog({
		title: `Novo Projeto ${kind} (2/2): onde criar o projeto?`,
		openLabel: 'Criar aqui', canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
	});
	if (!parent?.[0]) { return undefined; }
	const dir = path.join(parent[0].fsPath, name.trim());
	if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
		vscode.window.showErrorMessage(`DEV CODE: a pasta "${dir}" já existe e não está vazia. Escolha outro nome ou local.`, { modal: true });
		return undefined;
	}
	return { name: name.trim(), parent: parent[0].fsPath, dir };
}

function writeFiles(dir, files) {
	for (const [rel, content] of Object.entries(files)) {
		const file = path.join(dir, rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
	}
}

function writeSettings(dir, type) {
	fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), JSON.stringify({ 'devcode.projectType': type }, null, '\t'));
}

// ------------------------------------------------------------------------------------- React

function reactFiles(name) {
	return {
		'package.json': JSON.stringify({
			name, private: true, version: '0.0.0', type: 'module',
			scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
		}, null, 2) + '\n',
		'vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
		'index.html': `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
		'src/main.jsx': `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
		'src/App.jsx': `function App() {
  return (
    <h1>Olá, React!</h1>
  )
}

export default App
`,
		'.gitignore': 'node_modules\ndist\n',
	};
}

async function newReactProject(openProject) {
	if (!(await nodeAvailable())) { return; }
	const t = await askNameAndParent('React');
	if (!t) { return; }
	const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `DEV CODE: criando o projeto React "${t.name}"…` }, async progress => {
		writeFiles(t.dir, reactFiles(t.name));
		writeSettings(t.dir, 'react');
		progress.report({ message: 'instalando react e react-dom (npm)…' });
		let r = await npmExec('npm', ['install', 'react', 'react-dom'], t.dir);
		if (r.ok) {
			progress.report({ message: 'instalando vite (npm)…' });
			r = await npmExec('npm', ['install', '-D', 'vite', '@vitejs/plugin-react'], t.dir);
		}
		if (!r.ok) {
			vscode.window.showErrorMessage(`DEV CODE: falha ao instalar as dependências (verifique a internet).\n${r.err.slice(-1500)}`, { modal: true });
		}
		return r.ok;
	});
	if (ok) { await openProject(t.dir); }
}

// ------------------------------------------------------------------------------------- Expo

async function newExpoProject(openProject) {
	if (!(await nodeAvailable())) { return; }
	const t = await askNameAndParent('React Native (Expo)');
	if (!t) { return; }
	const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `DEV CODE: criando o app Expo "${t.name}" (pode levar alguns minutos)…` }, async () => {
		// template oficial "blank" (JavaScript, uma tela, sem navegação/TypeScript)
		const r = await npmExec('npx', ['--yes', 'create-expo-app@latest', t.name, '--template', 'blank', '--yes'], t.parent);
		if (!r.ok || !fs.existsSync(path.join(t.dir, 'package.json'))) {
			vscode.window.showErrorMessage(`DEV CODE: falha ao criar o app Expo (verifique a internet).\n${(r.err || r.out).slice(-1500)}`, { modal: true });
			return false;
		}
		// garante o mínimo: sem TypeScript, sem arquivos de agentes de IA que o template inclui,
		// sem repositório git automático (o aluno conecta pelo botão "Conectar ao GitHub")
		for (const f of ['tsconfig.json', 'expo-env.d.ts', '.claude', '.cursor', '.cursorrules', '.github', '.windsurfrules',
			'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'LICENSE', '.git']) {
			fs.rmSync(path.join(t.dir, f), { recursive: true, force: true });
		}
		writeSettings(t.dir, 'expo');
		return true;
	});
	if (ok) { await openProject(t.dir); }
}

// ------------------------------------------------------------------------------------- Executar

const DEV_COMMANDS = {
	react: { cmd: 'npm run dev', url: 'http://localhost:5173/' },
	expo: { cmd: 'npx expo start', url: undefined },
};

module.exports = { newReactProject, newExpoProject, DEV_COMMANDS };
