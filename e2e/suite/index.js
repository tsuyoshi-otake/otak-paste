const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const vscode = require('vscode');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND_CHUNK = Buffer.from('0000000049454e44ae426082', 'hex');
// setClipboardImage always puts an 8x8 bitmap on the clipboard; the test PNGs are 1x1.
const CLIPBOARD_BITMAP_SIZE = 8;
// Each edit breaks one structural rule of the 1x1 test PNG while keeping every chunk CRC valid.
const BROKEN_PNG_EDITS = [
  ['without IEND', chunks => chunks.filter(([type]) => type !== 'IEND')],
  ['without IDAT', chunks => chunks.filter(([type]) => type !== 'IDAT')],
  ['with a non-empty IEND', chunks => chunks.map(([type, data]) => [type, type === 'IEND' ? Buffer.from([0]) : data])],
  ['with an undefined IHDR color type', chunks => withHeaderColorType(chunks, 5)],
  ['with an indexed color type but no PLTE', chunks => withHeaderColorType(chunks, 3)],
];
const WAIT_TIMEOUT_MS = 5000;
const WAIT_INTERVAL_MS = 50;
const OTAK_PASTE_EDIT_KIND = 'markdown.image.otakPaste';
// Excel puts cell text and a rendered bitmap on the clipboard together.
const MIXED_CLIPBOARD_TEXT = 'cell A\tcell B';

async function run() {
  const workspacePath = process.env.OTAK_PASTE_E2E_WORKSPACE;
  assert.ok(workspacePath, 'OTAK_PASTE_E2E_WORKSPACE must be set');

  const powerShell = trackPowerShellSpawns();
  try {
    await textClipboardUsesDefaultPasteWithoutPowerShell(workspacePath, powerShell);
    await untitledMarkdownIsHandedBackToVsCode(powerShell);
    await mixedClipboardPastesTextWithoutImageAsset(workspacePath, powerShell);
    await pasteAsStillOffersImageFromMixedClipboard(workspacePath);
    await imageClipboardSavesAssetAndUndoRemovesIt(workspacePath, powerShell);
    await pngClipboardFormatIsSavedAsIs(workspacePath, powerShell);
    await brokenPngClipboardFormatFallsBackToBitmap(workspacePath, powerShell);
  } finally {
    powerShell.restore();
  }
}

