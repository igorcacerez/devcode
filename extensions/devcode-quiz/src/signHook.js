'use strict';

async function run() {
	if (process.env.DEVCODE_SIGNING) { return; }
	try {
		const signature = require('./signature');
		const hookName = process.argv[2];
		const repo = process.cwd();
		if (hookName === 'post-commit') {
			await signature.signHead(repo);
		} else if (hookName === 'post-merge') {
			const head = await signature.getHead(repo);
			const parents = head ? await signature.commitParentCount(repo, head) : undefined;
			if (!head || !Number.isFinite(parents) || parents < 2 || await signature.isCommitSigned(repo, head)) { return; }
			await signature.signHead(repo);
		}
	} catch { /* hooks nunca bloqueiam operações do Git */ }
}

run().catch(() => {}).finally(() => {
	process.exitCode = 0;
});
