import { runTests } from '@vscode/test-electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const e2eRoot = path.join(os.homedir(), 'tmp', 'otak-paste-e2e');
const workspacePath = path.join(e2eRoot, `workspace-${Date.now()}`);
const userDataDir = path.join(e2eRoot, `user-data-${Date.now()}`);
const extensionsDir = path.join(e2eRoot, `extensions-${Date.now()}`);

fs.mkdirSync(workspacePath, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });

await runTests({
  extensionDevelopmentPath: repoRoot,
  extensionTestsPath: path.join(repoRoot, 'e2e', 'suite', 'index.js'),
  launchArgs: [
    workspacePath,
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    extensionsDir,
    '--disable-extensions',
  ],
  extensionTestsEnv: {
    OTAK_PASTE_E2E_WORKSPACE: workspacePath,
  },
});
