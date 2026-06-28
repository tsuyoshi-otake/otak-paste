import * as path from 'path';
import * as vscode from 'vscode';
import { I18nManager } from './i18n/I18nManager';
import { pasteImageFromClipboard } from './pasteImageCommand';
import { getOtakPasteEditKind, OtakPasteProvider } from './pasteImageProvider';

export function activate(context: vscode.ExtensionContext): void {
    const localesDir = context.asAbsolutePath(path.join('out', 'i18n', 'locales'));
    const i18n = new I18nManager(localesDir);
    i18n.initialize(vscode.env.language);

    const provider = new OtakPasteProvider(i18n);
    context.subscriptions.push(
        vscode.commands.registerCommand('otakPaste.pasteImage', () => pasteImageFromClipboard(i18n)),
        vscode.languages.registerDocumentPasteEditProvider(
            { language: 'markdown' },
            provider,
            {
                providedPasteEditKinds: [getOtakPasteEditKind()],
                pasteMimeTypes: ['image/png']
            }
        )
    );
}

export function deactivate(): void {
    // No background resources to release.
}
