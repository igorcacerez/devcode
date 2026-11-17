/*---------------------------------------------------------------------------------------------
 *  DevCode - IDE educacional.
 *  Configurações travadas: o aluno não consegue sobrescrevê-las via settings.json,
 *  workspace, perfil ou linha de comando. São aplicadas sobre o valor final de getValue().
 *--------------------------------------------------------------------------------------------*/

export const DEVCODE_LOCKED_SETTINGS: { readonly [key: string]: unknown } = Object.freeze({
	// --- Sem IA ---------------------------------------------------------------
	'chat.disableAIFeatures': true,
	'chat.commandCenter.enabled': false,
	'chat.agent.enabled': false,
	'chat.mcp.enabled': false,
	'editor.inlineSuggest.enabled': false,
	'github.copilot.enable': { '*': false },
	'workbench.enableExperiments': false,

	// --- Somente o tema DEV CODE Light -------------------------------------------
	'workbench.colorTheme': 'DEV CODE Light',
	'workbench.preferredLightColorTheme': 'DEV CODE Light',
	'workbench.preferredDarkColorTheme': 'DEV CODE Light',
	'workbench.preferredHighContrastColorTheme': 'DEV CODE Light',
	'workbench.preferredHighContrastLightColorTheme': 'DEV CODE Light',
	'window.autoDetectColorScheme': false,
	'window.autoDetectHighContrast': false,
	'workbench.colorCustomizations': {},
	'editor.tokenColorCustomizations': {},

	// --- Interface enxuta ------------------------------------------------------------
	'workbench.startupEditor': 'none',
	// projetos só abrem se foram criados/baixados pelo DEV CODE: o Modo Restrito não é necessário
	'security.workspace.trust.enabled': false,
	'workbench.tips.enabled': false,
	'workbench.welcomePage.walkthroughs.openOnInstall': false,
	'workbench.activity.showAccounts': false,
	'workbench.layoutControl.enabled': false,
	'window.commandCenter': true,

	// --- Sem instalação de extensões -----------------------------------------
	// Objeto vazio = nenhuma extensão de terceiros permitida (as embutidas continuam).
	'extensions.allowed': {},
	'extensions.autoUpdate': false,
	'extensions.autoCheckUpdates': false,
	'extensions.ignoreRecommendations': true,

	// --- Sem colar / arrastar texto ------------------------------------------
	'editor.dragAndDrop': false,
	'editor.dropIntoEditor.enabled': false,
	'editor.pasteAs.enabled': false,
	'editor.copyWithSyntaxHighlighting': false,
	'editor.selectionClipboard': false,
	'terminal.integrated.copyOnSelection': false,
	'terminal.integrated.rightClickBehavior': 'nothing',
	'terminal.integrated.middleClickBehavior': 'default',

	// --- Terminal monitorado ---------------------------------------------------
	// A integração de shell é o que permite à IDE ver cada comando digitado.
	'terminal.integrated.shellIntegration.enabled': true,
	'terminal.integrated.defaultProfile.windows': 'PowerShell',
	'terminal.integrated.profiles.windows': { 'PowerShell': { 'source': 'PowerShell', 'icon': 'terminal-powershell' } },
	'terminal.integrated.defaultProfile.linux': 'bash',
	'terminal.integrated.profiles.linux': { 'bash': { 'path': 'bash', 'icon': 'terminal-bash' } },
	'terminal.integrated.defaultProfile.osx': 'zsh',
	'terminal.integrated.profiles.osx': { 'zsh': { 'path': 'zsh', 'args': ['-l'] } },
	'terminal.integrated.automationProfile.windows': null,
	'terminal.integrated.sendKeybindingsToShell': false,
	'terminal.integrated.suggest.enabled': false,
	'terminal.external.windowsExec': 'devcode-blocked',
	'terminal.explorerKind': 'integrated',
});

const lockedKeys = Object.keys(DEVCODE_LOCKED_SETTINGS);

export function isDevCodeLockedSetting(key: string): boolean {
	return Object.prototype.hasOwnProperty.call(DEVCODE_LOCKED_SETTINGS, key);
}

function clone<T>(value: T): T {
	return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

/**
 * Aplica as configurações travadas sobre o valor retornado por getValue(section).
 */
export function applyDevCodeLockedSettings(section: string | undefined, value: unknown): unknown {
	if (section && isDevCodeLockedSetting(section)) {
		return clone(DEVCODE_LOCKED_SETTINGS[section]);
	}
	const prefix = section ? section + '.' : '';
	const affected = lockedKeys.filter(k => k.startsWith(prefix));
	if (!affected.length) {
		return value;
	}
	const root: Record<string, unknown> = value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
	for (const key of affected) {
		const path = key.substring(prefix.length).split('.');
		let node = root;
		for (let i = 0; i < path.length - 1; i++) {
			const child = node[path[i]];
			node[path[i]] = child && typeof child === 'object' ? { ...(child as Record<string, unknown>) } : {};
			node = node[path[i]] as Record<string, unknown>;
		}
		node[path[path.length - 1]] = clone(DEVCODE_LOCKED_SETTINGS[key]);
		// também cobre a forma "achatada" (ex.: chave 'chat.disableAIFeatures' na raiz)
		if (path.length > 1 && Object.prototype.hasOwnProperty.call(root, key.substring(prefix.length))) {
			root[key.substring(prefix.length)] = clone(DEVCODE_LOCKED_SETTINGS[key]);
		}
	}
	return root;
}
