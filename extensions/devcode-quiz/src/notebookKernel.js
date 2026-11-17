/*---------------------------------------------------------------------------------------------
 *  DEV CODE - execução de notebooks (.ipynb) estilo Google Colab, sem Jupyter.
 *  - Um processo Python por notebook (kernel/devcode_kernel.py): variáveis vivem entre células.
 *  - Saída aparece embaixo da célula em tempo real; input() abre uma caixa DENTRO da célula.
 *  - Antes de rodar uma célula alterada, o aluno responde a pergunta do DEV CODE.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const INPUT_MIME = 'application/x-devcode-input';
const isWin = process.platform === 'win32';

class Kernel {
	constructor(python, cwd, scriptPath) {
		this.proc = cp.spawn(python, ['-u', scriptPath], {
			cwd, windowsHide: true,
			env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MPLBACKEND: 'Agg' },
		});
		this.buffer = '';
		this.listener = undefined;
		this.ready = new Promise((resolve, reject) => {
			this.readyResolve = resolve;
			this.proc.on('error', reject);
		});
		this.stderr = '';
		this.proc.stdout.setEncoding('utf8');
		this.proc.stdout.on('data', d => this.onData(d));
		this.proc.stderr.on('data', d => { this.stderr += d; });
		this.exited = new Promise(resolve => this.proc.on('exit', code => {
			this.dead = true;
			if (this.listener) { this.listener({ type: 'crash', code, stderr: this.stderr }); }
			resolve(code);
		}));
	}

	onData(chunk) {
		this.buffer += chunk;
		let i;
		while ((i = this.buffer.indexOf('\n')) >= 0) {
			const line = this.buffer.slice(0, i);
			this.buffer = this.buffer.slice(i + 1);
			let msg;
			try { msg = JSON.parse(line); } catch { continue; }
			if (msg.type === 'ready') { this.version = msg.version; this.readyResolve(); continue; }
			if (this.listener) { this.listener(msg); }
		}
	}

	send(msg) { this.proc.stdin.write(JSON.stringify(msg) + '\n'); }

	dispose() { try { this.proc.kill(); } catch { /* já encerrado */ } }
}

