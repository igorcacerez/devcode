// DEV CODE - caixa de input() dentro da célula do notebook (igual ao Google Colab).
export const activate = context => ({
	renderOutputItem(outputItem, element) {
		const { id, prompt } = outputItem.json();
		element.innerHTML = '';
		const row = document.createElement('div');
		row.style.cssText = 'display:flex;align-items:center;gap:8px;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);padding:4px 0;';
		const label = document.createElement('span');
		label.textContent = prompt;
		label.style.whiteSpace = 'pre';
		const input = document.createElement('input');
		input.type = 'text';
		input.setAttribute('aria-label', prompt || 'Entrada');
		input.style.cssText = 'flex:1;min-width:220px;max-width:520px;padding:5px 8px;border-radius:4px;border:1px solid #D10A0A;outline:none;font:inherit;background:var(--vscode-input-background);color:var(--vscode-input-foreground);';
		const hint = document.createElement('span');
		hint.textContent = 'Enter ↵';
		hint.style.cssText = 'opacity:.6;font-size:11px;';
		row.append(label, input, hint);
		element.append(row);
		let sent = false;
		input.addEventListener('keydown', e => {
			e.stopPropagation(); // não deixa atalhos do notebook capturarem as teclas
			if (e.key === 'Enter' && !sent) {
				sent = true;
				input.disabled = true;
				context.postMessage?.({ id, value: input.value });
			}
		});
		setTimeout(() => input.focus(), 50);
	},
});
