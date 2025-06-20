import inquirer from 'inquirer';
import chalk from 'chalk';
import { DirectoryAnalyzer, AnalysisOptions } from './analyzer';
import { ExtendedAnalysisResult } from './export';
import { ProgressBar } from './progress';
import { CSVExporter } from './export';
import { formatSize, EMOJIS } from './utils';
import { promises as fs } from 'fs';
import * as path from 'path';

export class InteractiveMode {
    private analyzer: DirectoryAnalyzer;
    private currentResult: ExtendedAnalysisResult | null = null;
    private currentPath: string = process.cwd();

    constructor() {
        this.analyzer = new DirectoryAnalyzer();
    }

    async start(): Promise<void> {
        console.log(chalk.blue.bold('\n🚀 Welcome to Interactive Directory Analyzer!'));
        console.log(chalk.gray('Explore directories interactively with advanced analysis features.\n'));

        while (true) {
            const action = await this.showMainMenu();

            try {
                switch (action) {
                    case 'analyze':
                        await this.analyzeDirectory();
                        break;
                    case 'change_path':
                        await this.changePath();
                        break;
                    case 'view_results':
                        await this.viewResults();
                        break;
                    case 'export':
                        await this.exportResults();
                        break;
                    case 'advanced':
                        await this.advancedOptions();
                        break;
                    case 'exit':
                        console.log(chalk.green('\n👋 Goodbye!'));
                        return;
                }
            } catch (error) {
                console.error(chalk.red('\n❌ Error:'), error instanceof Error ? error.message : String(error));
                console.log(chalk.gray('Press any key to continue...'));
                await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
            }
        }
    }

