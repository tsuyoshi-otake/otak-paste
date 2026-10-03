import { deflate, inflate } from 'node:zlib';
import { promisify } from 'node:util';
import { PngOptimizationMode } from './pngOptimizationMode';

const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_CHUNK_TYPE = 'IHDR';
const IHDR_LENGTH = 13;
const IDAT_CHUNK_TYPE = 'IDAT';
const IEND_CHUNK_TYPE = 'IEND';
const ANIMATION_CHUNK_TYPES = new Set(['acTL', 'fcTL', 'fdAT']);
const NON_VISUAL_METADATA_CHUNK_TYPES = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME']);
// Images whose decoded data would exceed this are saved without recompression.
const MAX_DECODED_IMAGE_DATA_BYTES = 128 * 1024 * 1024;
const CHANNELS_BY_COLOR_TYPE = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
// [xStart, yStart, xStep, yStep] of each pass a PNG scanline sequence is split into.
const NON_INTERLACED_PASSES = [[0, 0, 1, 1]] as const;
const ADAM7_PASSES = [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]
] as const;

interface PngChunk {
    readonly type: string;
    readonly data: Buffer;
    readonly raw: Buffer;
}

interface ParsedPng {
    readonly chunks: PngChunk[];
    readonly header: Buffer | undefined;
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

    const decodedLength = getDecodedImageDataLength(parsed.header);
    if (decodedLength === undefined || decodedLength > MAX_DECODED_IMAGE_DATA_BYTES) {
        return bytes;
    }

    // IDAT data can come from any app that writes the clipboard; inflating it past the size
    // IHDR declares rejects with a RangeError instead of expanding a compression bomb.
    const imageData = await inflateAsync(Buffer.concat(parsed.idatData), { maxOutputLength: decodedLength });
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
    let header: Buffer | undefined;
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

        if (type === IHDR_CHUNK_TYPE && chunks.length === 0) {
            header = data;
        }

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
                ? { chunks, header, idatData, hasAnimation }
                : undefined;
        }
    }

    return undefined;
}

// The byte length of the filtered scanlines that the IDAT stream must inflate to, from IHDR;
// undefined when IHDR is missing or its color type or interlace method is unknown.
function getDecodedImageDataLength(header: Buffer | undefined): number | undefined {
    if (!header || header.byteLength !== IHDR_LENGTH) {
        return undefined;
    }

    const width = header.readUInt32BE(0);
    const height = header.readUInt32BE(4);
    const channels = CHANNELS_BY_COLOR_TYPE.get(header[9]);
    const interlaceMethod = header[12];
    if (width === 0 || height === 0 || channels === undefined || interlaceMethod > 1) {
        return undefined;
    }

    const bitsPerPixel = channels * header[8];
    let length = 0;

    for (const [xStart, yStart, xStep, yStep] of interlaceMethod === 0 ? NON_INTERLACED_PASSES : ADAM7_PASSES) {
        const passWidth = Math.ceil((width - xStart) / xStep);
        const passHeight = Math.ceil((height - yStart) / yStep);

        if (passWidth > 0 && passHeight > 0) {
            // Each scanline starts with a filter-type byte.
            length += passHeight * (1 + Math.ceil(passWidth * bitsPerPixel / 8));
        }
    }

    return length;
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
