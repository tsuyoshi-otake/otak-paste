import { spawn } from 'node:child_process';

const WINDOWS_NO_IMAGE_EXIT_CODE = 2;
const WINDOWS_CLIPBOARD_TIMEOUT_MS = 5000;

const WINDOWS_READ_PNG_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# An app can publish the original image under the registered PNG format next to the bitmap.
# GetImage() goes through the bitmap, which drops transparency and re-encodes, so that PNG
# is used as-is when its header, chunk order, and checksums are valid. The format is read as raw
# clipboard memory because the WinForms clipboard API can deserialize .NET objects that another
# process put on the clipboard.
try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OtakPasteClipboardPng {
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool CloseClipboard();
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr GetClipboardData(uint format);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern UIntPtr GlobalSize(IntPtr handle);

    static readonly byte[] Signature = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };

    // Returns the PNG published under the registered PNG format, trimmed to its IEND chunk,
    // or null when the format is absent or its data is not a complete PNG.
    public static byte[] Read() {
        byte[] data = ReadFormat("PNG");
        if (data == null) {
            return null;
        }
        int end = FindPngEnd(data);
        if (end < 0) {
            return null;
        }
        byte[] png = new byte[end];
        Buffer.BlockCopy(data, 0, png, 0, end);
        return png;
    }

    static byte[] ReadFormat(string name) {
        uint format = RegisterClipboardFormat(name);
        if (format == 0 || !OpenClipboard(IntPtr.Zero)) {
            return null;
        }
        try {
            IntPtr handle = GetClipboardData(format);
            if (handle == IntPtr.Zero) {
                return null;
            }
            ulong size = GlobalSize(handle).ToUInt64();
            if (size > int.MaxValue) {
                return null;
            }
            IntPtr pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero) {
                return null;
            }
            try {
                byte[] data = new byte[(int)size];
                Marshal.Copy(pointer, data, 0, data.Length);
                return data;
            } finally {
                GlobalUnlock(handle);
            }
        } finally {
            CloseClipboard();
        }
    }

    // A clipboard block can be larger than the data in it, so the PNG ends at its IEND chunk.
    // Returns that length, or -1 unless every chunk's CRC matches, a valid IHDR comes first,
    // an indexed-color image has PLTE before its image data, and IDAT precedes an empty IEND.
    static int FindPngEnd(byte[] data) {
        if (data.Length < Signature.Length) {
            return -1;
        }
        for (int i = 0; i < Signature.Length; i++) {
            if (data[i] != Signature[i]) {
                return -1;
            }
        }
        int offset = Signature.Length;
        int colorType = -1;
        bool hasPalette = false;
        bool hasImageData = false;
        while (data.Length - offset >= 12) {
            uint length = ReadUInt32(data, offset);
            if (length > (uint)(data.Length - offset - 12)) {
                return -1;
            }
            int typeOffset = offset + 4;
            int dataOffset = typeOffset + 4;
            int crcOffset = dataOffset + (int)length;
            if (Crc32(data, typeOffset, 4 + (int)length) != ReadUInt32(data, crcOffset)) {
                return -1;
            }
            bool isHeader = IsChunkType(data, typeOffset, "IHDR");
            if (isHeader != (offset == Signature.Length)) {
                return -1;
            }
            offset = crcOffset + 4;
            if (isHeader) {
                if (length != 13 || !IsValidHeader(data, dataOffset)) {
                    return -1;
                }
                colorType = data[dataOffset + 9];
            } else if (IsChunkType(data, typeOffset, "PLTE")) {
                hasPalette = true;
            } else if (IsChunkType(data, typeOffset, "IDAT")) {
                if (colorType == 3 && !hasPalette) {
                    return -1;
                }
                hasImageData = true;
            } else if (IsChunkType(data, typeOffset, "IEND")) {
                return hasImageData && length == 0 ? offset : -1;
            }
        }
        return -1;
    }

    // Width and height are 1 to 2^31-1; each color type allows only its own bit depths;
    // compression and filter methods are 0, and interlace is none (0) or Adam7 (1).
    static bool IsValidHeader(byte[] data, int offset) {
        uint width = ReadUInt32(data, offset);
        uint height = ReadUInt32(data, offset + 4);
        if (width == 0 || width > int.MaxValue || height == 0 || height > int.MaxValue) {
            return false;
        }
        if (data[offset + 10] != 0 || data[offset + 11] != 0 || data[offset + 12] > 1) {
            return false;
        }
        int bitDepth = data[offset + 8];
        switch (data[offset + 9]) {
            case 0:
                return bitDepth == 1 || bitDepth == 2 || bitDepth == 4 || bitDepth == 8 || bitDepth == 16;
            case 3:
                return bitDepth == 1 || bitDepth == 2 || bitDepth == 4 || bitDepth == 8;
            case 2:
            case 4:
            case 6:
                return bitDepth == 8 || bitDepth == 16;
            default:
                return false;
        }
    }

    static bool IsChunkType(byte[] data, int offset, string type) {
        for (int i = 0; i < 4; i++) {
            if (data[offset + i] != type[i]) {
                return false;
            }
        }
        return true;
    }

    static uint ReadUInt32(byte[] data, int offset) {
        return ((uint)data[offset] << 24) | ((uint)data[offset + 1] << 16)
            | ((uint)data[offset + 2] << 8) | data[offset + 3];
    }

    static uint Crc32(byte[] data, int offset, int count) {
        uint crc = 0xFFFFFFFF;
        for (int i = offset; i < offset + count; i++) {
            crc ^= data[i];
            for (int bit = 0; bit < 8; bit++) {
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;
            }
        }
        return ~crc;
    }
}
'@
    $png = [OtakPasteClipboardPng]::Read()
} catch {
    # Add-Type can be blocked, for example by application control; the bitmap path still works.
    $png = $null
}
if ($null -ne $png) {
    [Console]::OpenStandardOutput().Write($png, 0, $png.Length)
    exit 0
}

