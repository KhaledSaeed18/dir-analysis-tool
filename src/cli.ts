import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { DirectoryAnalyzer, AnalysisOptions } from './analyzer';
import { formatSize, EMOJIS } from './utils';
import { ConfigManager } from './config';
import { ProgressBar } from './progress';
import { CSVExporter, ExtendedAnalysisResult } from './export';
import { InteractiveMode } from './interactive';
import { HTMLReportGenerator } from './html-report';
import chokidar from 'chokidar';

const program = new Command();

program
    .name('dir-analysis-tool')
    .description('Analyze directory contents and classify files by type with advanced features')
    .version('1.0.2');

program
    .option('-p, --path <path>', 'Target directory to analyze', '.')
    .option('-r, --recursive', 'Recursively analyze nested directories', true)
    .option('--no-recursive', 'Disable recursive analysis')
    .option('-j, --json', 'Output results in JSON format')
    .option('-t, --types', 'Show file type classification summary', true)
    .option('--no-types', 'Hide file type classification')
    .option('-e, --exclude <patterns...>', 'Exclude file patterns or directories')
    .option('-l, --large-files [threshold]', 'Detect large files (default: 100MB)', '104857600')
    .option('-d, --duplicates', 'Enable duplicate file detection')
    .option('--csv [filename]', 'Export results to CSV file')
    .option('--csv-large [filename]', 'Export large files to CSV')
    .option('--csv-duplicates [filename]', 'Export duplicates to CSV')
    .option('--progress', 'Show progress bar during analysis', true)
    .option('--no-progress', 'Disable progress bar')
    .option('--max-depth <depth>', 'Maximum directory depth to scan', parseInt)
    .option('-c, --config [path]', 'Load configuration from file')
    .option('--min-size <size>', 'Filter files by minimum size (bytes)', parseInt)
    .option('--max-size <size>', 'Filter files by maximum size (bytes)', parseInt)
    .option('--date-from <date>', 'Filter files modified after this date (YYYY-MM-DD)')
    .option('--date-to <date>', 'Filter files modified before this date (YYYY-MM-DD)')
    .option('--tree', 'Display results in tree view format')
    .option('--top-n <number>', 'Show top N largest files (default: 10)', parseInt)
    .option('--empty-files', 'Detect and show empty files')
    .option('-i, --interactive', 'Start interactive mode')
    .option('-w, --watch', 'Watch mode - monitor directory changes')
    .option('--html [filename]', 'Generate HTML report with charts').argument('[directory]', 'Directory to analyze (alternative to --path)')
    .action(async (directory, options) => {
        try {
            // Handle interactive mode
            if (options.interactive) {
                const interactive = new InteractiveMode();
                await interactive.start();
                return;
            }

            // Handle watch mode
            if (options.watch) {
                await startWatchMode(options);
                return;
            }

            // Determine target path - use directory argument if provided, otherwise use --path option
            const targetPath = directory || options.path || '.';

            // Load configuration
            const configManager = new ConfigManager();
            let config = await configManager.loadConfig(options.config || process.cwd());
            config = configManager.mergeWithCliOptions(options);

            // Parse large file threshold
            const largeSizeThreshold = options.largeFiles
                ? (typeof options.largeFiles === 'string' ? parseInt(options.largeFiles) : 104857600)
                : undefined;

            // Parse date filters
            const dateFrom = options.dateFrom ? new Date(options.dateFrom) : undefined;
            const dateTo = options.dateTo ? new Date(options.dateTo) : undefined;

            // Validate dates
            if (dateFrom && isNaN(dateFrom.getTime())) {
                throw new Error('Invalid date-from format. Use YYYY-MM-DD');
            }
            if (dateTo && isNaN(dateTo.getTime())) {
                throw new Error('Invalid date-to format. Use YYYY-MM-DD');
            }

            // Setup progress callback
            const progressCallback = options.progress
                ? ProgressBar.createCallback(true)
                : undefined; const analyzer = new DirectoryAnalyzer();

            const analysisOptions: AnalysisOptions = {
                path: targetPath,
                recursive: options.recursive,
                excludePatterns: options.exclude || config.excludePatterns || [],
                largeSizeThreshold: largeSizeThreshold || config.largeSizeThreshold,
                enableDuplicateDetection: options.duplicates || config.enableDuplicateDetection || false,
                progressCallback,
                maxDepth: options.maxDepth || config.maxDepth || -1,
                // Phase 1 new options
                minSize: options.minSize || config.minSize,
                maxSize: options.maxSize || config.maxSize,
                dateFrom: dateFrom || config.dateFrom,
                dateTo: dateTo || config.dateTo,
                topN: options.topN || config.topN || 10,
                showEmptyFiles: options.emptyFiles || config.showEmptyFiles || false
            };

            if (progressCallback) {
                console.log(chalk.blue('🔍 Starting directory analysis...'));
            }

            const result = await analyzer.analyze(analysisOptions);

            if (progressCallback) {
                console.log(chalk.green('✅ Analysis complete!\n'));
            }            // Handle CSV exports
            if (options.csv || options.csvLarge || options.csvDuplicates) {
                await handleCsvExports(result, options);
            }

            // Handle HTML report
            if (options.html) {
                await handleHtmlReport(result, options);
            }// Display results
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else if (options.tree) {
                printTreeView(result);
            } else {
                printFormattedOutput(result, options.types);
            }
        } catch (error) {
            console.error(chalk.red('Error:', error instanceof Error ? error.message : String(error)));
            process.exit(1);
        }
    });

