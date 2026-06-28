# Change Log

## [0.3.0] - 2026-06-28

### Changed
- Added a dedicated `otakPaste.pasteImage` command bound to `Ctrl+V` / `Cmd+V` in Markdown editors.
- Reads PNG image data directly from the Windows clipboard before falling back to VS Code's normal paste command for non-image clipboard contents.
- Makes pasted PNG file creation part of the same undo operation as the Markdown image link insertion.

## [0.2.2] - 2026-06-28

### Changed
- Disabled VS Code's built-in Markdown file paste action by default so `Paste image to assets` can run without a chooser when user settings do not override it.

## [0.2.1] - 2026-06-28

### Changed
- Defaulted Markdown image paste preferences to `Paste image to assets` when the user has not configured a paste preference.

## [0.2.0] - 2026-06-28

### Added
- Added configurable pasted PNG optimization via `otakPaste.pngOptimization` with `lossless` and `none` modes. (#2)
- Highlighted lossless PNG optimization benefits in the Marketplace description and README. (#2)

## [0.1.3] - 2026-06-28

### Changed
- Replaced the extension icon asset set with the latest otak-paste icons.

## [0.1.2] - 2026-06-28

### Changed
- Refreshed the Marketplace README content and switched to the new otak-paste icon asset set.

## [0.1.1] - 2026-06-28

### Changed
- Updated the extension icon to align with the otak series.

## [0.1.0] - 2026-06-28

### Added
- Added Markdown image paste support for saved local files.
- Saves pasted PNG clipboard data to `assets/<16-hex>.png` beside the Markdown file.
- Inserts editable Markdown image snippets with alt text selected after paste.
- Added package and runtime localization for 16 languages.
- Added local VSIX packaging, README, license, and image assets.
