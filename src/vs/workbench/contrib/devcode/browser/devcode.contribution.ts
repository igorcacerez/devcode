/*---------------------------------------------------------------------------------------------
 *  DevCode - IDE educacional.
 *  Bloqueia copiar / recortar / colar / arrastar-e-soltar texto em todas as janelas da IDE.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { onDidRegisterWindow, addDisposableListener } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { localize } from '../../../../nls.js';
import { language as platformLanguage } from '../../../../base/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IHostService } from '../../../services/host/browser/host.js';

const BLOCKED_MESSAGE = localize('devcode.clipboardBlocked', "DEV CODE: copiar e colar estão desabilitados. Digite o seu código — é assim que se aprende!");

const MEDIA_FILE = /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?|avif|heic|mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|mp4|webm|mkv|mov|avi|wmv|m4v|ogv|fdb|db|sqlite|sqlite3|db3)$/i;

class DevCodeClipboardGuard extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.devcodeClipboardGuard';

	private lastNotification = 0;

	constructor(@INotificationService private readonly notificationService: INotificationService) {
		super();

		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => {
			this.guard(window, disposables);
		}, { window: mainWindow, disposables: this._store }));
	}

	private guard(window: Window & typeof globalThis, disposables: DisposableStore): void {
		const block = (e: globalThis.Event) => {
			e.preventDefault();
			e.stopImmediatePropagation();
			this.notify();
		};
		for (const type of ['paste', 'copy', 'cut']) {
			disposables.add(addDisposableListener(window, type, block, true));
		}
		// Arrastar texto/arquivos de fora para dentro do editor
		disposables.add(addDisposableListener(window, 'drop', (e: DragEvent) => {
			const types = e.dataTransfer?.types ?? [];
			// Arrastar dentro da própria IDE (mover arquivos no Explorer, abas) é permitido
			const internal = types.includes('ResourceURLs') || types.includes('CodeFiles') || types.includes('CodeEditors');
			if (types.includes('Files')) {
				// Vindo do sistema: só mídia (imagem, áudio, vídeo) pode entrar
				const files = Array.from(e.dataTransfer?.files ?? []);
				if (!files.length || !files.every(f => MEDIA_FILE.test(f.name))) {
					block(e);
				}
			} else if (!internal && (types.includes('text/plain') || types.includes('text/html') || types.includes('text/uri-list'))) {
				block(e);
			}
		}, true));
		// EditContext / contenteditable: entradas vindas de colar ou soltar
		disposables.add(addDisposableListener(window, 'beforeinput', (e: InputEvent) => {
			if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' || e.inputType === 'insertFromPasteAsQuotation' || e.inputType === 'insertFromYank') {
				block(e);
			}
		}, true));
	}

	private notify(): void {
		const now = Date.now();
		if (now - this.lastNotification > 4000) {
			this.lastNotification = now;
			this.notificationService.notify({ severity: Severity.Warning, message: BLOCKED_MESSAGE });
		}
	}
}

registerWorkbenchContribution2(DevCodeClipboardGuard.ID, DevCodeClipboardGuard, WorkbenchPhase.BlockStartup);

// Sobrescreve os atalhos de clipboard com um comando que não faz nada.
CommandsRegistry.registerCommand('devcode.clipboardBlocked', accessor => {
	accessor.get(INotificationService).notify({ severity: Severity.Warning, message: BLOCKED_MESSAGE });
});
for (const primary of [
	KeyMod.CtrlCmd | KeyCode.KeyV, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV, KeyMod.Shift | KeyCode.Insert,
	KeyMod.CtrlCmd | KeyCode.KeyC, KeyMod.CtrlCmd | KeyCode.Insert, KeyMod.CtrlCmd | KeyCode.KeyX, KeyMod.Shift | KeyCode.Delete,
]) {
	KeybindingsRegistry.registerKeybindingRule({
		id: 'devcode.clipboardBlocked',
		weight: KeybindingWeight.ExternalExtension + 1000, // vence keybindings do usuário e de extensões
		when: undefined,
		primary,
	});
}

// --- Menus do DEV CODE na barra de menus ---------------------------------------------------
MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '1_new', order: 0,
	command: { id: 'devcode.startPage', title: localize({ key: 'devcode.menu.startPage', comment: ['&& denotes a mnemonic'] }, "&&Tela Inicial (Novo ou Abrir Projeto)") },
});
MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '0_devcode', order: 0,
	command: { id: 'devcode.run', title: localize({ key: 'devcode.menu.run', comment: ['&& denotes a mnemonic'] }, "&&Executar Código (F5)") },
});
MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '0_devcode', order: 1,
	command: { id: 'devcode.liveServer.start', title: localize('devcode.menu.liveServer', "Abrir com Live Server") },
});
MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '7_devcode_git', order: 0,
	command: { id: 'devcode.git.commitPush', title: localize('devcode.menu.push', "Enviar para o GitHub") },
});
MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '7_devcode_git', order: 1,
	command: { id: 'devcode.git.pull', title: localize('devcode.menu.pull', "Atualizar do GitHub") },
});

// --- Português do Brasil já na primeira execução ------------------------------------------
// O pacote de idioma embutido só é registrado (languagepacks.json) depois do primeiro início;
// por isso, uma única vez, a IDE reinicia sozinha para já abrir em português.
class DevCodeFirstRunLanguage extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.devcodeFirstRunLanguage';
	private static readonly STORAGE_KEY = 'devcode.ptBrRelaunchDone';

	constructor(
		@IStorageService storageService: IStorageService,
		@IHostService hostService: IHostService,
	) {
		super();
		if (platformLanguage.toLowerCase() === 'pt-br' || storageService.getBoolean(DevCodeFirstRunLanguage.STORAGE_KEY, StorageScope.APPLICATION, false)) {
			return;
		}
		storageService.store(DevCodeFirstRunLanguage.STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		const handle = setTimeout(() => hostService.restart(), 4000);
		this._register({ dispose: () => clearTimeout(handle) });
	}
}

registerWorkbenchContribution2(DevCodeFirstRunLanguage.ID, DevCodeFirstRunLanguage, WorkbenchPhase.Eventually);

// --- Navegador embutido: sem atalho (abriria sites como o ChatGPT dentro da IDE) -----------
CommandsRegistry.registerCommand('devcode.noop', () => { });
KeybindingsRegistry.registerKeybindingRule({
	id: 'devcode.noop',
	weight: KeybindingWeight.ExternalExtension + 1000,
	when: undefined,
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Semicolon,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '8_devcode_update', order: 0,
	command: { id: 'devcode.checkForUpdates', title: localize('devcode.menu.update', "Verificar Atualizações do DEV CODE") },
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '0_devcode', order: 2,
	command: { id: 'devcode.android.start', title: localize('devcode.menu.android', "Ligar Emulador Android") },
});
