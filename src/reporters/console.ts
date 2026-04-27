import { relative } from 'node:path';
import chalk from 'chalk';
import prettyBytes from 'pretty-bytes';
import type { AnalysisResult } from '../types.js';

const ICONS = {
    folder: '📂',
    package: '📦',
    folderIcon: '📁',
    fileIcon: '📄',
    types: '🗂',
    images: '📷',
    videos: '🎬',
    documents: '📄',
    audio: '🎵',
    code: '🧑‍💻',
    archives: '🗃️',
    other: '❓',
    largeFile: '🚨',
    duplicates: '🔄',
    empty: '📭',
} as const;

export function printResult(result: AnalysisResult, opts: { showTypes?: boolean; treeView?: boolean } = {}): void {
    if (opts.treeView) {
        printTreeOutput(result);
    } else {
        printSummary(result, opts.showTypes ?? true);
    }
}

function printSummary(result: AnalysisResult, showTypes: boolean): void {
    console.log(chalk.blue(`${ICONS.folder} Directory: ${result.path}`));
    console.log(chalk.green(`${ICONS.package} Total Size: ${result.totalSizeFormatted}`));
    console.log(chalk.yellow(`${ICONS.folderIcon} Folders: ${result.folders.toLocaleString()}`));
    console.log(chalk.cyan(`${ICONS.fileIcon} Files: ${result.files.toLocaleString()}`));

    if (showTypes) {
        const entries: Array<{ key: keyof typeof result.types; icon: string; label: string }> = [
            { key: 'images', icon: ICONS.images, label: 'Images' },
            { key: 'videos', icon: ICONS.videos, label: 'Videos' },
            { key: 'documents', icon: ICONS.documents, label: 'Documents' },
            { key: 'audio', icon: ICONS.audio, label: 'Audio' },
            { key: 'code', icon: ICONS.code, label: 'Code' },
            { key: 'archives', icon: ICONS.archives, label: 'Archives' },
            { key: 'other', icon: ICONS.other, label: 'Other' },
        ];

        const hasTypes = entries.some(({ key }) => result.types[key] > 0);
        if (hasTypes) {
            console.log(chalk.magenta(`\n${ICONS.types} File Types:`));
            for (const { key, icon, label } of entries) {
                const count = result.types[key];
                if (count > 0) {
                    console.log(`  ${icon} ${label}: ${count.toLocaleString()}`);
                }
            }
        }
    }

    printLargeFiles(result);
    printDuplicates(result);
    printTopLargest(result);
    printEmptyFiles(result);
}

function printTreeOutput(result: AnalysisResult): void {
    console.log(chalk.blue(`${ICONS.folder} Directory Tree: ${result.path}`));
    console.log(chalk.green(`${ICONS.package} Total Size: ${result.totalSizeFormatted}`));
    console.log(chalk.yellow(`${ICONS.folderIcon} Folders: ${result.folders.toLocaleString()}`));
    console.log(chalk.cyan(`${ICONS.fileIcon} Files: ${result.files.toLocaleString()}\n`));

    if (result.treeView) {
        console.log(result.treeView);
    } else {
        console.log(chalk.yellow('Tree view not available for large datasets (>1000 files).'));
        console.log('Use --top-n to see the largest files instead.\n');
    }

    printTopLargest(result);
    printEmptyFiles(result);
}

function printLargeFiles(result: AnalysisResult): void {
    if (!result.largeFiles || result.largeFiles.length === 0) return;

    const shown = Math.min(5, result.largeFiles.length);
    console.log(chalk.red(`\n${ICONS.largeFile} Large Files (showing ${shown} of ${result.largeFiles.length}):`));
    for (const file of result.largeFiles.slice(0, 5)) {
        const rel = relative(result.path, file.path);
        console.log(`  📁 ${rel} — ${chalk.yellow(file.sizeFormatted)}`);
    }
    if (result.largeFiles.length > 5) {
        console.log(chalk.gray(`  … and ${result.largeFiles.length - 5} more. Use --html to see all.`));
    }
}