async function textClipboardUsesDefaultPasteWithoutPowerShell(workspacePath, powerShell) {
  const markdownPath = path.join(workspacePath, 'text.md');
  fs.writeFileSync(markdownPath, '# Text\n\n', 'utf8');
  await vscode.env.clipboard.writeText('pasted text');

  const document = await openMarkdownAtEnd(vscode.Uri.file(markdownPath));
  const spawnsBefore = powerShell.spawns.length;

  await vscode.commands.executeCommand('otakPaste.pasteImage');

  await waitFor(() => document.getText() === '# Text\n\npasted text', () => `expected pasted text, got:\n${document.getText()}`);
  assert.strictEqual(powerShell.spawns.length - spawnsBefore, 0, 'a text paste must not start PowerShell');
  console.log('E2E text paste: inserted without PowerShell');

  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

async function untitledMarkdownIsHandedBackToVsCode(powerShell) {
  let probeCalls = 0;
  const probe = vscode.languages.registerDocumentPasteEditProvider(
    { language: 'markdown', scheme: 'untitled' },
    {
      provideDocumentPasteEdits() {
        probeCalls += 1;
        return [];
      },
    },
    {
      providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('e2e', 'probe')],
      pasteMimeTypes: ['image/png'],
    }
  );

  try {
    setClipboardImage();
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' });
    await vscode.window.showTextDocument(document);
    await focusActiveEditor();
    const spawnsBefore = powerShell.spawns.length;

    await vscode.commands.executeCommand('otakPaste.pasteImage');

    await waitFor(() => probeCalls > 0, () => 'VS Code paste providers should receive the untitled Markdown paste');
    assert.strictEqual(powerShell.spawns.length - spawnsBefore, 0, 'an untitled Markdown paste must not start PowerShell');
    console.log('E2E untitled paste: handed back to VS Code without PowerShell');
  } finally {
    probe.dispose();
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
}

async function mixedClipboardPastesTextWithoutImageAsset(workspacePath, powerShell) {
  const markdownPath = path.join(workspacePath, 'mixed.md');
  fs.writeFileSync(markdownPath, '# Mixed\n\n', 'utf8');
  setClipboardImage({ text: MIXED_CLIPBOARD_TEXT });

  const document = await openMarkdownAtEnd(vscode.Uri.file(markdownPath));
  const spawnsBefore = powerShell.spawns.length;
  const assetsBefore = listAssets(workspacePath);

  await vscode.commands.executeCommand('otakPaste.pasteImage');

  await waitFor(() => document.getText() !== '# Mixed\n\n', () => 'the mixed-clipboard paste inserted nothing');
  assert.strictEqual(
    document.getText(),
    `# Mixed\n\n${MIXED_CLIPBOARD_TEXT}`,
    'a mixed-clipboard paste should insert the clipboard text, not an image link'
  );
  assert.strictEqual(powerShell.spawns.length - spawnsBefore, 0, 'a mixed-clipboard paste must not start PowerShell');
  assert.deepStrictEqual(listAssets(workspacePath), assetsBefore, 'a mixed-clipboard paste must not write an image asset');
  console.log('E2E mixed paste: text inserted, no image asset');

  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

async function pasteAsStillOffersImageFromMixedClipboard(workspacePath) {
  const markdownPath = path.join(workspacePath, 'paste-as.md');
  fs.writeFileSync(markdownPath, '# Paste As\n\n', 'utf8');
  setClipboardImage({ text: MIXED_CLIPBOARD_TEXT });

  const document = await openMarkdownAtEnd(vscode.Uri.file(markdownPath));

  await vscode.commands.executeCommand('editor.action.pasteAs', { kind: OTAK_PASTE_EDIT_KIND });

  const linkPattern = /assets\/([0-9a-f]{16}\.png)/;
  await waitFor(() => linkPattern.test(document.getText()), () => `expected Paste As to insert an image link, got:\n${document.getText()}`);
  const imagePath = path.join(workspacePath, 'assets', document.getText().match(linkPattern)[1]);
  await waitFor(() => fs.existsSync(imagePath), () => `expected Paste As to write ${imagePath}`);
  console.log(`E2E paste as image: saved ${imagePath}`);

  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  fs.rmSync(imagePath);
}

async function imageClipboardSavesAssetAndUndoRemovesIt(workspacePath, powerShell) {
  const markdownPath = path.join(workspacePath, 'document.md');
  fs.writeFileSync(markdownPath, '# E2E\n\n', 'utf8');

  setClipboardImage();

  const document = await openMarkdownAtEnd(vscode.Uri.file(markdownPath));
  const spawnsBefore = powerShell.spawns.length;

  await vscode.commands.executeCommand('otakPaste.pasteImage');

  const imageReads = powerShell.spawns.slice(spawnsBefore);
  assert.strictEqual(imageReads.length, 1, 'an image paste should read the clipboard with one PowerShell process');
  assert.strictEqual(await imageReads[0].exitCode, 0, 'the clipboard image reader should exit successfully');

  const text = document.getText();
  const match = text.match(/!\[\$\{1:image\}\]\(assets\/([0-9a-f]{16}\.png)\)|!\[image\]\(assets\/([0-9a-f]{16}\.png)\)/);
  assert.ok(match, `expected markdown image link, got:\n${text}`);
  await document.save();

  const fileName = match[1] ?? match[2];
  const imagePath = path.join(workspacePath, 'assets', fileName);
  assert.ok(fs.existsSync(imagePath), `expected pasted PNG at ${imagePath}`);

  const pngBytes = fs.readFileSync(imagePath);
  assert.ok(pngBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), 'saved file should be a PNG');
  assert.ok(pngBytes.byteLength > PNG_SIGNATURE.length, 'saved PNG should not be empty');

  console.log(`E2E pasted image saved: ${imagePath}`);

  await vscode.commands.executeCommand('undo');

  assert.strictEqual(document.getText(), '# E2E\n\n', 'undo should remove the inserted markdown image link');
  assert.strictEqual(fs.existsSync(imagePath), false, 'undo should remove the pasted PNG asset');
  console.log(`E2E undo removed image: ${imagePath}`);
}

async function pngClipboardFormatIsSavedAsIs(workspacePath, powerShell) {
  await withoutPngOptimization(async () => {
    const sourcePng = setClipboardImage({ png: 'encoded' });
    // IHDR color type 6 is RGBA: the source carries the transparency that must survive.
    assert.strictEqual(sourcePng[25], 6, 'the clipboard PNG should have an alpha channel');

    const { imagePath, savedPng } = await pasteImageIntoNewMarkdown(workspacePath, powerShell, 'png-format.md');
    assert.ok(savedPng.equals(sourcePng), 'the PNG clipboard format should be saved byte-for-byte, transparency included');
    console.log(`E2E PNG clipboard format saved as-is: ${imagePath}`);
  });
}

async function brokenPngClipboardFormatFallsBackToBitmap(workspacePath, powerShell) {
  await withoutPngOptimization(async () => {
    // The unedited test PNG is taken as-is, so each edit below is the only reason for a fallback.
    const intactPng = createTestPng();
    setClipboardImage({ png: intactPng });
    const intact = await pasteImageIntoNewMarkdown(workspacePath, powerShell, 'intact-png-format.md');
    assert.ok(intact.savedPng.equals(intactPng), 'the intact test PNG clipboard format should be saved as-is');

    for (const [description, edit] of BROKEN_PNG_EDITS) {
      setClipboardImage({ png: createTestPng(edit) });

      const { imagePath, savedPng } = await pasteImageIntoNewMarkdown(workspacePath, powerShell, 'broken-png-format.md');
      assert.ok(
        savedPng.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
          savedPng.subarray(-PNG_IEND_CHUNK.length).equals(PNG_IEND_CHUNK) &&
          savedPng.readUInt32BE(16) === CLIPBOARD_BITMAP_SIZE,
        `a PNG clipboard format ${description} should be skipped for the bitmap, saved as a complete PNG`
      );
      console.log(`E2E broken PNG clipboard format fell back to bitmap (${description}): ${imagePath}`);
    }
  });
}

// A 1x1 RGBA PNG; `edit` takes and returns its chunks as [type, data] pairs.
function createTestPng(edit = chunks => chunks) {
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const chunks = edit([
    ['IHDR', header],
    ['IDAT', zlib.deflateSync(Buffer.from([0, 32, 120, 220, 128]))],
    ['IEND', Buffer.alloc(0)],
  ]);
  return Buffer.concat([PNG_SIGNATURE, ...chunks.map(([type, data]) => createPngChunk(type, data))]);
}

function withHeaderColorType(chunks, colorType) {
  return chunks.map(([type, data]) => {
    if (type !== 'IHDR') {
      return [type, data];
    }
    const header = Buffer.from(data);
    header[9] = colorType;
    return [type, header];
  });
}

function createPngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// `none` keeps the optimizer out, so a saved file shows exactly what the reader returned.
async function withoutPngOptimization(body) {
  const configuration = vscode.workspace.getConfiguration('otakPaste');
  await configuration.update('pngOptimization', 'none', vscode.ConfigurationTarget.Workspace);
  try {
    await body();
  } finally {
    await configuration.update('pngOptimization', undefined, vscode.ConfigurationTarget.Workspace);
  }
}

// Pastes the clipboard image into a new Markdown file, checks that one PowerShell process
// read it, and returns the saved PNG; the editor is closed and the asset removed afterwards.
async function pasteImageIntoNewMarkdown(workspacePath, powerShell, markdownName) {
  const markdownPath = path.join(workspacePath, markdownName);
  fs.writeFileSync(markdownPath, '# PNG\n\n', 'utf8');
  const document = await openMarkdownAtEnd(vscode.Uri.file(markdownPath));
  const spawnsBefore = powerShell.spawns.length;

  await vscode.commands.executeCommand('otakPaste.pasteImage');

  const imageReads = powerShell.spawns.slice(spawnsBefore);
  assert.strictEqual(imageReads.length, 1, 'an image paste should read the clipboard with one PowerShell process');
  assert.strictEqual(await imageReads[0].exitCode, 0, 'the clipboard image reader should exit successfully');

  const match = document.getText().match(/assets\/([0-9a-f]{16}\.png)/);
  assert.ok(match, `expected markdown image link, got:\n${document.getText()}`);
  const imagePath = path.join(workspacePath, 'assets', match[1]);
  await waitFor(() => fs.existsSync(imagePath), () => `expected pasted PNG at ${imagePath}`);
  const savedPng = fs.readFileSync(imagePath);

  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  fs.rmSync(imagePath);
  return { imagePath, savedPng };
}

async function openMarkdownAtEnd(uri) {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const end = document.positionAt(document.getText().length);
  editor.selection = new vscode.Selection(end, end);
  await focusActiveEditor();
  return document;
}

// A real Ctrl+V comes from a focused editor; VS Code's default paste only targets
// an editor with text focus, which showTextDocument does not guarantee yet.
async function focusActiveEditor() {
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
}

// The extension calls child_process.spawn through the shared module object,
// so wrapping it here observes every PowerShell process the extension starts.
function trackPowerShellSpawns() {
  const originalSpawn = childProcess.spawn;
  const spawns = [];

  childProcess.spawn = function spawnAndTrack(command, ...rest) {
    const child = originalSpawn.call(this, command, ...rest);
    if (/powershell/i.test(String(command))) {
      spawns.push({
        exitCode: new Promise(resolve => {
          child.on('close', resolve);
          child.on('error', () => resolve(null));
        }),
      });
    }
    return child;
  };

  return {
    spawns,
    restore() {
      childProcess.spawn = originalSpawn;
    },
  };
}

async function waitFor(condition, describeFailure) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) {
      assert.fail(describeFailure());
    }
    await new Promise(resolve => setTimeout(resolve, WAIT_INTERVAL_MS));
  }
}