function pythonFor(notebookUri) {
	const folder = vscode.workspace.getWorkspaceFolder(notebookUri)?.uri.fsPath || path.dirname(notebookUri.fsPath);
	const venv = isWin ? path.join(folder, '.venv', 'Scripts', 'python.exe') : path.join(folder, '.venv', 'bin', 'python');
	if (fs.existsSync(venv)) { return { python: venv, cwd: folder }; }
	const cfg = (vscode.workspace.getConfiguration('devcode').get('pythonPath') || '').replace(/\$\{workspaceFolder\}/g, folder);
	return { python: cfg || (isWin ? 'python' : 'python3'), cwd: folder };
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {(cell: vscode.NotebookCell) => Promise<boolean>} gate pergunta do DEV CODE antes de executar
 */
function registerNotebookKernel(context, gate) {
	const kernels = new Map(); // notebook uri -> Kernel
	const pendingInputs = new Map(); // id -> resolve(value)
	let executionOrder = 0;
	const scriptPath = path.join(context.extensionPath, 'kernel', 'devcode_kernel.py');

	const controller = vscode.notebooks.createNotebookController('devcode-python', 'jupyter-notebook', 'Python (DEV CODE)');
	controller.supportedLanguages = ['python', 'markdown'];
	controller.supportsExecutionOrder = true;
	controller.description = 'Executa as células como no Google Colab';
	context.subscriptions.push(controller);

	// renderer da caixa de input dentro da célula
	const messaging = vscode.notebooks.createRendererMessaging('devcode-input');
	context.subscriptions.push(messaging.onDidReceiveMessage(e => {
		const resolve = pendingInputs.get(e.message?.id);
		if (resolve) { pendingInputs.delete(e.message.id); resolve(String(e.message.value ?? '')); }
	}));

	// o controlador do DEV CODE é sempre o escolhido
	const prefer = nb => { if (nb.notebookType === 'jupyter-notebook') { controller.updateNotebookAffinity(nb, vscode.NotebookControllerAffinity.Preferred); } };
	vscode.workspace.notebookDocuments.forEach(prefer);
	context.subscriptions.push(vscode.workspace.onDidOpenNotebookDocument(prefer));
	context.subscriptions.push(vscode.workspace.onDidCloseNotebookDocument(nb => {
		kernels.get(nb.uri.toString())?.dispose();
		kernels.delete(nb.uri.toString());
	}));

	async function getKernel(notebook) {
		const key = notebook.uri.toString();
		let k = kernels.get(key);
		if (k && !k.dead) { return k; }
		const { python, cwd } = pythonFor(notebook.uri);
		k = new Kernel(python, cwd, scriptPath);
		kernels.set(key, k);
		try {
			await Promise.race([k.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 20000))]);
		} catch (err) {
			kernels.delete(key);
			k.dispose();
			throw new Error(`Não foi possível iniciar o Python (${python}). ${err.message || ''}`);
		}
		return k;
	}

	function restart(notebook) {
		const key = notebook?.uri.toString();
		if (!key) { return; }
		kernels.get(key)?.dispose();
		kernels.delete(key);
		executionOrder = 0;
		vscode.window.setStatusBarMessage('$(debug-restart) DEV CODE: ambiente de execução reiniciado (variáveis apagadas).', 4000);
	}

	async function runCell(cell, k) {
		const execution = controller.createNotebookCellExecution(cell);
		execution.executionOrder = ++executionOrder;
		execution.start(Date.now());
		await execution.clearOutput();

		const outputs = [];
		let streamOutput; // última saída de texto (para juntar os prints)
		let streamText = '';
		let streamName = '';
		const flushStream = async () => { /* stream é atualizada a cada chegada */ };

		const appendStream = async (name, text) => {
			if (streamOutput && streamName === name) {
				streamText += text;
				const item = name === 'stderr' ? vscode.NotebookCellOutputItem.stderr(streamText) : vscode.NotebookCellOutputItem.stdout(streamText);
				await execution.replaceOutputItems(item, streamOutput);
				return;
			}
			streamName = name;
			streamText = text;
			streamOutput = new vscode.NotebookCellOutput([name === 'stderr' ? vscode.NotebookCellOutputItem.stderr(text) : vscode.NotebookCellOutputItem.stdout(text)]);
			outputs.push(streamOutput);
			await execution.appendOutput(streamOutput);
		};

		let pendingPrompt = '';
		let success = true;
		const done = new Promise(resolve => {
			let queue = Promise.resolve();
			k.listener = msg => {
				queue = queue.then(async () => {
					switch (msg.type) {
						case 'stream':
							if (msg.echo) {
								// remove o prompt que já estava na saída e mostra "prompt + resposta"
								if (streamOutput && pendingPrompt && streamText.endsWith(pendingPrompt)) {
									streamText = streamText.slice(0, -pendingPrompt.length);
								}
								pendingPrompt = '';
							}
							await appendStream(msg.name, msg.text);
							break;
						case 'result': {
							streamOutput = undefined;
							const out = new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(msg.text, 'text/plain')]);
							outputs.push(out);
							await execution.appendOutput(out);
							break;
						}
						case 'image': {
							streamOutput = undefined;
							const out = new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem(Buffer.from(msg.data, 'base64'), msg.mime)]);
							await execution.appendOutput(out);
							break;
						}
						case 'input_request': {
							const id = `${cell.document.uri.toString()}#${Date.now()}`;
							streamOutput = undefined;
							const inputOut = new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.json({ id, prompt: msg.prompt }, INPUT_MIME)]);
							await execution.appendOutput(inputOut);
							const value = await new Promise(res => {
								pendingInputs.set(id, res);
								execution.token.onCancellationRequested(() => { pendingInputs.delete(id); res(''); k.send({ type: 'interrupt' }); });
							});
							// troca a caixa pelo texto digitado (o kernel ecoa "prompt + valor")
							pendingPrompt = '';
							await execution.replaceOutput(execution.cell.outputs.filter(o => !o.items.some(it => it.mime === INPUT_MIME)));
							k.send({ type: 'input_reply', value });
							break;
						}
						case 'error': {
							success = false;
							streamOutput = undefined;
							const err = new Error(msg.evalue);
							err.name = msg.ename;
							err.stack = `${msg.ename}: ${msg.evalue}\n\n${msg.traceback || ''}`;
							await execution.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(err)]));
							break;
						}
						case 'crash':
							success = false;
							await execution.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(`O Python foi encerrado (código ${msg.code}).\n${msg.stderr || ''}`)]));
							resolve();
							break;
						case 'done':
							success = success && msg.ok !== false;
							resolve();
							break;
					}
				}).catch(err => console.error('[DEV CODE kernel]', err));
			};
		});

		const cancel = execution.token.onCancellationRequested(() => {
			// "Parar": como no Colab, interrompe; se não responder, reinicia
			k.send({ type: 'interrupt' });
			setTimeout(() => { if (!k.dead) { k.dispose(); } }, 1500);
		});
		k.send({ type: 'exec', id: Date.now(), code: cell.document.getText() });
		await done;
		await flushStream();
		cancel.dispose();
		k.listener = undefined;
		execution.end(success, Date.now());
		return success;
	}

	controller.executeHandler = async (cells, notebook) => {
		for (const cell of cells) {
			if (cell.kind !== vscode.NotebookCellKind.Code) { continue; }
			if (!cell.document.getText().trim()) { continue; }
			if (!(await gate(cell))) { return; } // pergunta do DEV CODE
			let k;
			try {
				k = await getKernel(notebook);
			} catch (err) {
				const execution = controller.createNotebookCellExecution(cell);
				execution.start(Date.now());
				await execution.replaceOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(String(err.message || err))]));
				execution.end(false, Date.now());
				return;
			}
			const ok = await runCell(cell, k);
			if (!ok) { return; } // como no Colab, "Executar tudo" para no primeiro erro
		}
	};
	controller.interruptHandler = notebook => { kernels.get(notebook.uri.toString())?.send({ type: 'interrupt' }); };

	context.subscriptions.push(
		vscode.commands.registerCommand('devcode.notebook.restart', () => restart(vscode.window.activeNotebookEditor?.notebook)),
		{ dispose: () => kernels.forEach(k => k.dispose()) },
	);
}

module.exports = { registerNotebookKernel };
