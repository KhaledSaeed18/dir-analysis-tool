/**
 * dir-analysis-tool: fast, memory-bounded directory analysis.
 *
 * @example
 * ```ts
 * import { analyze, compare, formatBytes } from 'dir-analysis-tool';
 *
 * const result = await analyze('./dist', { top: 5, budgets: ['size<=2MB'] });
 * console.log(formatBytes(result.summary.bytes));
 * ```
 *
 * @packageDocumentation
 */

export { analyze, DEFAULT_LARGE_FILE_THRESHOLD, DEFAULT_STALE_AGE } from './core/analyze.ts';
export type { AnalyzeOptions, AnalysisProgress } from './core/analyze.ts';
export { compare } from './core/compare.ts';
export type { CompareOptions } from './core/compare.ts';
export { DEFAULT_CONCURRENCY, listDirectories } from './core/options.ts';
export type { ScanSettings } from './core/options.ts';
export { DEFAULT_EXCLUDES } from './core/exclude.ts';
export { classify, extensionOf } from './core/classify.ts';
export { BUDGET_METRICS, evaluateBudgets, parseBudget } from './core/budgets.ts';
export type { Budget } from './core/budgets.ts';
export { CONFIG_FILE_NAMES, findConfigFile, loadConfig } from './config/load.ts';
export type { LoadedConfig } from './config/load.ts';
export { buildJsonSchema, validateConfig } from './config/schema.ts';
export type { DatConfig } from './config/schema.ts';
export { formatBytes, parseSize } from './format/bytes.ts';
export type { ByteUnits } from './format/bytes.ts';
export { parseDuration, parsePointInTime } from './format/time.ts';
export { renderAnalysis, renderComparison } from './reporters/pretty.ts';
export type { PrettyOptions } from './reporters/pretty.ts';
export { renderAnalysisMarkdown, renderComparisonMarkdown } from './reporters/markdown.ts';
export { renderAnalysisCsv, renderComparisonCsv } from './reporters/csv.ts';
export { renderAnalysisHtml } from './reporters/html.ts';
export { createStyle } from './format/style.ts';
export type { Style } from './format/style.ts';
export { AbortError, DatError } from './errors.ts';
export { VERSION } from './version.ts';
export * from './types.ts';
