const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WAIT_TIMEOUT_MS = 5000;
const WAIT_INTERVAL_MS = 50;

async function run() {
  const workspacePath = process.env.OTAK_PASTE_E2E_WORKSPACE;
  assert.ok(workspacePath, 'OTAK_PASTE_E2E_WORKSPACE must be set');

  const powerShell = trackPowerShellSpawns();
  try {
    await textClipboardUsesDefaultPasteWithoutPowerShell(workspacePath, powerShell);
    await untitledMarkdownIsHandedBackToVsCode(powerShell);
    await imageClipboardSavesAssetAndUndoRemovesIt(workspacePath, powerShell);
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

function setClipboardImage() {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 8, 8
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 32, 120, 220))
    [System.Windows.Forms.Clipboard]::SetImage($bitmap)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
`;

  const result = childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-Command', script],
    { encoding: 'utf8' }
  );

  assert.strictEqual(result.status, 0, `failed to set clipboard image:\n${result.stderr}`);
}

module.exports = {
  run,
};
