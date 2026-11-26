'use strict';

const fs = require('fs');
const path = require('path');

/** Linhas que todo projeto do DEV CODE ignora no git. */
const DEFAULT_LINES = [
	'# DEV CODE',
	'.devcode/',
	'',
	'# Python',
	'.venv/',
	'venv/',
	'__pycache__/',
	'*.pyc',
	'.ipynb_checkpoints/',
	'',
	'# JavaScript',
	'node_modules/',
	'dist/',
	'build/',
	'.expo/',
	'*.log',
	'',
	'# Variáveis de ambiente e segredos',
	'.env',
	'.env.*',
	'',
	'# Sistema e editores',
	'.DS_Store',
	'Thumbs.db',
	'desktop.ini',
	'*.swp',
];

const strip = line => line.trim().replace(/\/$/, '');

/** Cria o .gitignore ou acrescenta as linhas que faltam (sem apagar as do aluno). */
function ensureGitignore(dir) {
	try {
		const file = path.join(dir, '.gitignore');
		const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
		if (!current.trim()) {
			fs.writeFileSync(file, DEFAULT_LINES.join('\n') + '\n');
			return;
		}
		const have = new Set(current.split(/\r?\n/).map(strip));
		const missing = DEFAULT_LINES.filter(l => l && !l.startsWith('#') && !have.has(strip(l)));
		if (missing.length) {
			fs.writeFileSync(file, current.replace(/\s*$/, '\n') + '\n# DEV CODE\n' + missing.join('\n') + '\n');
		}
	} catch (err) {
		console.error('[DEV CODE gitignore]', err);
	}
}

module.exports = { ensureGitignore };
