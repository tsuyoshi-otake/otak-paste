export const DEFAULT_PNG_OPTIMIZATION_MODE = 'lossless';
export const PNG_OPTIMIZATION_MODES = [DEFAULT_PNG_OPTIMIZATION_MODE, 'none'] as const;

export type PngOptimizationMode = typeof PNG_OPTIMIZATION_MODES[number];

export function normalizePngOptimizationMode(value: unknown): PngOptimizationMode {
    return value === 'none' || value === 'lossless'
        ? value
        : DEFAULT_PNG_OPTIMIZATION_MODE;
}