    private async showMainMenu(): Promise<string> {
        console.log(chalk.cyan(`\n📂 Current Path: ${this.currentPath}`));
        if (this.currentResult) {
            console.log(chalk.green(`📊 Last Analysis: ${this.currentResult.files} files, ${formatSize(this.currentResult.totalSizeBytes)}`));
        }

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do?',
                choices: [
                    { name: '🔍 Analyze Current Directory', value: 'analyze' },
                    { name: '📁 Change Directory', value: 'change_path' },
                    ...(this.currentResult ? [{ name: '📊 View Results', value: 'view_results' }] : []),
                    ...(this.currentResult ? [{ name: '💾 Export Results', value: 'export' }] : []),
                    { name: '⚙️ Advanced Options', value: 'advanced' },
                    { name: '🚪 Exit', value: 'exit' }
                ]
            }
        ]);

        return action;
    }

    private async analyzeDirectory(): Promise<void> {
        const options = await this.getAnalysisOptions();

        console.log(chalk.blue('\n🔍 Starting analysis...'));
        const progressCallback = ProgressBar.createCallback(true); this.currentResult = await this.analyzer.analyze({
            path: this.currentPath,
            recursive: options.recursive ?? true,
            excludePatterns: options.excludePatterns ?? [],
            largeSizeThreshold: options.largeSizeThreshold,
            enableDuplicateDetection: options.enableDuplicateDetection ?? false,
            progressCallback,
            maxDepth: options.maxDepth ?? -1,
            minSize: options.minSize,
            maxSize: options.maxSize,
            dateFrom: options.dateFrom,
            dateTo: options.dateTo,
            topN: options.topN,
            showEmptyFiles: options.showEmptyFiles ?? false
        });

        console.log(chalk.green('✅ Analysis complete!\n'));
        await this.displayBasicResults();
    }

    private async getAnalysisOptions(): Promise<Partial<AnalysisOptions>> {
        const { features } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'features',
                message: 'Select analysis features:',
                choices: [
                    { name: '🔄 Recursive scan', value: 'recursive', checked: true },
                    { name: '📊 File type classification', value: 'types', checked: true },
                    { name: '🚨 Large file detection', value: 'large_files' },
                    { name: '🔄 Duplicate detection', value: 'duplicates' },
                    { name: '📭 Empty file detection', value: 'empty_files' },
                    { name: '🌳 Tree view generation', value: 'tree_view' },
                    { name: '📈 Top largest files', value: 'top_files' }
                ]
            }
        ]);

        const options: Partial<AnalysisOptions> = {
            recursive: features.includes('recursive'),
            excludePatterns: []
        };

        if (features.includes('large_files')) {
            const { threshold } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'threshold',
                    message: 'Large file threshold (MB):',
                    default: '100',
                    validate: (input) => {
                        const num = parseFloat(input);
                        return num > 0 ? true : 'Please enter a positive number';
                    }
                }
            ]);
            options.largeSizeThreshold = parseFloat(threshold) * 1024 * 1024;
        }

        if (features.includes('duplicates')) {
            options.enableDuplicateDetection = true;
        }

        if (features.includes('empty_files')) {
            options.showEmptyFiles = true;
        }

        if (features.includes('top_files')) {
            const { topN } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'topN',
                    message: 'Number of top largest files to show:',
                    default: '10',
                    validate: (input) => {
                        const num = parseInt(input);
                        return num > 0 ? true : 'Please enter a positive number';
                    }
                }
            ]);
            options.topN = parseInt(topN);
        }

        const { useFilters } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'useFilters',
                message: 'Apply file filters (size, date)?',
                default: false
            }
        ]);

        if (useFilters) {
            const filters = await this.getFileFilters();
            Object.assign(options, filters);
        }

        return options;
    }

    private async getFileFilters(): Promise<Partial<AnalysisOptions>> {
        const { filterType } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'filterType',
                message: 'Select filters:',
                choices: [
                    { name: '📏 Size filters', value: 'size' },
                    { name: '📅 Date filters', value: 'date' }
                ]
            }
        ]);

        const filters: Partial<AnalysisOptions> = {};

        if (filterType.includes('size')) {
            const { minSize, maxSize } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'minSize',
                    message: 'Minimum file size (bytes, leave empty for no limit):',
                    validate: (input) => {
                        if (!input) return true;
                        const num = parseInt(input);
                        return num >= 0 ? true : 'Please enter a non-negative number';
                    }
                },
                {
                    type: 'input',
                    name: 'maxSize',
                    message: 'Maximum file size (bytes, leave empty for no limit):',
                    validate: (input) => {
                        if (!input) return true;
                        const num = parseInt(input);
                        return num >= 0 ? true : 'Please enter a non-negative number';
                    }
                }
            ]);

            if (minSize) filters.minSize = parseInt(minSize);
            if (maxSize) filters.maxSize = parseInt(maxSize);
        }

        if (filterType.includes('date')) {
            const { dateFrom, dateTo } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'dateFrom',
                    message: 'Files modified after (YYYY-MM-DD, leave empty for no limit):',
                    validate: (input) => {
                        if (!input) return true;
                        const date = new Date(input);
                        return !isNaN(date.getTime()) ? true : 'Please enter a valid date (YYYY-MM-DD)';
                    }
                },
                {
                    type: 'input',
                    name: 'dateTo',
                    message: 'Files modified before (YYYY-MM-DD, leave empty for no limit):',
                    validate: (input) => {
                        if (!input) return true;
                        const date = new Date(input);
                        return !isNaN(date.getTime()) ? true : 'Please enter a valid date (YYYY-MM-DD)';
                    }
                }
            ]);

            if (dateFrom) filters.dateFrom = new Date(dateFrom);
            if (dateTo) filters.dateTo = new Date(dateTo);
        }

        return filters;
    }

    private async changePath(): Promise<void> {
        const { newPath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'newPath',
                message: 'Enter new directory path:',
                default: this.currentPath,
                validate: async (input) => {
                    try {
                        const stats = await fs.stat(input);
                        return stats.isDirectory() ? true : 'Path is not a directory';
                    } catch {
                        return 'Path does not exist';
                    }
                }
            }
        ]);

        this.currentPath = path.resolve(newPath);
        this.currentResult = null; 
        console.log(chalk.green(`📂 Changed to: ${this.currentPath}`));
    }

    private async displayBasicResults(): Promise<void> {
        if (!this.currentResult) return;

        const result = this.currentResult;
        console.log(chalk.blue(`${EMOJIS.folder} Directory: ${result.path}`));
        console.log(chalk.green(`${EMOJIS.package} Total Size: ${formatSize(result.totalSizeBytes)}`));
        console.log(chalk.yellow(`${EMOJIS.folderIcon} Folders: ${result.folders}`));
        console.log(chalk.cyan(`${EMOJIS.fileIcon} Files: ${result.files}`));

        console.log(chalk.magenta(`\n${EMOJIS.types} File Types:`));
        const typeEntries = [
            { key: 'code', emoji: EMOJIS.code, label: 'Code' },
            { key: 'images', emoji: EMOJIS.images, label: 'Images' },
            { key: 'documents', emoji: EMOJIS.documents, label: 'Documents' },
            { key: 'videos', emoji: EMOJIS.videos, label: 'Videos' },
            { key: 'audio', emoji: EMOJIS.audio, label: 'Audio' },
            { key: 'archives', emoji: EMOJIS.archives, label: 'Archives' },
            { key: 'other', emoji: EMOJIS.other, label: 'Other' }
        ];

        typeEntries.forEach(({ key, emoji, label }) => {
            const count = (result.types as any)[key];
            if (count > 0) {
                console.log(`  ${emoji} ${label}: ${count}`);
            }
        });
    }

    private async viewResults(): Promise<void> {
        if (!this.currentResult) {
            console.log(chalk.yellow('No results available. Run an analysis first.'));
            return;
        }

        const { viewType } = await inquirer.prompt([
            {
                type: 'list',
                name: 'viewType',
                message: 'How would you like to view the results?',
                choices: [
                    { name: '📊 Summary', value: 'summary' },
                    { name: '🌳 Tree View', value: 'tree' },
                    { name: '🚨 Large Files', value: 'large_files' },
                    { name: '🔄 Duplicates', value: 'duplicates' },
                    { name: '📭 Empty Files', value: 'empty_files' },
                    { name: '📈 Top Largest Files', value: 'top_files' },
                    { name: '📋 Full JSON', value: 'json' }
                ]
            }
        ]);

        switch (viewType) {
            case 'summary':
                await this.displayBasicResults();
                break;
            case 'tree':
                this.displayTreeView();
                break;
            case 'large_files':
                this.displayLargeFiles();
                break;
            case 'duplicates':
                this.displayDuplicates();
                break;
            case 'empty_files':
                this.displayEmptyFiles();
                break;
            case 'top_files':
                this.displayTopFiles();
                break;
            case 'json':
                console.log(JSON.stringify(this.currentResult, null, 2));
                break;
        }

        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }

    private displayTreeView(): void {
        if (!this.currentResult?.treeView) {
            console.log(chalk.yellow('Tree view not available (dataset too large or not generated)'));
            return;
        }
        console.log(chalk.blue('\n🌳 Directory Tree:'));
        console.log(this.currentResult.treeView);
    }

    private displayLargeFiles(): void {
        if (!this.currentResult?.largeFiles || this.currentResult.largeFiles.length === 0) {
            console.log(chalk.yellow('No large files found'));
            return;
        }

        console.log(chalk.red(`\n🚨 Large Files (${this.currentResult.largeFiles.length}):`));
        this.currentResult.largeFiles.forEach((file, index) => {
            const relativePath = path.relative(this.currentResult!.path, file.path);
            console.log(`  ${index + 1}. ${relativePath} - ${chalk.yellow(file.sizeFormatted)}`);
        });
    }

    private displayDuplicates(): void {
        if (!this.currentResult?.duplicateGroups || this.currentResult.duplicateGroups.length === 0) {
            console.log(chalk.yellow('No duplicate files found'));
            return;
        }

        console.log(chalk.yellow(`\n🔄 Duplicate Files (${this.currentResult.duplicateGroups.length} groups):`));
        if (this.currentResult.duplicateStats) {
            console.log(`💾 Total wasted space: ${chalk.red(this.currentResult.duplicateStats.totalWastedSpaceFormatted)}`);
        }

        this.currentResult.duplicateGroups.slice(0, 5).forEach((group, index) => {
            console.log(`\n  Group ${index + 1}: ${group.sizeFormatted} each × ${group.files.length} files`);
            group.files.slice(0, 3).forEach(file => {
                const relativePath = path.relative(this.currentResult!.path, file);
                console.log(`    📄 ${relativePath}`);
            });
            if (group.files.length > 3) {
                console.log(chalk.gray(`    ... and ${group.files.length - 3} more`));
            }
        });
    }

    private displayEmptyFiles(): void {
        if (!this.currentResult?.emptyFiles || this.currentResult.emptyFiles.length === 0) {
            console.log(chalk.yellow('No empty files found'));
            return;
        }

        console.log(chalk.yellow(`\n📭 Empty Files (${this.currentResult.emptyFiles.length}):`));
        const displayCount = Math.min(10, this.currentResult.emptyFiles.length);

        this.currentResult.emptyFiles.slice(0, displayCount).forEach(file => {
            const relativePath = path.relative(this.currentResult!.path, file.path);
            const date = file.modifiedDate.toLocaleDateString();
            console.log(`  📄 ${relativePath} ${chalk.gray(`(modified: ${date})`)}`);
        });

        if (this.currentResult.emptyFiles.length > displayCount) {
            console.log(chalk.gray(`  ... and ${this.currentResult.emptyFiles.length - displayCount} more`));
        }
    }

    private displayTopFiles(): void {
        if (!this.currentResult?.topLargestFiles || this.currentResult.topLargestFiles.length === 0) {
            console.log(chalk.yellow('No top files data available'));
            return;
        }

        console.log(chalk.red(`\n📈 Top ${this.currentResult.topLargestFiles.length} Largest Files:`));
        this.currentResult.topLargestFiles.forEach((file, index) => {
            const relativePath = path.relative(this.currentResult!.path, file.path);
            console.log(`  ${index + 1}. ${relativePath} - ${chalk.yellow(file.sizeFormatted)}`);
        });
    }

    private async exportResults(): Promise<void> {
        if (!this.currentResult) {
            console.log(chalk.yellow('No results available. Run an analysis first.'));
            return;
        }

        const { exportType } = await inquirer.prompt([
            {
                type: 'list',
                name: 'exportType',
                message: 'Select export format:',
                choices: [
                    { name: '📄 CSV - General analysis', value: 'csv' },
                    { name: '📄 CSV - Large files only', value: 'csv_large' },
                    { name: '📄 CSV - Duplicates only', value: 'csv_duplicates' },
                    { name: '📋 JSON - Full results', value: 'json' }
                ]
            }
        ]);

        const { filename } = await inquirer.prompt([
            {
                type: 'input',
                name: 'filename',
                message: 'Output filename:',
                default: this.getDefaultFilename(exportType),
                validate: (input) => input.trim() ? true : 'Please enter a filename'
            }
        ]);

        try {
            let content: string;
            switch (exportType) {
                case 'csv':
                    content = CSVExporter.exportAnalysis(this.currentResult);
                    break;
                case 'csv_large':
                    if (!this.currentResult.largeFiles || this.currentResult.largeFiles.length === 0) {
                        console.log(chalk.yellow('No large files to export'));
                        return;
                    }
                    content = CSVExporter.exportLargeFiles(this.currentResult.largeFiles);
                    break;
                case 'csv_duplicates':
                    if (!this.currentResult.duplicateGroups || this.currentResult.duplicateGroups.length === 0) {
                        console.log(chalk.yellow('No duplicates to export'));
                        return;
                    }
                    content = CSVExporter.exportDuplicates(this.currentResult.duplicateGroups);
                    break;
                case 'json':
                    content = JSON.stringify(this.currentResult, null, 2);
                    break;
                default:
                    throw new Error('Unknown export type');
            }

            await fs.writeFile(filename, content);
            console.log(chalk.green(`✅ Results exported to: ${filename}`));
        } catch (error) {
            console.error(chalk.red('Export failed:'), error instanceof Error ? error.message : String(error));
        }
    }

    private getDefaultFilename(exportType: string): string {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const baseName = `dir-analysis-${timestamp}`;

        switch (exportType) {
            case 'csv':
                return `${baseName}.csv`;
            case 'csv_large':
                return `${baseName}-large-files.csv`;
            case 'csv_duplicates':
                return `${baseName}-duplicates.csv`;
            case 'json':
                return `${baseName}.json`;
            default:
                return `${baseName}.txt`;
        }
    }

    private async advancedOptions(): Promise<void> {
        const { option } = await inquirer.prompt([
            {
                type: 'list',
                name: 'option',
                message: 'Advanced Options:',
                choices: [
                    { name: '📊 Compare Two Directories', value: 'compare' },
                    { name: '⚙️ Settings', value: 'settings' },
                    { name: '❓ Help', value: 'help' },
                    { name: '🔙 Back to Main Menu', value: 'back' }
                ]
            }
        ]);

        switch (option) {
            case 'compare':
                await this.comparDirectories();
                break;
            case 'settings':
                await this.showSettings();
                break;
            case 'help':
                this.showHelp();
                break;
            case 'back':
                return;
        }
    }

    private async comparDirectories(): Promise<void> {
        console.log(chalk.blue('\n📊 Directory Comparison'));
        console.log(chalk.gray('Compare the current directory with another directory\n'));

        const { otherPath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'otherPath',
                message: 'Enter path to compare with:',
                validate: async (input) => {
                    try {
                        const stats = await fs.stat(input);
                        return stats.isDirectory() ? true : 'Path is not a directory';
                    } catch {
                        return 'Path does not exist';
                    }
                }
            }
        ]);

        console.log(chalk.blue('\n🔍 Analyzing both directories...'));
        const progressCallback = ProgressBar.createCallback(true);

        const [result1, result2] = await Promise.all([
            this.analyzer.analyze({
                path: this.currentPath,
                recursive: true,
                excludePatterns: [],
                topN: 10,
                progressCallback
            }),
            this.analyzer.analyze({
                path: otherPath,
                recursive: true,
                excludePatterns: [],
                topN: 10,
                progressCallback
            })
        ]);

        this.displayComparison(result1, result2);
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }

    private displayComparison(result1: ExtendedAnalysisResult, result2: ExtendedAnalysisResult): void {
        console.log(chalk.blue('\n📊 Directory Comparison Results:'));
        console.log(chalk.cyan(`\n📂 Directory 1: ${result1.path}`));
        console.log(`  📦 Size: ${formatSize(result1.totalSizeBytes)}`);
        console.log(`  📁 Folders: ${result1.folders}`);
        console.log(`  📄 Files: ${result1.files}`);

        console.log(chalk.cyan(`\n📂 Directory 2: ${result2.path}`));
        console.log(`  📦 Size: ${formatSize(result2.totalSizeBytes)}`);
        console.log(`  📁 Folders: ${result2.folders}`);
        console.log(`  📄 Files: ${result2.files}`);

        console.log(chalk.yellow('\n📈 Comparison:'));
        const sizeDiff = result1.totalSizeBytes - result2.totalSizeBytes;
        const filesDiff = result1.files - result2.files;
        const foldersDiff = result1.folders - result2.folders;

        console.log(`  📦 Size difference: ${sizeDiff >= 0 ? '+' : ''}${formatSize(Math.abs(sizeDiff))} (${sizeDiff >= 0 ? 'Dir1 larger' : 'Dir2 larger'})`);
        console.log(`  📄 Files difference: ${filesDiff >= 0 ? '+' : ''}${Math.abs(filesDiff)} (${filesDiff >= 0 ? 'Dir1 more' : 'Dir2 more'})`);
        console.log(`  📁 Folders difference: ${foldersDiff >= 0 ? '+' : ''}${Math.abs(foldersDiff)} (${foldersDiff >= 0 ? 'Dir1 more' : 'Dir2 more'})`);
    }

    private async showSettings(): Promise<void> {
        console.log(chalk.blue('\n⚙️ Settings'));
        console.log(chalk.gray('Settings are configured per analysis. No persistent settings available in this version.'));
        console.log(chalk.gray('\nPress Enter to continue...'));
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
    }

    private showHelp(): void {
        console.log(chalk.blue('\n❓ Help - Interactive Directory Analyzer'));
        console.log(chalk.gray('═'.repeat(50)));
        console.log(chalk.yellow('\n🔍 Analysis Features:'));
        console.log('  • Recursive scanning of directories');
        console.log('  • File type classification (code, images, documents, etc.)');
        console.log('  • Large file detection with configurable thresholds');
        console.log('  • Duplicate file detection using MD5 hashing');
        console.log('  • Empty file detection');
        console.log('  • Tree view visualization');
        console.log('  • Top N largest files ranking');

        console.log(chalk.yellow('\n📊 Filtering Options:'));
        console.log('  • Size filters (minimum/maximum file size)');
        console.log('  • Date filters (modification date range)');
        console.log('  • Exclude patterns (file/directory patterns)');

        console.log(chalk.yellow('\n💾 Export Options:'));
        console.log('  • CSV format (general, large files, duplicates)');
        console.log('  • JSON format (complete results)');
        console.log('  • Custom filename support');

        console.log(chalk.yellow('\n🚀 Advanced Features:'));
        console.log('  • Directory comparison');
        console.log('  • Interactive result browsing');
        console.log('  • Progress tracking for large analyses');

        console.log(chalk.gray('\nPress Enter to continue...'));
    }
}
