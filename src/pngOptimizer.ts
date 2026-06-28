import { deflate, inflate } from 'node:zlib';
import { promisify } from 'node:util';
import { PngOptimizationMode } from './pngOptimizationMode';

const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IDAT_CHUNK_TYPE = 'IDAT';
const IEND_CHUNK_TYPE = 'IEND';
const ANIMATION_CHUNK_TYPES = new Set(['acTL', 'fcTL', 'fdAT']);
const NON_VISUAL_METADATA_CHUNK_TYPES = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME']);

interface PngChunk {
    readonly type: string;
    readonly data: Buffer;
    readonly raw: Buffer;
}

interface ParsedPng {
    readonly chunks: PngChunk[];
    readonly idatData: Buffer[];
    readonly hasAnimation: boolean;
}

export async function optimizePngBytes(
    bytes: Uint8Array,
    mode: PngOptimizationMode
): Promise<Uint8Array> {
    if (mode === 'none') {
        return bytes;
    }

    try {
        return await optimizePngBytesLossless(bytes);
    } catch {
        return bytes;
    }
}

export async function optimizePngBytesLossless(bytes: Uint8Array): Promise<Uint8Array> {
    const parsed = parsePng(bytes);
    if (!parsed || parsed.hasAnimation || parsed.idatData.length === 0) {
        return bytes;
    }

    const imageData = await inflateAsync(Buffer.concat(parsed.idatData));
    const recompressedImageData = await deflateAsync(imageData, { level: 9 });
    const optimized = rebuildPng(parsed, recompressedImageData);

    return optimized.byteLength < bytes.byteLength
        ? new Uint8Array(optimized)
        : bytes;
}

function parsePng(bytes: Uint8Array): ParsedPng | undefined {
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (source.byteLength < PNG_SIGNATURE.byteLength || !source.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
        return undefined;
    }

    const chunks: PngChunk[] = [];
    const idatData: Buffer[] = [];
    let hasAnimation = false;
    let offset = PNG_SIGNATURE.byteLength;

    while (offset < source.byteLength) {
        if (offset + 12 > source.byteLength) {
            return undefined;
        }

        const length = source.readUInt32BE(offset);
        const typeStart = offset + 4;
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const chunkEnd = dataEnd + 4;

        if (dataEnd < dataStart || chunkEnd > source.byteLength) {
            return undefined;
        }

        const type = source.toString('latin1', typeStart, dataStart);
        const data = source.subarray(dataStart, dataEnd);
        const raw = source.subarray(offset, chunkEnd);

        chunks.push({ type, data, raw });

        if (type === IDAT_CHUNK_TYPE) {
            idatData.push(data);
        }

        if (ANIMATION_CHUNK_TYPES.has(type)) {
            hasAnimation = true;
        }

        offset = chunkEnd;

        if (type === IEND_CHUNK_TYPE) {
            return offset === source.byteLength
                ? { chunks, idatData, hasAnimation }
                : undefined;
        }
    }

    return undefined;
}

function rebuildPng(parsed: ParsedPng, recompressedImageData: Buffer): Buffer {
    const parts: Buffer[] = [PNG_SIGNATURE];
    let wroteIdat = false;

    for (const chunk of parsed.chunks) {
        if (chunk.type === IDAT_CHUNK_TYPE) {
            if (!wroteIdat) {
                parts.push(createPngChunk(IDAT_CHUNK_TYPE, recompressedImageData));
                wroteIdat = true;
            }
            continue;
        }

        if (NON_VISUAL_METADATA_CHUNK_TYPES.has(chunk.type)) {
            continue;
        }

        parts.push(chunk.raw);
    }

    return Buffer.concat(parts);
}

function createPngChunk(type: string, data: Uint8Array): Buffer {
    const typeBytes = Buffer.from(type, 'latin1');
    const chunk = Buffer.alloc(8 + data.byteLength + 4);
    chunk.writeUInt32BE(data.byteLength, 0);
    typeBytes.copy(chunk, 4);
    Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
    return chunk;
}

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;

    for (const byte of bytes) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
    const table = new Uint32Array(256);

    for (let i = 0; i < table.length; i += 1) {
        let value = i;

        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) !== 0
                ? 0xedb88320 ^ (value >>> 1)
                : value >>> 1;
        }

        table[i] = value >>> 0;
    }

    return table;
}
