import * as vscode from 'vscode';
import { getPngOptimizationMode } from './configuration';
import { ASSET_DIRECTORY_NAME } from './constants';
import {
    buildAssetRelativePath,
    pickUniquePngFileName
} from './pathing';
import { optimizePngBytes } from './pngOptimizer';

export interface PastedPngAsset {
    readonly assetDirectory: vscode.Uri;
    readonly imageUri: vscode.Uri;
    readonly pngBytes: Uint8Array;
    readonly relativePath: string;
}

export async function preparePastedPngAsset(
    documentUri: vscode.Uri,
    sourcePngBytes: Uint8Array
): Promise<PastedPngAsset> {
    const assetDirectory = vscode.Uri.joinPath(documentUri, '..', ASSET_DIRECTORY_NAME);
    const fileName = await pickUniquePngFileName(fileName => fileExists(vscode.Uri.joinPath(assetDirectory, fileName)));
    const pngBytes = await optimizePngBytes(sourcePngBytes, getPngOptimizationMode());

    return {
        assetDirectory,
        imageUri: vscode.Uri.joinPath(assetDirectory, fileName),
        pngBytes,
        relativePath: buildAssetRelativePath(fileName)
    };
}

export async function ensurePastedPngDirectory(asset: PastedPngAsset): Promise<void> {
    await vscode.workspace.fs.createDirectory(asset.assetDirectory);
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
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

function isFileNotFound(error: unknown): boolean {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = String((error as { code?: unknown }).code);
        return code === 'FileNotFound' || code === 'EntryNotFound';
    }

    return String(error).includes('FileNotFound') || String(error).includes('EntryNotFound');
}