async function handleCsvExports(result: ExtendedAnalysisResult, options: any): Promise<void> {
    // Export general CSV
    if (options.csv) {
        const filename = typeof options.csv === 'string' ? options.csv : 'directory-analysis.csv';
        const csvContent = CSVExporter.exportAnalysis(result);
        await fs.promises.writeFile(filename, csvContent);
        console.log(chalk.green(`📄 Analysis exported to: ${filename}`));
    }

    // Export large files CSV
    if (options.csvLarge && result.largeFiles && result.largeFiles.length > 0) {
        const filename = typeof options.csvLarge === 'string' ? options.csvLarge : 'large-files.csv';
        const csvContent = CSVExporter.exportLargeFiles(result.largeFiles);
        await fs.promises.writeFile(filename, csvContent);
        console.log(chalk.green(`📄 Large files exported to: ${filename}`));
    }

    // Export duplicates CSV
    if (options.csvDuplicates && result.duplicateGroups && result.duplicateGroups.length > 0) {
        const filename = typeof options.csvDuplicates === 'string' ? options.csvDuplicates : 'duplicates.csv';
        const csvContent = CSVExporter.exportDuplicates(result.duplicateGroups);
        await fs.promises.writeFile(filename, csvContent);
        console.log(chalk.green(`📄 Duplicates exported to: ${filename}`));
    }
}

async function handleHtmlReport(result: ExtendedAnalysisResult, options: any): Promise<void> {
    try {
        const filename = typeof options.html === 'string' ? options.html : undefined;
        const outputFile = await HTMLReportGenerator.generateReport(result, filename);
        console.log(chalk.green(`📊 HTML report generated: ${outputFile}`));
    } catch (error) {
        console.error(chalk.red('HTML report generation failed:'), error instanceof Error ? error.message : String(error));
    }
}

