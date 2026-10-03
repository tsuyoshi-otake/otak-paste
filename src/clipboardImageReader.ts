import { spawn } from 'node:child_process';

const WINDOWS_NO_IMAGE_EXIT_CODE = 2;
const WINDOWS_CLIPBOARD_TIMEOUT_MS = 5000;

const WINDOWS_READ_PNG_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Test-PngSignature([byte[]] $bytes) {
    $signature = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    if ($bytes.Length -le $signature.Length) {
        return $false
    }
    for ($i = 0; $i -lt $signature.Length; $i++) {
        if ($bytes[$i] -ne $signature[$i]) {
            return $false
        }
    }
    return $true
}

# An app can publish the original image under the registered PNG format next to the bitmap.
# GetImage() goes through the bitmap, which drops transparency and re-encodes, so that PNG
# is used as-is when valid.
if ([System.Windows.Forms.Clipboard]::ContainsData('PNG')) {
    $png = [System.Windows.Forms.Clipboard]::GetData('PNG')
    if ($png -is [System.IO.Stream]) {
        $buffer = New-Object System.IO.MemoryStream
        try {
            $png.CopyTo($buffer)
            $bytes = $buffer.ToArray()
        } finally {
            $buffer.Dispose()
            $png.Dispose()
        }
        if (Test-PngSignature $bytes) {
            [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
            exit 0
        }
    }
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
