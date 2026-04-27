import { writeFile } from 'node:fs/promises';
import type { AnalysisResult } from '../types.js';

function escape(value: string | number): string {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

export function buildAnalysisCsv(result: AnalysisResult): string {
    const lines: string[] = ['Type,Path,Size (Bytes),Size (Formatted),Count,Details'];

    lines.push(
        [
            'Summary',
            escape(result.path),
            result.totalSizeBytes,
            escape(`${result.totalSizeMB}MB`),
            result.files,
            escape(`Folders: ${result.folders}`),
        ].join(',')
    );

    for (const [type, count] of Object.entries(result.types)) {
        if ((count as number) > 0) {
            lines.push(['FileType', escape(type), '-', '-', count, '-'].join(','));
        }
    }

    for (const file of result.largeFiles ?? []) {
        lines.push(['LargeFile', escape(file.path), file.size, escape(file.sizeFormatted), 1, '-'].join(','));
    }

    for (const [i, group] of (result.duplicateGroups ?? []).entries()) {
        for (const [j, file] of group.files.entries()) {
            const details =
                j === 0
                    ? escape(`Group ${i + 1}, files: ${group.files.length}, wasted: ${group.wastedSpaceFormatted}`)
                    : escape(`Group ${i + 1} (duplicate)`);
            lines.push(['Duplicate', escape(file), group.size, escape(group.sizeFormatted), 1, details].join(','));
        }
    }

    return lines.join('\n');
}

export function buildLargeFilesCsv(result: AnalysisResult): string {
    const lines = ['Path,Size (Bytes),Size (Formatted)'];
    for (const file of result.largeFiles ?? []) {
        lines.push([escape(file.path), file.size, escape(file.sizeFormatted)].join(','));
    }
    return lines.join('\n');
}

export function buildDuplicatesCsv(result: AnalysisResult): string {
    const lines = ['Group,Path,Size (Bytes),Size (Formatted),Files in Group,Wasted Space'];
    for (const [i, group] of (result.duplicateGroups ?? []).entries()) {
        for (const file of group.files) {
            lines.push(
                [
                    i + 1,
                    escape(file),
                    group.size,
                    escape(group.sizeFormatted),
                    group.files.length,
                    escape(group.wastedSpaceFormatted),
                ].join(',')
            );
        }
    }
    return lines.join('\n');
}

export async function writeCsvFiles(
    result: AnalysisResult,
    opts: { csv?: string | boolean; csvLarge?: string | boolean; csvDuplicates?: string | boolean }
): Promise<void> {
    if (opts.csv) {
        const filename = typeof opts.csv === 'string' ? opts.csv : 'directory-analysis.csv';
        await writeFile(filename, buildAnalysisCsv(result));
        console.log(`📄 Analysis exported to: ${filename}`);
    }

    if (opts.csvLarge && result.largeFiles && result.largeFiles.length > 0) {
        const filename = typeof opts.csvLarge === 'string' ? opts.csvLarge : 'large-files.csv';
        await writeFile(filename, buildLargeFilesCsv(result));
        console.log(`📄 Large files exported to: ${filename}`);
    }

    if (opts.csvDuplicates && result.duplicateGroups && result.duplicateGroups.length > 0) {
        const filename = typeof opts.csvDuplicates === 'string' ? opts.csvDuplicates : 'duplicates.csv';
        await writeFile(filename, buildDuplicatesCsv(result));
        console.log(`📄 Duplicates exported to: ${filename}`);
    }
}
