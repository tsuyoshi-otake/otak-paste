import * as vscode from 'vscode';
import { readPngFromClipboard } from './clipboardImageReader';
import { I18nManager } from './i18n/I18nManager';
import { buildMarkdownImageSnippet, UniqueFileNameError } from './pathing';
import {
    ensurePastedPngDirectory,
    preparePastedPngAsset
} from './pastedPngAsset';

const DEFAULT_PASTE_COMMAND = 'editor.action.clipboardPasteAction';

export async function pasteImageFromClipboard(i18n: I18nManager): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
        await runDefaultPaste();
        return;
    }

    const pngBytes = await readPngFromClipboard();
    if (!pngBytes) {
        await runDefaultPaste();
        return;
    }

    if (!canPasteIntoDocument(editor.document, i18n)) {
        return;
    }

    try {
        const asset = await preparePastedPngAsset(editor.document.uri, pngBytes);
        await ensurePastedPngDirectory(asset);

        const edit = new vscode.WorkspaceEdit();
        edit.createFile(asset.imageUri, { contents: asset.pngBytes });
        edit.set(
            editor.document.uri,
            editor.selections.map(selection => vscode.SnippetTextEdit.replace(
                selection,
                new vscode.SnippetString(buildMarkdownImageSnippet(asset.relativePath))
            ))
        );

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            void vscode.window.showErrorMessage(i18n.t('error.createPasteEdit'));
        }
    } catch (error) {
        const key = error instanceof UniqueFileNameError
            ? 'error.nameCollision'
            : 'error.createPasteEdit';
        void vscode.window.showErrorMessage(i18n.t(key));
    }
}

async function runDefaultPaste(): Promise<void> {
    await vscode.commands.executeCommand(DEFAULT_PASTE_COMMAND);
}

function canPasteIntoDocument(document: vscode.TextDocument, i18n: I18nManager): boolean {
    if (document.isUntitled) {
        void vscode.window.showWarningMessage(i18n.t('warning.unsavedMarkdown'));
        return false;
    }

    if (document.uri.scheme !== 'file') {
        void vscode.window.showWarningMessage(i18n.t('warning.nonFileMarkdown'));
        return false;
    }

    return true;
}