function printDuplicates(result: AnalysisResult): void {
    if (!result.duplicateStats || result.duplicateStats.totalGroups === 0) return;

    console.log(chalk.yellow(`\n${ICONS.duplicates} Duplicate Files:`));
    console.log(`  Groups: ${result.duplicateStats.totalGroups}`);
    console.log(`  Wasted Space: ${chalk.red(result.duplicateStats.wastedSpaceFormatted)}`);

    if (result.duplicateGroups && result.duplicateGroups.length > 0) {
        console.log(chalk.gray('\n  Top duplicate groups:'));
        for (const [i, group] of result.duplicateGroups.slice(0, 3).entries()) {
            console.log(`  ${i + 1}. ${group.sizeFormatted} each × ${group.files.length} copies`);
            for (const file of group.files.slice(0, 2)) {
                console.log(`     📄 ${relative(result.path, file)}`);
            }
            if (group.files.length > 2) {
                console.log(chalk.gray(`     … and ${group.files.length - 2} more`));
            }
        }
    }
}

function printTopLargest(result: AnalysisResult): void {
    if (!result.topLargestFiles || result.topLargestFiles.length === 0) return;

    console.log(chalk.red(`\n${ICONS.largeFile} Top ${result.topLargestFiles.length} Largest Files:`));
    for (const [i, file] of result.topLargestFiles.entries()) {
        const rel = relative(result.path, file.path);
        console.log(`  ${chalk.gray(`${i + 1}.`)} ${rel} — ${chalk.yellow(file.sizeFormatted)}`);
    }
}

function printEmptyFiles(result: AnalysisResult): void {
    if (!result.emptyFiles || result.emptyFiles.length === 0) return;

    const shown = Math.min(10, result.emptyFiles.length);
    console.log(chalk.yellow(`\n${ICONS.empty} Empty Files (${result.emptyFiles.length}):`));
    for (const file of result.emptyFiles.slice(0, shown)) {
        const rel = relative(result.path, file.path);
        const date = file.mtime.toLocaleDateString();
        console.log(`  📄 ${rel} ${chalk.gray(`(modified: ${date})`)}`);
    }
    if (result.emptyFiles.length > shown) {
        console.log(chalk.gray(`  … and ${result.emptyFiles.length - shown} more`));
    }
}

export function printComparison(a: AnalysisResult, b: AnalysisResult): void {
    const col = 28;
    const header = (label: string) => chalk.bold.blue(label.padEnd(col));
    const val = (v: string | number) => String(v).padStart(16);

    console.log(`\n${chalk.bold('Directory Comparison')}`);
    console.log(chalk.gray('─'.repeat(80)));

    const pathA = a.path.length > col - 2 ? '…' + a.path.slice(-(col - 3)) : a.path;
    const pathB = b.path.length > col - 2 ? '…' + b.path.slice(-(col - 3)) : b.path;
    console.log(`${header('Path')}${val(pathA)}  ${val(pathB)}`);
    console.log(chalk.gray('─'.repeat(80)));

    const row = (label: string, va: string | number, vb: string | number) => {
        console.log(`${label.padEnd(col)}${val(va)}  ${val(vb)}`);
    };

    row('Total Size', a.totalSizeFormatted, b.totalSizeFormatted);
    row('Files', a.files.toLocaleString(), b.files.toLocaleString());
    row('Folders', a.folders.toLocaleString(), b.folders.toLocaleString());
    row('Images', a.types.images, b.types.images);
    row('Videos', a.types.videos, b.types.videos);
    row('Documents', a.types.documents, b.types.documents);
    row('Audio', a.types.audio, b.types.audio);
    row('Code', a.types.code, b.types.code);
    row('Archives', a.types.archives, b.types.archives);
    row('Other', a.types.other, b.types.other);
    console.log(chalk.gray('─'.repeat(80)));

    const sizeDiff = a.totalSizeBytes - b.totalSizeBytes;
    const fileDiff = a.files - b.files;
    const sign = (n: number) => (n > 0 ? '+' : '');
    if (sizeDiff !== 0) {
        const color = sizeDiff > 0 ? chalk.red : chalk.green;
        console.log(`Size difference: ${color(`${sign(sizeDiff)}${prettyBytes(Math.abs(sizeDiff))}`)}`);
    }
    if (fileDiff !== 0) {
        const color = fileDiff > 0 ? chalk.red : chalk.green;
        console.log(`File difference: ${color(`${sign(fileDiff)}${fileDiff}`)}`);
    }
}
