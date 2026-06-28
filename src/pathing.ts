import { randomBytes } from 'crypto';
import {
    ASSET_DIRECTORY_NAME,
    IMAGE_FILE_EXTENSION,
    MAX_FILE_NAME_ATTEMPTS,
    RANDOM_BYTE_LENGTH
} from './constants';

export type RandomByteSource = (size: number) => Uint8Array;
export type FileExists = (fileName: string) => boolean | Promise<boolean>;
export type FileNameFactory = () => string;

export class UniqueFileNameError extends Error {
    public constructor(attempts: number) {
        super(`Unable to find an unused image file name after ${attempts} attempts.`);
        this.name = 'UniqueFileNameError';
    }
}

export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createRandomPngFileName(randomByteSource: RandomByteSource = randomBytes): string {
    return `${bytesToHex(randomByteSource(RANDOM_BYTE_LENGTH))}${IMAGE_FILE_EXTENSION}`;
}

export function buildAssetRelativePath(fileName: string): string {
    return `${ASSET_DIRECTORY_NAME}/${fileName}`;
}

export function buildMarkdownImageText(relativePath: string, altText = 'image'): string {
    return `![${altText}](${relativePath})`;
}

export function buildMarkdownImageSnippet(relativePath: string, altText = 'image'): string {
    return `![\${1:${escapeSnippetPlaceholder(altText)}}](${relativePath})`;
}

export async function pickUniquePngFileName(
    fileExists: FileExists,
    createFileName: FileNameFactory = createRandomPngFileName,
    maxAttempts = MAX_FILE_NAME_ATTEMPTS
): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const fileName = createFileName();
        if (!await fileExists(fileName)) {
            return fileName;
        }
    }

    throw new UniqueFileNameError(maxAttempts);
}

function escapeSnippetPlaceholder(value: string): string {
    return value.replace(/[\\}$]/g, match => `\\${match}`);
}
