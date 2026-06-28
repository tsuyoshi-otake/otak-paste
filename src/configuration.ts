import * as vscode from 'vscode';
import { normalizePngOptimizationMode, PngOptimizationMode } from './pngOptimizationMode';

const CONFIGURATION_SECTION = 'otakPaste';
const PNG_OPTIMIZATION_SETTING = 'pngOptimization';

export function getPngOptimizationMode(): PngOptimizationMode {
    return normalizePngOptimizationMode(
        vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get(PNG_OPTIMIZATION_SETTING)
    );
}
