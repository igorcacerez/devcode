/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * DEV CODE - limpeza de menus.
 * Itens e submenus que não fazem sentido numa IDE de aula (ou que foram desabilitados) são
 * retirados de TODOS os menus: barra de menus, menus de contexto, títulos de views etc.
 */

/** Submenus removidos (pelo id do MenuId). */
export const DEVCODE_HIDDEN_SUBMENUS = new Set<string>([
	// barra de menus: ficam só Arquivo e Terminal (os atalhos de teclado continuam funcionando)
	'MenubarEditMenu',
	'MenubarViewMenu',
	'MenubarHelpMenu',
	'MenubarSelectionMenu',
	'MenubarGoMenu',
	'MenubarDebugMenu',
	// Arquivo > Preferências (perfis, extensões, temas, sincronização…) e Compartilhar
	'MenubarPreferencesMenu',
	'MenubarShare',
	'MenubarNewBreakpointMenu',
	// Arquivo: Abrir Recente (o menu de projetos do DEV CODE já mostra os recentes) e janelas com perfil
	'MenubarRecentMenu',
	'OpenProfile',
	'Profiles',
]);

/** Comandos removidos de qualquer menu. */
const HIDDEN_COMMANDS = new Set<string>([
	// --- copiar / recortar / colar (desabilitados)
	'editor.action.clipboardCutAction', 'editor.action.clipboardCopyAction', 'editor.action.clipboardPasteAction',
	'editor.action.clipboardCopyWithSyntaxHighlightingAction', 'editor.action.pasteAs', 'editor.action.pasteAsText',
	'filesExplorer.copy', 'filesExplorer.cut', 'filesExplorer.paste', 'copyFilePath', 'copyRelativeFilePath',
	'workbench.action.files.copyPathOfActiveFile', 'workbench.action.terminal.copySelection',
	'workbench.action.terminal.copySelectionAsHtml', 'workbench.action.terminal.paste', 'workbench.action.terminal.pasteSelection',
	'workbench.action.terminal.copyLastCommand', 'workbench.action.terminal.copyLastCommandOutput', 'workbench.action.terminal.copyLastCommandAndLastCommandOutput',
	'editor.action.copyLinesUpAction', 'editor.action.copyLinesDownAction',
	// --- abrir pastas/arquivos soltos e workspaces (só projetos do DEV CODE)
	'workbench.action.files.openFolder', 'workbench.action.files.openFileFolder', 'workbench.action.files.openFile',
	'workbench.action.files.openFolderViaWorkspace', 'workbench.action.openWorkspace', 'workbench.action.openWorkspaceInNewWindow',
	'workbench.action.addRootFolder', 'addRootFolder', 'workbench.action.saveWorkspaceAs', 'workbench.action.duplicateWorkspaceInNewWindow',
	'workbench.action.closeFolder', 'workbench.action.closeWorkspace', 'workbench.action.openRecent', 'workbench.action.files.revealActiveFileInWindows',
	'workbench.profiles.actions.newWindowWithProfile', 'workbench.action.newWindowWithProfile',
	// --- extensões, contas, sincronização, perfis
	'workbench.view.extensions', 'workbench.extensions.action.showInstalledExtensions', 'workbench.extensions.action.installVSIX',
	'workbench.userDataSync.actions.turnOn', 'workbench.userDataSync.actions.settings', 'workbench.profiles.actions.manageProfiles',
	// --- depuração / tarefas (a execução é pelo botão ▶ do DEV CODE)
	'workbench.action.debug.start', 'workbench.action.debug.run', 'workbench.view.debug', 'workbench.debug.action.toggleRepl',
	'workbench.action.tasks.runTask', 'workbench.action.tasks.build', 'workbench.action.tasks.test', 'workbench.action.tasks.terminate',
	'workbench.action.tasks.restartTask', 'workbench.action.tasks.showTasks', 'workbench.action.tasks.configureTaskRunner',
	'workbench.action.tasks.configureDefaultBuildTask', 'workbench.action.tasks.showLog', 'workbench.action.tasks.openUserTasks',
	'workbench.action.terminal.runActiveFile', 'workbench.action.terminal.runSelectedText', 'workbench.action.terminal.runRecentCommand',
	// --- views escondidas
	'workbench.view.scm', 'workbench.view.remote', 'workbench.view.testing.focus', 'workbench.panel.testResults.view.focus',
	'workbench.action.openView', 'workbench.action.showCommands.chat',
	// --- remoto / túnel / compartilhar
	'workbench.action.remote.showMenu', 'workbench.action.remote.close', 'workbench.action.remoteTunnel.turnOn',
	'remote-tunnels.tunnel.turnOn', 'workbench.remote.action.connect',
	// --- ajuda: links externos, ferramentas de desenvolvedor, relatório de problemas
	'workbench.action.toggleDevTools', 'workbench.action.openProcessExplorer', 'workbench.action.openIssueReporter',
	'workbench.action.openRequestFeatureUrl', 'workbench.action.openYouTubeUrl', 'workbench.action.openTipsAndTricksUrl',
	'workbench.action.openVideoTutorialsUrl', 'workbench.action.openNewsletterSignupUrl', 'workbench.action.openLicenseUrl',
	'workbench.action.openPrivacyStatementUrl', 'workbench.action.openDocumentationUrl', 'workbench.action.keybindingsReference',
	'update.showCurrentReleaseNotes', 'workbench.action.showInteractivePlayground', 'workbench.action.reportPerformanceIssueUsingReporter',
	'workbench.action.openLogsFolder', 'workbench.action.showLogs', 'workbench.action.reloadWindowWithExtensionsDisabled',
	'update.checkForUpdates', 'update.check', 'workbench.action.openGlobalKeybindings',
	// --- itens que sobraram nos menus
	'welcome.showNewFileEntries', 'workbench.action.newWindow', 'workbench.action.terminal.newInNewWindow',
	'workbench.action.openWalkthrough', 'welcome.showAllWalkthroughs', 'workbench.action.openEditorAtIndex',
	// --- IA (já desligada, por garantia)
	'workbench.action.chat.open', 'workbench.action.chat.toggle', 'workbench.action.chat.newChat', 'inlineChat.start',
]);

/** Prefixos de comandos removidos (famílias inteiras). */
// navegador embutido: permitiria abrir sites (ex.: ChatGPT) dentro da IDE
const HIDDEN_COMMAND_PREFIXES = ['workbench.action.browser.', 'workbench.action.chat.', 'github.copilot', 'chat.', 'inlineChat.', 'workbench.mcp.', 'workbench.action.debug.', 'workbench.debug.', 'debug.', 'testing.', 'workbench.action.remoteTunnel', 'remoteHub.'];

export function isDevCodeHiddenCommand(id: string): boolean {
	return HIDDEN_COMMANDS.has(id) || HIDDEN_COMMAND_PREFIXES.some(p => id.startsWith(p));
}
