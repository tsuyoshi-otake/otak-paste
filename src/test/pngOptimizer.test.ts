import assert from 'node:assert';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { normalizePngOptimizationMode } from '../pngOptimizationMode';
import { optimizePngBytes, optimizePngBytesLossless } from '../pngOptimizer';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('normalizePngOptimizationMode falls back to lossless for unknown values', () => {
    assert.strictEqual(normalizePngOptimizationMode('none'), 'none');
    assert.strictEqual(normalizePngOptimizationMode('lossless'), 'lossless');
    assert.strictEqual(normalizePngOptimizationMode('unexpected'), 'lossless');
});

test('optimizePngBytes leaves bytes unchanged when mode is none', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    assert.strictEqual(await optimizePngBytes(bytes, 'none'), bytes);
});

test('optimizePngBytesLossless reduces size while preserving decoded image data', async () => {
    const original = createPng({
        compressionLevel: 0,
        text: 'non-visual metadata'.repeat(64)
    });

    const optimized = await optimizePngBytesLossless(original);

    assert.ok(optimized.byteLength < original.byteLength, `${optimized.byteLength} should be below ${original.byteLength}`);
    assert.deepStrictEqual(inflateIdat(optimized), inflateIdat(original));
    assert.strictEqual(hasChunk(optimized, 'tEXt'), false);
});

test('optimizePngBytesLossless keeps the original bytes when optimization is not smaller', async () => {
    const original = createPng({ compressionLevel: 9 });

    assert.strictEqual(await optimizePngBytesLossless(original), original);
});

test('optimizePngBytesLossless keeps unsupported PNG data unchanged', async () => {
    const invalidPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const apng = createPng({
        animationControl: true,
        compressionLevel: 0,
        text: 'metadata'.repeat(64)
    });

    assert.strictEqual(await optimizePngBytesLossless(invalidPng), invalidPng);
    assert.strictEqual(await optimizePngBytesLossless(apng), apng);
});

test('optimizePngBytesLossless decodes Adam7-interlaced image data of the size IHDR declares', async () => {
    // A 3x3 grayscale image is split into five non-empty passes with six scanlines: 9 + 6 bytes.
    const original = createPng({
        width: 3,
        height: 3,
        colorType: 0,
        interlaceMethod: 1,
        imageData: Buffer.from([0, 1, 0, 2, 0, 3, 4, 0, 5, 0, 6, 0, 7, 8, 9]),
        compressionLevel: 0,
        text: 'metadata'.repeat(64)
    });

    const optimized = await optimizePngBytesLossless(original);

    assert.ok(optimized.byteLength < original.byteLength, `${optimized.byteLength} should be below ${original.byteLength}`);
    assert.deepStrictEqual(inflateIdat(optimized), inflateIdat(original));
});

test('optimizePngBytes keeps PNGs whose IDAT data inflates beyond the size IHDR declares unchanged', async () => {
    // 2x1 RGBA declares 9 bytes of scanlines.
    const oneByteOver = createPng({ imageData: Buffer.alloc(10), compressionLevel: 0 });
    // 1x1 RGBA declares 5 bytes, but the IDAT data inflates to 1 MiB.
    const compressionBomb = createPng({
        width: 1,
        imageData: Buffer.alloc(1024 * 1024),
        compressionLevel: 1
    });

    await assert.rejects(optimizePngBytesLossless(oneByteOver), RangeError);
    await assert.rejects(optimizePngBytesLossless(compressionBomb), RangeError);
    assert.strictEqual(await optimizePngBytes(compressionBomb, 'lossless'), compressionBomb);
});

test('optimizePngBytesLossless keeps PNGs without IHDR or above the decoding size cap unchanged', async () => {
    const withoutHeader = createPng({ omitHeader: true, compressionLevel: 0, text: 'metadata'.repeat(64) });
    // 8192x8192 RGBA declares 8192 * (1 + 8192 * 4) bytes, above the 128 MiB cap.
    const oversized = createPng({ width: 8192, height: 8192, compressionLevel: 0, text: 'metadata'.repeat(64) });

    assert.strictEqual(await optimizePngBytesLossless(withoutHeader), withoutHeader);
    assert.strictEqual(await optimizePngBytesLossless(oversized), oversized);
});

interface TestPngOptions {
    readonly animationControl?: boolean;
    readonly compressionLevel: number;
    readonly text?: string;
    readonly width?: number;
    readonly height?: number;
    readonly colorType?: number;
    readonly interlaceMethod?: number;
    readonly imageData?: Buffer;
    readonly omitHeader?: boolean;
}

// An 8-bit image, 2x1 RGBA unless the options say otherwise.
function createPng(options: TestPngOptions): Uint8Array {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(options.width ?? 2, 0);
    ihdr.writeUInt32BE(options.height ?? 1, 4);
    ihdr[8] = 8;
    ihdr[9] = options.colorType ?? 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = options.interlaceMethod ?? 0;

    const imageData = options.imageData ?? Buffer.from([
        0,
        255, 0, 0, 255,
        0, 0, 255, 255
    ]);

    const chunks = options.omitHeader ? [] : [
        createPngChunk('IHDR', ihdr)
    ];

    if (options.animationControl) {
        const animationControl = Buffer.alloc(8);
        animationControl.writeUInt32BE(1, 0);
        animationControl.writeUInt32BE(0, 4);
        chunks.push(createPngChunk('acTL', animationControl));
    }

    if (options.text) {
        chunks.push(createPngChunk('tEXt', Buffer.from(`Comment\0${options.text}`, 'utf8')));
    }

    chunks.push(
        createPngChunk('IDAT', deflateSync(imageData, { level: options.compressionLevel })),
        createPngChunk('IEND', Buffer.alloc(0))
    );

    return new Uint8Array(Buffer.concat([PNG_SIGNATURE, ...chunks]));
}

function inflateIdat(bytes: Uint8Array): Buffer {
    return inflateSync(Buffer.concat(collectChunkData(bytes, 'IDAT')));
}

function hasChunk(bytes: Uint8Array, type: string): boolean {
    return collectChunkData(bytes, type).length > 0;
}

function collectChunkData(bytes: Uint8Array, expectedType: string): Buffer[] {
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks: Buffer[] = [];
    let offset = PNG_SIGNATURE.byteLength;

    while (offset + 12 <= source.byteLength) {
        const length = source.readUInt32BE(offset);
        const type = source.toString('latin1', offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;

        if (dataEnd + 4 > source.byteLength) {
            break;
        }

        if (type === expectedType) {
            chunks.push(source.subarray(dataStart, dataEnd));
        }

        offset = dataEnd + 4;
    }

    return chunks;
}

function createPngChunk(type: string, data: Uint8Array): Buffer {
    const chunk = Buffer.alloc(8 + data.byteLength + 4);
    chunk.writeUInt32BE(data.byteLength, 0);
    chunk.write(type, 4, 4, 'latin1');
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
