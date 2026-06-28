<div align="center">

# otak-paste

**Paste an image into your Markdown and just keep writing.**  
otak-paste saves it to a local `assets/` folder and writes the link for you, with no network calls and nothing leaving your machine.

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/odangoo.otak-paste?label=Marketplace&color=1d4ed8)](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-paste)
[![VS Code engine](https://img.shields.io/badge/VS%20Code-%5E1.125.0-007acc)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-otak--paste-24292f)](https://github.com/tsuyoshi-otake/otak-paste)

![100% local processing](https://img.shields.io/badge/processing-100%25%20local-0f766e)
![No telemetry](https://img.shields.io/badge/telemetry-none-64748b)
![Zero network calls](https://img.shields.io/badge/network-zero%20calls-7c3aed)
![Works offline](https://img.shields.io/badge/offline-ready-334155)

[**Install**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-paste) ·
[**GitHub**](https://github.com/tsuyoshi-otake/otak-paste) ·
[**Report an issue**](https://github.com/tsuyoshi-otake/otak-paste/issues)

</div>

---

Teams writing documentation in Markdown handle the same chore on every screenshot: save the file, name it, move it into the repository, then type out the link. **otak-paste reduces all of it to a single paste** and does so entirely on your machine, with no network access and no data collection.

## Quick Start

1. **Install** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-paste).
2. Open a **saved** Markdown file.
3. Copy a PNG, or take a screenshot.
4. Paste with <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>Cmd</kbd>+<kbd>V</kbd> on macOS).

otak-paste writes the image next to your file and inserts the link:

```markdown
![image](assets/4f8c9a01d2b3e4f5.png)
```

The `image` alt text is **pre-selected**, so you can type a real description right away.

## Capabilities

- **One-keystroke flow**: runs from the normal editor paste action. No commands, no dialogs.
- **Local-first assets**: images are written to an `assets/` folder beside the current file, never scattered across the workspace.
- **Unique filenames**: each file receives a random 16-character hex name such as `4f8c9a01d2b3e4f5.png`.
- **Editable alt text**: the alt text is selected on paste, ready to describe.
- **Non-intrusive**: no success pop-ups; it stays out of your workflow.
- **Localized interface**: UI messages follow your VS Code display language.

## How It Works

When a PNG is on your clipboard and the active editor is a saved Markdown file, otak-paste:

1. Resolves the Markdown file's directory.
2. Creates an `assets/` folder if one does not exist.
3. Generates a random 16-character hex filename.
4. Writes the pasted PNG into `assets/`.
5. Inserts the Markdown image link at the cursor.

Anything outside those conditions is handed back to VS Code's default paste behavior. otak-paste only handles the specific case it was built for.

## Supported Scenarios

| otak-paste handles | Handed back to VS Code's default |
| --- | --- |
| A **saved, local** `.md` file is active | Untitled, virtual, or remote-only documents |
| The clipboard holds **PNG image data** | Non-PNG data such as JPEG, GIF, or WebP |
| Direct paste into a Markdown editor | Copied image **files** rather than image data |

> Only local `file:` Markdown documents are supported in v1.

## Security & Privacy

otak-paste is designed to run safely inside locked-down, regulated, and air-gapped environments.

- **100% local processing**: images are handled entirely on your machine.
- **Zero network access**: it never uploads images or transmits clipboard data anywhere.
- **No telemetry**: no analytics, usage tracking, or external calls of any kind.
- **No account or API key**: nothing to sign in to, nothing to provision.
- **Scoped file writes**: it only writes PNGs into the `assets/` folder beside the active file.
- **Open source, MIT-licensed**: the full implementation is auditable on [GitHub](https://github.com/tsuyoshi-otake/otak-paste).
- **Settings-safe**: it never changes your VS Code configuration on your behalf.

## Language Support

The interface follows your VS Code display language:

**English** · 日本語 · 简体中文 · 繁體中文 · 한국어 · Tiếng Việt · Español · Português (BR) · Français · Deutsch · हिन्दी · Bahasa Indonesia · Italiano · Русский · العربية · Türkçe

## Requirements

- VS Code **1.125.0** or newer
- A **saved**, local Markdown file
- **PNG** image data on the clipboard

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-paste), or run:

```text
ext install odangoo.otak-paste
```

<details>
<summary><strong>Build from source (VSIX)</strong></summary>

```bash
npm install
npm run package
code --install-extension otak-paste-0.1.2.vsix
```

Reload VS Code afterwards if the Markdown editor was already open.

</details>

## Troubleshooting

- **Nothing happens when I paste**: confirm the file is **saved** and the clipboard holds PNG image data.
- **VS Code's built-in paste takes over**: set `"markdown.editor.filePaste.enabled": "never"` in that workspace and try again. otak-paste does not change this setting for you.
- **The image was saved in an unexpected location**: the `assets/` folder is created next to the **active Markdown file**, not at the workspace root.
- **A JPEG / GIF / WebP was not handled**: v1 handles PNG clipboard data only.

## Related Extensions

More VS Code extensions by [odangoo](https://marketplace.visualstudio.com/publishers/odangoo):

| Extension | Description |
| --- | --- |
| [**otak-proxy**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-proxy) | One-click proxy switching for VS Code, Git, npm, and integrated terminals |
| [**otak-monitor**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-monitor) | Real-time CPU, memory, and disk usage in the status bar |
| [**otak-committer**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-committer) | AI-assisted commit messages, pull requests, and issues |
| [**otak-clipboard**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-clipboard) | Copy a folder or the current tab to your clipboard in two clicks |
| [**otak-clock**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-clock) | Dual time-zone clock for the status bar |
| [**otak-pomodoro**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-pomodoro) | A Pomodoro focus timer built into VS Code |
| [**otak-restart**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-restart) | Quick Extension Host and window restart from the status bar |
| [**otak-zen**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-zen) | A calm, distraction-free Zen mode for VS Code |
| [**otak-lsp**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-lsp) | Japanese morphological analysis with grammar checks, semantic highlights, and hovers |
| [**otak-usage**](https://marketplace.visualstudio.com/items?itemName=odangoo.otak-usage) | At-a-glance usage statistics for VS Code |

## License

Released under the [MIT License](LICENSE).

<div align="center">
<br>
<sub>Built by <a href="https://github.com/tsuyoshi-otake">tsuyoshi-otake</a> · <a href="https://marketplace.visualstudio.com/items?itemName=odangoo.otak-paste">Marketplace</a> · <a href="https://github.com/tsuyoshi-otake/otak-paste">GitHub</a> · <a href="https://github.com/tsuyoshi-otake/otak-paste/issues">Issues</a></sub>
</div>
