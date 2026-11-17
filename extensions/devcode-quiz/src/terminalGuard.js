/*---------------------------------------------------------------------------------------------
 *  DEV CODE - vigia do terminal.
 *  Fecha o terminal quando o aluno tenta escrever/rodar código direto nele:
 *    - código inline:      python -c "...", node -e "...", ruby -e, php -r, perl -e
 *    - REPL interativo:    python, py, node, ipython, irb, php -a, jshell, csi, deno repl
 *    - gravar código:      echo ... > x.py, Set-Content x.py, cat << EOF > x.js, Out-File
 *    - shells aninhados:   cmd, bash, wsl, pwsh, powershell (escapariam da vigilância)
 *  Terminais sem integração de shell (onde não dá para ver os comandos) também são fechados.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');

const INTERP = String.raw`(?:python[\d.]*|py|pythonw|ipython|node|deno|bun|ruby|irb|php|perl|jshell|csi|dotnet-script|lua|R|Rscript|ghci|scala|kotlinc|swift)(?:\.exe)?`;

const RULES = [
	{
		re: /(^|[\s;&|(])git(\.exe)?\s+(?!--version\b|status\b|log\b|diff\b|branch\b|remote\s+-v\b)/i,
		reason: 'usar o git pelo terminal (use os botões "Enviar" e "Atualizar" da barra de status)',
	},
	{
		re: new RegExp(String.raw`(^|[\s;&|(])${INTERP}(\s+-{1,2}[\w-]+)*\s+(-c|-e|-p|-r|--eval|--print|--command|-)(\s|$|["'])`, 'i'),
		reason: 'executar código digitado direto no terminal',
	},
	{
		// interpretador sem nenhum arquivo => REPL (permite --version, -m pip, -m venv)
		re: new RegExp(String.raw`^\s*&?\s*["']?[\w:\\/.-]*?${INTERP}["']?(\s+(-i|-q|-u|-B|-3[\d.]*|-2|--interactive|repl|-a))*\s*$`, 'i'),
		reason: 'abrir o modo interativo (REPL) da linguagem',
	},
	{
		re: /(>{1,2}|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\btee\b|\bNew-Item\b.*-Value|\bcopy\s+con\b|\[IO\.File\]::Write)[^|;&]*\.(py|pyw|js|mjs|cjs|ts|jsx|tsx|html?|css|c|h|cpp|hpp|cc|java|cs|go|rb|php|rs|kt|swift|lua|sh|ps1|bat|cmd)\b/i,
		reason: 'escrever arquivos de código pelo terminal',
	},
	{
		re: /<<\s*-?\s*['"]?\w+/,
		reason: 'colar blocos de texto (heredoc) no terminal',
	},
	{
		re: /^\s*&?\s*["']?[\w:\\/.-]*?\b(cmd|command|bash|sh|zsh|fish|wsl|ubuntu|pwsh|powershell|powershell_ise|git-bash|mintty|conhost|wt|start)(\.exe)?["']?(\s|$)/i,
		reason: 'abrir outro shell/terminal (fora da vigilância do DEV CODE)',
	},
	{
		re: /\b(Invoke-Expression|iex|Invoke-Command|icm|Start-Process|saps|Add-Type|Invoke-WebRequest|iwr|curl|wget|Set-Clipboard|Get-Clipboard|gcb|scb|clip(\.exe)?|xclip|xsel|pbpaste|pbcopy)\b/i,
		reason: 'usar comandos que avaliam código, baixam conteúdo ou acessam a área de transferência',
	},
	{
		re: /-EncodedCommand|-enc\s|FromBase64String|\beval\b|\bsource\b\s+<\(/i,
		reason: 'executar código codificado / avaliado dinamicamente',
	},
];

/** Retorna o motivo do bloqueio, ou undefined se o comando é permitido. */
function checkCommand(commandLine) {
	const line = (commandLine || '').trim();
	if (!line) { return undefined; }
	for (const rule of RULES) {
		if (rule.re.test(line)) { return rule.reason; }
	}
	return undefined;
}

const SHELL_INTEGRATION_TIMEOUT = 8000;

function isTaskTerminal(terminal) {
	return vscode.tasks.taskExecutions.some(t => terminal.name.includes(t.task.name));
}

function block(terminal, reason) {
	try { terminal.dispose(); } catch { /* já fechado */ }
	vscode.window.showWarningMessage(
		`DEV CODE: não é permitido ${reason}. Escreva o código no editor e execute com o botão ▶ (F5).`,
		{ modal: true });
}

/**
 * @param {(line:string, terminal:any)=>boolean} isAllowedRun callback que decide execução de arquivos (quiz)
 */
function registerTerminalGuard(context, isAllowedRun) {
	// 1) Cada comando digitado
	context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution(e => {
		const line = e.execution.commandLine?.value || '';
		const reason = checkCommand(line);
		if (reason) {
			block(e.terminal, reason);
			return;
		}
		if (!isAllowedRun(line, e.terminal)) {
			block(e.terminal, 'executar o programa sem antes responder a pergunta do DEV CODE');
		}
	}));

	// 2) Terminal sem integração de shell = cego para o DEV CODE => fecha
	const watch = terminal => {
		if (isTaskTerminal(terminal)) { return; }
		const timer = setTimeout(() => {
			if (!terminal.shellIntegration && vscode.window.terminals.includes(terminal) && terminal.exitStatus === undefined) {
				block(terminal, 'usar um terminal que o DEV CODE não consegue monitorar');
			}
		}, SHELL_INTEGRATION_TIMEOUT);
		context.subscriptions.push({ dispose: () => clearTimeout(timer) });
	};
	vscode.window.terminals.forEach(watch);
	context.subscriptions.push(vscode.window.onDidOpenTerminal(watch));
}

module.exports = { registerTerminalGuard, checkCommand };
