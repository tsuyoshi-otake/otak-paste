import * as vscode from 'vscode';
import { ASSET_DIRECTORY_NAME } from './constants';
import { I18nManager } from './i18n/I18nManager';
import {
    buildAssetRelativePath,
    buildMarkdownImageSnippet,
    pickUniquePngFileName,
    UniqueFileNameError
} from './pathing';

const PNG_MIME_TYPE = 'image/png';

export function getOtakPasteEditKind(): vscode.DocumentDropOrPasteEditKind {
    return vscode.DocumentDropOrPasteEditKind.Empty.append('markdown', 'image', 'otakPaste');
}

export class OtakPasteImageEdit extends vscode.DocumentPasteEdit {
    public constructor(
        public readonly documentUri: vscode.Uri,
        public readonly pngBytes: Uint8Array,
        title: string
    ) {
        super(new vscode.SnippetString(''), title, getOtakPasteEditKind());
    }
}

export class OtakPasteProvider implements vscode.DocumentPasteEditProvider<OtakPasteImageEdit> {
    public constructor(private readonly i18n: I18nManager) {}

    public async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        _ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        _context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken
    ): Promise<OtakPasteImageEdit[]> {
        if (token.isCancellationRequested) {
            return [];
        }

        if (document.isUntitled) {
            void vscode.window.showWarningMessage(this.i18n.t('warning.unsavedMarkdown'));
            return [];
        }

        if (document.uri.scheme !== 'file') {
            void vscode.window.showWarningMessage(this.i18n.t('warning.nonFileMarkdown'));
            return [];
        }

        const item = dataTransfer.get(PNG_MIME_TYPE);
        if (!item) {
            return [];
        }

        try {
            const pngBytes = await readPngBytes(item);
            if (token.isCancellationRequested || !pngBytes) {
                return [];
            }

            return [
                new OtakPasteImageEdit(
                    document.uri,
                    pngBytes,
                    this.i18n.t('paste.title')
                )
            ];
        } catch {
            void vscode.window.showErrorMessage(this.i18n.t('error.readPngData'));
            return [];
        }
    }

    public async resolveDocumentPasteEdit(
        pasteEdit: OtakPasteImageEdit,
        token: vscode.CancellationToken
    ): Promise<OtakPasteImageEdit> {
        if (token.isCancellationRequested) {
            return pasteEdit;
        }

        try {
            const assetDirectory = vscode.Uri.joinPath(pasteEdit.documentUri, '..', ASSET_DIRECTORY_NAME);
            const fileName = await pickUniquePngFileName(fileName => this.fileExists(vscode.Uri.joinPath(assetDirectory, fileName)));

            if (token.isCancellationRequested) {
                return pasteEdit;
            }

            await vscode.workspace.fs.createDirectory(assetDirectory);

            const imageUri = vscode.Uri.joinPath(assetDirectory, fileName);
            const relativePath = buildAssetRelativePath(fileName);
            const additionalEdit = new vscode.WorkspaceEdit();
            additionalEdit.createFile(imageUri, { contents: pasteEdit.pngBytes });

            pasteEdit.insertText = new vscode.SnippetString(buildMarkdownImageSnippet(relativePath));
            pasteEdit.additionalEdit = additionalEdit;
            return pasteEdit;
        } catch (error) {
            const key = error instanceof UniqueFileNameError
                ? 'error.nameCollision'
                : 'error.createPasteEdit';
            void vscode.window.showErrorMessage(this.i18n.t(key));
            return pasteEdit;
        }
    }

    private async fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch (error) {
            if (isFileNotFound(error)) {
                return false;
            }
            throw error;
        }
    }
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

function isFileNotFound(error: unknown): boolean {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = String((error as { code?: unknown }).code);
        return code === 'FileNotFound' || code === 'EntryNotFound';
    }

    return String(error).includes('FileNotFound') || String(error).includes('EntryNotFound');
}
