'use strict';

const vscode = require('vscode');

const timers = new Map();

/** Salva o documento de um editor visual (protótipo/diagrama) respeitando files.autoSave. */
function scheduleAutoSave(document) {
	const config = vscode.workspace.getConfiguration('files', document.uri);
	if (config.get('autoSave', 'afterDelay') === 'off') { return; }
	const delay = Math.max(300, Number(config.get('autoSaveDelay', 1000)) || 1000);
	const key = document.uri.toString();
	clearTimeout(timers.get(key));
	timers.set(key, setTimeout(() => {
		timers.delete(key);
		if (document.isDirty && !document.isClosed) { document.save().then(undefined, err => console.error('[DEV CODE autoSave]', err)); }
	}, delay));
}

module.exports = { scheduleAutoSave };
