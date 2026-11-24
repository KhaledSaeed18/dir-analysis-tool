import type { Command } from '../command.ts';
import { analyze, type AnalyzeOptions } from '../../core/analyze.ts';
import { compactAnalysis } from '../../core/compact.ts';
import { formatBudgetActual } from '../../core/budgets.ts';
import { stringifyJson } from '../../format/text.ts';
import { renderAnalysisCsv } from '../../reporters/csv.ts';
import { renderAnalysisHtml } from '../../reporters/html.ts';
import { renderAnalysisAs } from '../../reporters/index.ts';
import type { AnalysisResult } from '../../types.ts';
import type { Context } from '../context.ts';
import { ExitCode, terminalWidth } from '../io.ts';
import {
    addCompactOption,
    addFileReportOptions,
    addOutputOptions,
    addReportOptions,
    addScanOptions,
    applyLegacyLargeFiles,
    explicitOptions,
    resolveAnalyzeOptions,
    resolveDisplay,
    type DisplaySettings,
} from '../options.ts';
import { ProgressLine } from '../progress.ts';

const EXAMPLES = `
Examples:
  $ dat                                  analyze the current directory
  $ dat ~/Downloads -l 500MB             list files of 500 MB or more
  $ dat . -d                             find duplicate files and reclaimable space
  $ dat . --stale 2y --top 20            files untouched for two years
  $ dat . -t --tree-depth 2              size tree, two levels deep
  $ dat . -g -x                          honor .gitignore, show extensions
  $ dat . -b "size<=200MB" -b "duplicates=0"
                                         enforce budgets in CI (exit code 2 on failure)
  $ dat . -f markdown >> "$GITHUB_STEP_SUMMARY"
  $ dat . --json | jq '.largestFiles[0]'
  $ dat . -d --compact                   bounded one-line JSON for scripts and agents
  $ dat . --html report.html             self-contained HTML report
`;

export function registerAnalyze(program: Command, ctx: Context): void {
    const command = program
        .command('analyze', { isDefault: true })
        .description('analyze a directory (the default command)')
        .argument('[directory]', 'directory to analyze', '.');
    addScanOptions(command);
    addReportOptions(command);
    addOutputOptions(command);
    addCompactOption(command);
    addFileReportOptions(command);
    command.addHelpText('after', EXAMPLES);
    command.action(async (directory: string, _options: unknown, cmd: Command) => {
        const cli = explicitOptions(cmd);
        applyLegacyLargeFiles(cli, (message) => ctx.warn(message));
        const target = ctx.resolvePath(directory);
        const { config } = await ctx.loadConfig(cli, target);
        const display = resolveDisplay(cli, config);
        const options = resolveAnalyzeOptions(cli, config);
        await checkOutputs(ctx, display);
        const result = await runAnalysis(ctx, target, options, display);
        await emit(ctx, result, display, listLimit(options.top));
        reportBudgets(ctx, result, display);
    });
}

export async function runAnalysis(
    ctx: Context,
    target: string,
    options: AnalyzeOptions,
    display: DisplaySettings
): Promise<AnalysisResult> {
    const progress = new ProgressLine(
        ctx.io.stderr,
        display.progress && ctx.io.stderr.isTTY === true,
        ctx.err,
        display.units
    );
    try {
        return await analyze(target, {
            ...options,
            signal: ctx.io.signal,
            ...(progress.enabled ? { onProgress: (p) => progress.analysis(p) } : {}),
        });
    } finally {
        progress.clear();
    }
}

/** The files a run writes, with the name each error message uses. */
function outputFiles(
    ctx: Context,
    display: DisplaySettings
): { html?: string; csv?: string; output?: string } {
    const today = new Date().toISOString().slice(0, 10);
    // HTML in a terminal is noise: write it to a file instead.
    const output =
        display.output ??
        (display.format === 'html' && ctx.io.stdout.isTTY
            ? `directory-analysis-${today}.html`
            : undefined);
    return {
        ...(display.html
            ? { html: display.html === true ? `directory-analysis-${today}.html` : display.html }
            : {}),
        ...(display.csv
            ? { csv: display.csv === true ? 'directory-analysis.csv' : display.csv }
            : {}),
        ...(output ? { output } : {}),
    };
}

/** Fails before the scan when a report file can't be written, instead of after it. */
export async function checkOutputs(ctx: Context, display: DisplaySettings): Promise<void> {
    const files = outputFiles(ctx, display);
    if (files.html) await ctx.checkOutput(files.html, 'the HTML report');
    if (files.csv) await ctx.checkOutput(files.csv, 'the CSV export');
    if (files.output) await ctx.checkOutput(files.output);
}

export async function emit(
    ctx: Context,
    result: AnalysisResult,
    display: DisplaySettings,
    limit: number
): Promise<void> {
    const files = outputFiles(ctx, display);
    if (files.html) {
        const file = await ctx.writeFile(
            files.html,
            renderAnalysisHtml(result, { units: display.units }),
            'the HTML report'
        );
        ctx.info(
            `${ctx.err.green('✔')} HTML report written to ${ctx.displayPath(file)}`,
            display.quiet
        );
    }
    if (files.csv) {
        const file = await ctx.writeFile(files.csv, renderAnalysisCsv(result), 'the CSV export');
        ctx.info(`${ctx.err.green('✔')} CSV written to ${ctx.displayPath(file)}`, display.quiet);
    }
    const output = files.output;

    const text = display.compact
        ? stringifyJson(compactAnalysis(result, { limit }))
        : renderAnalysisAs(display.format, result, {
              style: ctx.outputStyle(display.color, output !== undefined),
              units: display.units,
              width: terminalWidth(ctx.io),
              limit,
              types: display.types,
              extensions: display.extensions,
          });
    if (output) {
        const file = await ctx.writeFile(output, text);
        ctx.info(`${ctx.err.green('✔')} Report written to ${ctx.displayPath(file)}`, display.quiet);
    } else {
        await ctx.stdout(text.endsWith('\n') ? text : `${text}\n`);
    }
}

export function reportBudgets(
    ctx: Context,
    result: AnalysisResult,
    display: DisplaySettings
): void {
    const failed = result.budgets?.filter((b) => !b.passed) ?? [];
    if (failed.length === 0) return;
    ctx.exitCode = ExitCode.BudgetFailed;
    // Pretty output already shows budgets on the terminal; say it on stderr for every other case.
    if (display.format === 'pretty' && !display.output) return;
    for (const budget of failed) {
        const actual = formatBudgetActual(budget, display.units);
        ctx.io.stderr.write(`${ctx.err.red('budget failed')} ${budget.rule} (actual ${actual})\n`);
    }
}

/** Items printed per list: the --top value, or 10 when the top lists are turned off. */
export function listLimit(top: number | undefined): number {
    return top !== undefined && top > 0 ? top : 10;
}
