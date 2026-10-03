const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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
  const markdownPath = path.join(workspacePath, 'png-format.md');
  fs.writeFileSync(markdownPath, '# PNG\n\n', 'utf8');

  // `none` keeps the optimizer out, so the saved file shows exactly what was read.
  const configuration = vscode.workspace.getConfiguration('otakPaste');
  await configuration.update('pngOptimization', 'none', vscode.ConfigurationTarget.Workspace);
  try {
    const sourcePng = setClipboardImage({ pngFormat: true });
    // IHDR color type 6 is RGBA: the source carries the transparency that must survive.
    assert.strictEqual(sourcePng[25], 6, 'the clipboard PNG should have an alpha channel');

    const document = await openMarkdownAtEnd(vscode.Uri.file(markdownPath));
    const spawnsBefore = powerShell.spawns.length;

    await vscode.commands.executeCommand('otakPaste.pasteImage');

    const imageReads = powerShell.spawns.slice(spawnsBefore);
    assert.strictEqual(imageReads.length, 1, 'a PNG paste should read the clipboard with one PowerShell process');
    assert.strictEqual(await imageReads[0].exitCode, 0, 'the clipboard image reader should exit successfully');

    const match = document.getText().match(/assets\/([0-9a-f]{16}\.png)/);
    assert.ok(match, `expected markdown image link, got:\n${document.getText()}`);
    const imagePath = path.join(workspacePath, 'assets', match[1]);
    await waitFor(() => fs.existsSync(imagePath), () => `expected pasted PNG at ${imagePath}`);
    assert.ok(
      fs.readFileSync(imagePath).equals(sourcePng),
      'the PNG clipboard format should be saved byte-for-byte, transparency included'
    );
    console.log(`E2E PNG clipboard format saved as-is: ${imagePath}`);

    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    fs.rmSync(imagePath);
  } finally {
    await configuration.update('pngOptimization', undefined, vscode.ConfigurationTarget.Workspace);
  }
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
// `pngFormat` makes the image half-transparent, also publishes it in the
// registered PNG format next to the bitmap, and returns those PNG bytes.
function setClipboardImage({ text, pngFormat = false } = {}) {
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
    if ($env:OTAK_PASTE_E2E_CLIPBOARD_PNG) {
        $encoded = New-Object System.IO.MemoryStream
        $bitmap.Save($encoded, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBytes = $encoded.ToArray()
        $data.SetData('PNG', (New-Object System.IO.MemoryStream (,$pngBytes)))
        [Console]::Out.Write([Convert]::ToBase64String($pngBytes))
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
  if (pngFormat) {
    env.OTAK_PASTE_E2E_CLIPBOARD_PNG = '1';
  }

  const result = childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-Command', script],
    { encoding: 'utf8', env }
  );

  assert.strictEqual(result.status, 0, `failed to set clipboard image:\n${result.stderr}`);
  return pngFormat ? Buffer.from(result.stdout.trim(), 'base64') : undefined;
}

module.exports = {
  run,
};