function listAssets(workspacePath) {
  const assetsPath = path.join(workspacePath, 'assets');
  return fs.existsSync(assetsPath) ? fs.readdirSync(assetsPath).sort() : [];
}

// Puts an 8x8 bitmap on the clipboard. `text` adds text (a mixed clipboard);
// `png` makes the bitmap half-transparent and also publishes PNG data in the
// registered PNG format next to it: 'encoded' publishes the bitmap encoded as PNG
// and returns those bytes; a Buffer is published as given.
function setClipboardImage({ text, png } = {}) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 8, 8
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $alpha = if ($env:OTAK_PASTE_E2E_CLIPBOARD_PNG) { 128 } else { 255 }
    $graphics.Clear([System.Drawing.Color]::FromArgb($alpha, 32, 120, 220))
    $data = New-Object System.Windows.Forms.DataObject
    $data.SetImage($bitmap)
    # The variable is 'encoded' or the Base64 of the PNG data to publish.
    if ($env:OTAK_PASTE_E2E_CLIPBOARD_PNG -eq 'encoded') {
        $encoded = New-Object System.IO.MemoryStream
        $bitmap.Save($encoded, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBytes = $encoded.ToArray()
        [Console]::Out.Write([Convert]::ToBase64String($pngBytes))
    } elseif ($env:OTAK_PASTE_E2E_CLIPBOARD_PNG) {
        $pngBytes = [Convert]::FromBase64String($env:OTAK_PASTE_E2E_CLIPBOARD_PNG)
    }
    if ($env:OTAK_PASTE_E2E_CLIPBOARD_PNG) {
        $data.SetData('PNG', (New-Object System.IO.MemoryStream (,$pngBytes)))
    }
    if ($env:OTAK_PASTE_E2E_CLIPBOARD_TEXT) {
        $data.SetText($env:OTAK_PASTE_E2E_CLIPBOARD_TEXT)
    }
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
`;

  const env = { ...process.env };
  if (text !== undefined) {
    env.OTAK_PASTE_E2E_CLIPBOARD_TEXT = text;
  }
  if (png !== undefined) {
    env.OTAK_PASTE_E2E_CLIPBOARD_PNG = Buffer.isBuffer(png) ? png.toString('base64') : png;
  }

  const result = childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-Command', script],
    { encoding: 'utf8', env }
  );

  assert.strictEqual(result.status, 0, `failed to set clipboard image:\n${result.stderr}`);
  return png === 'encoded' ? Buffer.from(result.stdout.trim(), 'base64') : undefined;
}

module.exports = {
  run,
};