function printFormattedOutput(result: ExtendedAnalysisResult, showTypes: boolean): void {
    console.log(chalk.blue(`${EMOJIS.folder} Directory: ${result.path}`));
    console.log(chalk.green(`${EMOJIS.package} Total Size: ${formatSize(result.totalSizeBytes)}`));
    console.log(chalk.yellow(`${EMOJIS.folderIcon} Folders: ${result.folders}`));
    console.log(chalk.cyan(`${EMOJIS.fileIcon} Files: ${result.files}`));

    if (showTypes) {
        console.log(chalk.magenta(`\n${EMOJIS.types} File Types:`));

        const typeEntries = [
            { key: 'images', emoji: EMOJIS.images, label: 'Images' },
            { key: 'videos', emoji: EMOJIS.videos, label: 'Videos' },
            { key: 'documents', emoji: EMOJIS.documents, label: 'Documents' },
            { key: 'audio', emoji: EMOJIS.audio, label: 'Audio' },
            { key: 'code', emoji: EMOJIS.code, label: 'Code' },
            { key: 'archives', emoji: EMOJIS.archives, label: 'Archives' },
            { key: 'other', emoji: EMOJIS.other, label: 'Other' }
        ]; typeEntries.forEach(({ key, emoji, label }) => {
            const count = (result.types as any)[key];
            if (count > 0) {
                console.log(`  ${emoji} ${label}: ${count}`);
            }
        });
    }

    // Display large files if found
    if (result.largeFiles && result.largeFiles.length > 0) {
        console.log(chalk.red(`\n🚨 Large Files (Top ${Math.min(5, result.largeFiles.length)}):`));
        result.largeFiles.slice(0, 5).forEach(file => {
            const relativePath = path.relative(result.path, file.path);
            console.log(`  📁 ${relativePath} - ${chalk.yellow(file.sizeFormatted)}`);
        });

        if (result.largeFiles.length > 5) {
            console.log(chalk.gray(`  ... and ${result.largeFiles.length - 5} more large files`));
        }
    }

    // Display duplicate statistics if found
    if (result.duplicateStats && result.duplicateStats.totalGroups > 0) {
        console.log(chalk.yellow(`\n🔄 Duplicate Files:`));
        console.log(`  📊 Groups: ${result.duplicateStats.totalGroups}`);
        console.log(`  💾 Wasted Space: ${chalk.red(result.duplicateStats.totalWastedSpaceFormatted)}`);

        if (result.duplicateGroups && result.duplicateGroups.length > 0) {
            console.log(chalk.gray(`\n  Top duplicate groups:`));
            result.duplicateGroups.slice(0, 3).forEach((group, index) => {
                console.log(`  ${index + 1}. ${group.sizeFormatted} each × ${group.files.length} files`);
                group.files.slice(0, 2).forEach(file => {
                    const relativePath = path.relative(result.path, file);
                    console.log(`     📄 ${relativePath}`);
                });
                if (group.files.length > 2) {
                    console.log(chalk.gray(`     ... and ${group.files.length - 2} more`));
                }
            });
        }
    }

    // Show top largest files if available
    if (result.topLargestFiles && result.topLargestFiles.length > 0) {
        printTopLargestFiles(result);
    }

    // Show empty files if detected
    if (result.emptyFiles && result.emptyFiles.length > 0) {
        printEmptyFiles(result);
    }
}

function printTreeView(result: ExtendedAnalysisResult): void {
    console.log(chalk.blue(`${EMOJIS.folder} Directory Tree: ${result.path}`));
    console.log(chalk.green(`${EMOJIS.package} Total Size: ${formatSize(result.totalSizeBytes)}`));
    console.log(chalk.yellow(`${EMOJIS.folderIcon} Folders: ${result.folders}`));
    console.log(chalk.cyan(`${EMOJIS.fileIcon} Files: ${result.files}\n`));

    if (result.treeView) {
        console.log(result.treeView);
    } else {
        console.log(chalk.yellow('Tree view not available for large datasets (>1000 files)'));
        console.log('Use --top-n option to see largest files instead.\n');
    }

    // Show top largest files if available
    if (result.topLargestFiles && result.topLargestFiles.length > 0) {
        printTopLargestFiles(result);
    }

    // Show empty files if detected
    if (result.emptyFiles && result.emptyFiles.length > 0) {
        printEmptyFiles(result);
    }
}

function printTopLargestFiles(result: ExtendedAnalysisResult): void {
    if (!result.topLargestFiles || result.topLargestFiles.length === 0) return;

    console.log(chalk.red(`\n${EMOJIS.largeFile} Top ${result.topLargestFiles.length} Largest Files:`));
    result.topLargestFiles.forEach((file, index) => {
        const relativePath = path.relative(result.path, file.path);
        const ranking = chalk.gray(`${index + 1}.`);
        console.log(`  ${ranking} ${relativePath} - ${chalk.yellow(file.sizeFormatted)}`);
    });
}

function printEmptyFiles(result: ExtendedAnalysisResult): void {
    if (!result.emptyFiles || result.emptyFiles.length === 0) return;

    console.log(chalk.yellow(`\n📭 Empty Files (${result.emptyFiles.length}):`));
    const displayCount = Math.min(10, result.emptyFiles.length);

    result.emptyFiles.slice(0, displayCount).forEach(file => {
        const relativePath = path.relative(result.path, file.path);
        const date = file.modifiedDate.toLocaleDateString();
        console.log(`  📄 ${relativePath} ${chalk.gray(`(modified: ${date})`)}`);
    });

    if (result.emptyFiles.length > displayCount) {
        console.log(chalk.gray(`  ... and ${result.emptyFiles.length - displayCount} more empty files`));
    }
}

