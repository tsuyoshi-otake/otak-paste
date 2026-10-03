import * as vscode from 'vscode';
import { readPngFromClipboard } from './clipboardImageReader';
import { I18nManager } from './i18n/I18nManager';
import { buildMarkdownImageSnippet, UniqueFileNameError } from './pathing';
import {
    ensurePastedPngDirectory,
    LOCAL_MARKDOWN_DOCUMENT,
    preparePastedPngAsset
} from './pastedPngAsset';

const DEFAULT_PASTE_COMMAND = 'editor.action.clipboardPasteAction';

export async function pasteImageFromClipboard(i18n: I18nManager): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    // Untitled, notebook-cell and other non-file Markdown is VS Code's paste to handle.
    if (!editor || vscode.languages.match(LOCAL_MARKDOWN_DOCUMENT, editor.document) === 0) {
        await runDefaultPaste();
        return;
    }

    // Text pastes must not wait for the clipboard image probe.
    if (await clipboardHasText()) {
        await runDefaultPaste();
        return;
    }

    const pngBytes = await readPngFromClipboard();
    if (!pngBytes) {
        await runDefaultPaste();
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

async function clipboardHasText(): Promise<boolean> {
    try {
        return (await vscode.env.clipboard.readText()).length > 0;
    } catch {
        // Let the image probe decide; it falls back to the default paste itself.
        return false;
    }
}
