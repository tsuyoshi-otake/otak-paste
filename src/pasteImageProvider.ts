import * as vscode from 'vscode';
import { I18nManager } from './i18n/I18nManager';
import { buildMarkdownImageSnippet, UniqueFileNameError } from './pathing';
import {
    ensurePastedPngDirectory,
    LOCAL_MARKDOWN_DOCUMENT,
    preparePastedPngAsset
} from './pastedPngAsset';

const PNG_MIME_TYPE = 'image/png';
const PLAIN_TEXT_MIME_TYPE = 'text/plain';

// Untitled Markdown is included only to tell the user to save the file first;
// every other scheme is left to VS Code's own paste providers.
export const OTAK_PASTE_PROVIDER_SELECTOR: vscode.DocumentSelector = [
    LOCAL_MARKDOWN_DOCUMENT,
    { language: 'markdown', scheme: 'untitled' }
];

export function getOtakPasteEditKind(): vscode.DocumentDropOrPasteEditKind {
    return vscode.DocumentDropOrPasteEditKind.Empty.append('markdown', 'image', 'otakPaste');
}

// The edit is built completely here: Paste As applies the picked edit without
// calling resolveDocumentPasteEdit, so a resolve-time snippet would never be inserted.
export class OtakPasteProvider implements vscode.DocumentPasteEditProvider {
    public constructor(private readonly i18n: I18nManager) {}

    public async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        _ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentPasteEdit[]> {
        if (token.isCancellationRequested) {
            return [];
        }

        // An image that arrives with text (e.g. Excel cells) yields to the text, as
        // VS Code's own Markdown image paste does. The pasteAs preference in
        // configurationDefaults would override a yieldTo, so the edit is offered
        // only when the user explicitly asks for it via Paste As.
        if (context.triggerKind === vscode.DocumentPasteTriggerKind.Automatic
            && await hasPlainText(dataTransfer)) {
            return [];
        }

        if (document.isUntitled) {
            void vscode.window.showWarningMessage(this.i18n.t('warning.unsavedMarkdown'));
            return [];
        }

        const item = dataTransfer.get(PNG_MIME_TYPE);
        if (!item) {
            return [];
        }

        let pngBytes: Uint8Array | undefined;
        try {
            pngBytes = await readPngBytes(item);
        } catch {
            void vscode.window.showErrorMessage(this.i18n.t('error.readPngData'));
            return [];
        }

        if (token.isCancellationRequested || !pngBytes) {
            return [];
        }

        try {
            const asset = await preparePastedPngAsset(document.uri, pngBytes);
            if (token.isCancellationRequested) {
                return [];
            }

            await ensurePastedPngDirectory(asset);

            const pasteEdit = new vscode.DocumentPasteEdit(
                new vscode.SnippetString(buildMarkdownImageSnippet(asset.relativePath)),
                this.i18n.t('paste.title'),
                getOtakPasteEditKind()
            );
            pasteEdit.additionalEdit = new vscode.WorkspaceEdit();
            pasteEdit.additionalEdit.createFile(asset.imageUri, { contents: asset.pngBytes });
            return [pasteEdit];
        } catch (error) {
            const key = error instanceof UniqueFileNameError
                ? 'error.nameCollision'
                : 'error.createPasteEdit';
            void vscode.window.showErrorMessage(this.i18n.t(key));
            return [];
        }
    }
}

async function hasPlainText(dataTransfer: vscode.DataTransfer): Promise<boolean> {
    const text = await dataTransfer.get(PLAIN_TEXT_MIME_TYPE)?.asString();
    return text !== undefined && text.length > 0;
}

async function readPngBytes(item: vscode.DataTransferItem): Promise<Uint8Array | undefined> {
    const file = item.asFile();
    if (file) {
        return file.data();
    }

    const value = item.value as unknown;
    if (value instanceof Uint8Array) {
        return value;
    }

    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }

    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    return undefined;
}