if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
    exit ${WINDOWS_NO_IMAGE_EXIT_CODE}
}

$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) {
    exit ${WINDOWS_NO_IMAGE_EXIT_CODE}
}

$stream = New-Object System.IO.MemoryStream
try {
    $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
} finally {
    $stream.Dispose()
    $image.Dispose()
}
`;

export async function readPngFromClipboard(): Promise<Uint8Array | undefined> {
    if (process.platform !== 'win32') {
        return undefined;
    }

    return readWindowsPngFromClipboard();
}

function readWindowsPngFromClipboard(): Promise<Uint8Array | undefined> {
    return new Promise(resolve => {
        let settled = false;
        let timedOut = false;
        const stdoutChunks: Buffer[] = [];
        let timeout: NodeJS.Timeout;

        const child = spawn(
            'powershell.exe',
            // A plain -Command script stays auditable in process listings; execution
            // policy only governs script files, so no policy override flag is needed.
            [
                '-NoProfile',
                '-NonInteractive',
                '-STA',
                '-Command',
                WINDOWS_READ_PNG_SCRIPT
            ],
            {
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true
            }
        );

        const finish = (value: Uint8Array | undefined): void => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(value);
            }
        };

        timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
            finish(undefined);
        }, WINDOWS_CLIPBOARD_TIMEOUT_MS);

        child.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
        });

        child.on('error', () => {
            finish(undefined);
        });

        child.on('close', code => {
            if (timedOut || code === WINDOWS_NO_IMAGE_EXIT_CODE) {
                finish(undefined);
                return;
            }

            const pngBytes = Buffer.concat(stdoutChunks);
            finish(code === 0 && pngBytes.byteLength > 0
                ? new Uint8Array(pngBytes)
                : undefined);
        });
    });
}
