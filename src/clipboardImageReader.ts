import { spawn } from 'node:child_process';

const WINDOWS_NO_IMAGE_EXIT_CODE = 2;
const WINDOWS_CLIPBOARD_TIMEOUT_MS = 5000;

const WINDOWS_READ_PNG_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

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
    const encodedCommand = Buffer.from(WINDOWS_READ_PNG_SCRIPT, 'utf16le').toString('base64');

    return new Promise(resolve => {
        let settled = false;
        let timedOut = false;
        const stdoutChunks: Buffer[] = [];
        let timeout: NodeJS.Timeout;

        const child = spawn(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-STA',
                '-EncodedCommand',
                encodedCommand
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
