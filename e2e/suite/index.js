const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function run() {
  const workspacePath = process.env.OTAK_PASTE_E2E_WORKSPACE;
  assert.ok(workspacePath, 'OTAK_PASTE_E2E_WORKSPACE must be set');

  const markdownPath = path.join(workspacePath, 'document.md');
  fs.writeFileSync(markdownPath, '# E2E\n\n', 'utf8');

  setClipboardImage();

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(markdownPath));
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(document.positionAt(document.getText().length), document.positionAt(document.getText().length));

  await vscode.commands.executeCommand('otakPaste.pasteImage');

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
