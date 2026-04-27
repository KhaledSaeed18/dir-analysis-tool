import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { analyze } from '../core/analyzer.js';
import { loadConfig, mergeConfig } from '../config.js';
import { printResult } from '../reporters/console.js';
import { writeCsvFiles } from '../reporters/csv.js';
import { generateHtmlReport } from '../reporters/html.js';
import { ProgressBar, ScanCounter } from '../progress.js';
import type { AnalysisOptions } from '../types.js';

export const analyzeCommand = new Command('analyze')
    .description('Analyze a directory (default command when no subcommand is given)')
    .argument('[directory]', 'Directory to analyze (defaults to current working directory)')
    .option('--no-recursive', 'Disable recursive analysis')
    .option('-j, --json', 'Output results as JSON (pipe-safe; suppresses progress bar)')
    .option('--tree', 'Display a directory tree view')
    .option('--no-types', 'Hide file type breakdown')
    .option('-e, --exclude <patterns...>', 'Exclude directory or file patterns')
    .option(
        '-l, --large-files [mb]',
        'Detect large files; optionally specify threshold in MB (default: 100)',
        false
    )
    .option('-d, --duplicates', 'Enable duplicate file detection (uses streaming MD5)')
    .option('--empty-files', 'Detect and show empty (zero-byte) files')
    .option('--top-n <n>', 'Show top N largest files', parseInt)
    .option('--max-depth <depth>', 'Maximum directory depth to scan', parseInt)
    .option('--min-size <bytes>', 'Filter: include only files at least this size', parseInt)
    .option('--max-size <bytes>', 'Filter: include only files at most this size', parseInt)
    .option('--date-from <date>', 'Filter: include only files modified after (YYYY-MM-DD)')
    .option('--date-to <date>', 'Filter: include only files modified before (YYYY-MM-DD)')
    .option('--csv [filename]', 'Export full analysis to CSV')
    .option('--csv-large [filename]', 'Export large-file list to CSV')
    .option('--csv-duplicates [filename]', 'Export duplicate groups to CSV')
    .option('--html [filename]', 'Generate HTML report with charts')
    .option('-c, --config [path]', 'Path to config file (auto-detected by default)')
    .action(async (directory, options) => {
        try {
            const targetPath = resolve(directory ?? process.cwd());

            const fileConfig = await loadConfig(
                typeof options.config === 'string' ? options.config : undefined
            );

            const cliConfig = {
                excludePatterns: options.exclude,
                largeSizeThresholdMB:
                    options.largeFiles === true
                        ? 100
                        : options.largeFiles
                          ? parseFloat(String(options.largeFiles))
                          : undefined,
                enableDuplicateDetection: options.duplicates || undefined,
                maxDepth: options.maxDepth,
                topN: options.topN,
                showEmptyFiles: options.emptyFiles || undefined,
            };

            const config = mergeConfig(fileConfig, cliConfig);

            const dateFrom = options.dateFrom ? new Date(options.dateFrom) : undefined;
            const dateTo = options.dateTo ? new Date(options.dateTo) : undefined;

            if (dateFrom && isNaN(dateFrom.getTime())) {
                throw new Error('Invalid --date-from format. Use YYYY-MM-DD.');
            }
            if (dateTo && isNaN(dateTo.getTime())) {
                throw new Error('Invalid --date-to format. Use YYYY-MM-DD.');
            }

            const isJson = !!options.json;
            const counter = new ScanCounter();
            const hashBar = new ProgressBar();

            if (!isJson) {
                counter.start(`Scanning ${targetPath}`);
            }

            const analysisOptions: AnalysisOptions = {
                path: targetPath,
                recursive: options.recursive !== false,
                excludePatterns: config.excludePatterns,
                clearDefaultExclusions: config.clearDefaultExclusions,
                largeSizeThresholdMB: config.largeSizeThresholdMB,
                enableDuplicateDetection: config.enableDuplicateDetection,
                maxDepth: config.maxDepth ?? (options.maxDepth as number | undefined),
                minSize: options.minSize as number | undefined,
                maxSize: options.maxSize as number | undefined,
                dateFrom,
                dateTo,
                topN: config.topN ?? (options.topN as number | undefined),
                showEmptyFiles: config.showEmptyFiles,
                onProgress: isJson ? undefined : (_n) => counter.increment(),
                onHashProgress: isJson
                    ? undefined
                    : ProgressBar.createHashCallback(hashBar),
            };

            const result = await analyze(analysisOptions);

            counter.stop();

            if (options.csv || options.csvLarge || options.csvDuplicates) {
                await writeCsvFiles(result, {
                    csv: options.csv,
                    csvLarge: options.csvLarge,
                    csvDuplicates: options.csvDuplicates,
                });
            }

            if (options.html) {
                const outFile = await generateHtmlReport(
                    result,
                    typeof options.html === 'string' ? options.html : undefined
                );
                if (!isJson) console.log(chalk.green(`📊 HTML report: ${outFile}`));
            }

            if (isJson) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                printResult(result, {
                    showTypes: options.types !== false,
                    treeView: !!options.tree,
                });
            }
        } catch (err) {
            console.error(chalk.red('Error:', err instanceof Error ? err.message : String(err)));
            process.exit(1);
        }
    });
