import { Command } from 'commander';
import { resolve, relative } from 'node:path';
import chalk from 'chalk';
import prettyBytes from 'pretty-bytes';
import { watch as chokidarWatch } from 'chokidar';
import { analyze } from '../core/analyzer.js';
import type { AnalysisResult } from '../types.js';

export const watchCommand = new Command('watch')
    .description('Watch a directory for changes and re-analyze automatically')
    .argument('[directory]', 'Directory to watch (defaults to current working directory)')
    .option('--no-recursive', 'Disable recursive watching')
    .option('-e, --exclude <patterns...>', 'Exclude patterns')
    .option('--max-depth <depth>', 'Maximum depth to watch', parseInt)
    .option('-l, --large-files [mb]', 'Detect large files (threshold in MB, default: 100)', false)
    .option('-d, --duplicates', 'Enable duplicate detection on each re-analysis')
    .option('--top-n <n>', 'Top N largest files', parseInt)
    .action(async (directory, options) => {
        const targetPath = resolve(directory ?? process.cwd());

        console.log(chalk.blue(`👀 Watching: ${targetPath}`));
        console.log(chalk.gray('Press Ctrl+C to stop.\n'));

        let lastResult: AnalysisResult | null = null;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        async function runAnalysis(): Promise<void> {
            try {
                const result = await analyze({
                    path: targetPath,
                    recursive: options.recursive !== false,
                    excludePatterns: options.exclude ?? [],
                    largeSizeThresholdMB:
                        options.largeFiles === true
                            ? 100
                            : options.largeFiles
                              ? parseFloat(String(options.largeFiles))
                              : undefined,
                    enableDuplicateDetection: !!options.duplicates,
                    maxDepth: options.maxDepth as number | undefined,
                    topN: options.topN as number | undefined,
                });

                displayStatus(result, lastResult);
                lastResult = result;
            } catch (err) {
                console.error(chalk.red('Analysis error:', err instanceof Error ? err.message : String(err)));
            }
        }

        function scheduleAnalysis(): void {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                console.log(chalk.gray('🔄 Re-analyzing...\n'));
                runAnalysis();
            }, 2000);
        }

        await runAnalysis();

        const watcher = chokidarWatch(targetPath, {
            ignored: /(^|[/\\])\../,
            persistent: true,
            ignoreInitial: true,
            depth: options.maxDepth as number | undefined,
        });

        watcher
            .on('add', (p) => {
                console.log(chalk.green(`📄 Added: ${relative(targetPath, p)}`));
                scheduleAnalysis();
            })
            .on('change', (p) => {
                console.log(chalk.yellow(`📝 Changed: ${relative(targetPath, p)}`));
                scheduleAnalysis();
            })
            .on('unlink', (p) => {
                console.log(chalk.red(`🗑️ Removed: ${relative(targetPath, p)}`));
                scheduleAnalysis();
            })
            .on('addDir', (p) => {
                console.log(chalk.blue(`📁 Dir added: ${relative(targetPath, p)}`));
                scheduleAnalysis();
            })
            .on('unlinkDir', (p) => {
                console.log(chalk.red(`📁❌ Dir removed: ${relative(targetPath, p)}`));
                scheduleAnalysis();
            });

        process.on('SIGINT', () => {
            console.log(chalk.blue('\n👋 Stopping watcher…'));
            watcher.close();
            process.exit(0);
        });
    });

function displayStatus(current: AnalysisResult, previous: AnalysisResult | null): void {
    console.log(chalk.cyan('\n📊 Status:'));
    console.log(`  📦 Size:    ${current.totalSizeFormatted}`);
    console.log(`  📁 Folders: ${current.folders.toLocaleString()}`);
    console.log(`  📄 Files:   ${current.files.toLocaleString()}`);

    if (previous) {
        const sizeDiff = current.totalSizeBytes - previous.totalSizeBytes;
        const fileDiff = current.files - previous.files;
        const folderDiff = current.folders - previous.folders;

        if (sizeDiff !== 0 || fileDiff !== 0 || folderDiff !== 0) {
            console.log(chalk.yellow('\n📈 Changes:'));
            if (sizeDiff !== 0) {
                const sign = sizeDiff > 0 ? '+' : '';
                const color = sizeDiff > 0 ? chalk.green : chalk.red;
                console.log(`  Size: ${color(`${sign}${prettyBytes(Math.abs(sizeDiff))}`)}`);
            }
            if (fileDiff !== 0) {
                const color = fileDiff > 0 ? chalk.green : chalk.red;
                console.log(`  Files: ${color(`${fileDiff > 0 ? '+' : ''}${fileDiff}`)}`);
            }
            if (folderDiff !== 0) {
                const color = folderDiff > 0 ? chalk.green : chalk.red;
                console.log(`  Folders: ${color(`${folderDiff > 0 ? '+' : ''}${folderDiff}`)}`);
            }
        } else {
            console.log(chalk.gray('  No changes.'));
        }
    }

    console.log(chalk.gray(`\n⏰ ${new Date().toLocaleTimeString()}`));
    console.log(chalk.gray('─'.repeat(50)));
}