// Watch mode functionality
async function startWatchMode(options: any): Promise<void> {
    const watchPath = options.path || '.';
    console.log(chalk.blue(`👀 Starting watch mode for: ${path.resolve(watchPath)}`));
    console.log(chalk.gray('Press Ctrl+C to stop watching...\n'));

    const analyzer = new DirectoryAnalyzer();
    let lastAnalysis: ExtendedAnalysisResult | null = null;
    let analysisTimeout: NodeJS.Timeout | null = null;

    // Perform initial analysis
    await performAnalysis();

    // Set up file watcher
    const watcher = chokidar.watch(watchPath, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        depth: options.maxDepth || undefined
    });

    watcher
        .on('add', (filePath) => {
            console.log(chalk.green(`📄 File added: ${path.relative(watchPath, filePath)}`));
            scheduleAnalysis();
        })
        .on('change', (filePath) => {
            console.log(chalk.yellow(`📝 File changed: ${path.relative(watchPath, filePath)}`));
            scheduleAnalysis();
        })
        .on('unlink', (filePath) => {
            console.log(chalk.red(`🗑️ File removed: ${path.relative(watchPath, filePath)}`));
            scheduleAnalysis();
        })
        .on('addDir', (dirPath) => {
            console.log(chalk.blue(`📁 Directory added: ${path.relative(watchPath, dirPath)}`));
            scheduleAnalysis();
        })
        .on('unlinkDir', (dirPath) => {
            console.log(chalk.red(`📁❌ Directory removed: ${path.relative(watchPath, dirPath)}`));
            scheduleAnalysis();
        });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log(chalk.blue('\n👋 Stopping watch mode...'));
        watcher.close();
        process.exit(0);
    });

    async function performAnalysis(): Promise<void> {
        try {
            const analysisOptions: AnalysisOptions = {
                path: watchPath,
                recursive: options.recursive !== false,
                excludePatterns: options.exclude || [],
                largeSizeThreshold: options.largeFiles ?
                    (typeof options.largeFiles === 'string' ? parseInt(options.largeFiles) : 104857600) : undefined,
                enableDuplicateDetection: options.duplicates || false,
                maxDepth: options.maxDepth || -1,
                topN: options.topN || 10,
                showEmptyFiles: options.emptyFiles || false
            };

            const result = await analyzer.analyze(analysisOptions);
            displayWatchResults(result, lastAnalysis);
            lastAnalysis = result;
        } catch (error) {
            console.error(chalk.red('Analysis error:'), error instanceof Error ? error.message : String(error));
        }
    }

    function scheduleAnalysis(): void {
        if (analysisTimeout) {
            clearTimeout(analysisTimeout);
        }

        // Debounce analysis to avoid too frequent updates
        analysisTimeout = setTimeout(() => {
            console.log(chalk.gray('🔄 Updating analysis...\n'));
            performAnalysis();
        }, 2000); // Wait 2 seconds after last change
    }
}

function displayWatchResults(current: ExtendedAnalysisResult, previous: ExtendedAnalysisResult | null): void {
    console.log(chalk.cyan('\n📊 Current Status:'));
    console.log(`  📦 Total Size: ${formatSize(current.totalSizeBytes)}`);
    console.log(`  📁 Folders: ${current.folders}`);
    console.log(`  📄 Files: ${current.files}`);

    if (previous) {
        console.log(chalk.yellow('\n📈 Changes since last scan:'));
        const sizeDiff = current.totalSizeBytes - previous.totalSizeBytes;
        const filesDiff = current.files - previous.files;
        const foldersDiff = current.folders - previous.folders;

        if (sizeDiff !== 0) {
            const color = sizeDiff > 0 ? chalk.green : chalk.red;
            const symbol = sizeDiff > 0 ? '+' : '';
            console.log(`  📦 Size: ${color(`${symbol}${formatSize(Math.abs(sizeDiff))}`)}`);
        }

        if (filesDiff !== 0) {
            const color = filesDiff > 0 ? chalk.green : chalk.red;
            const symbol = filesDiff > 0 ? '+' : '';
            console.log(`  📄 Files: ${color(`${symbol}${filesDiff}`)}`);
        }

        if (foldersDiff !== 0) {
            const color = foldersDiff > 0 ? chalk.green : chalk.red;
            const symbol = foldersDiff > 0 ? '+' : '';
            console.log(`  📁 Folders: ${color(`${symbol}${foldersDiff}`)}`);
        }

        if (sizeDiff === 0 && filesDiff === 0 && foldersDiff === 0) {
            console.log(`  ${chalk.gray('No changes detected')}`);
        }
    }

    console.log(chalk.gray(`\n⏰ Last updated: ${new Date().toLocaleTimeString()}`));
    console.log(chalk.gray('═'.repeat(50)));
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Parse command line arguments
program.parse();
