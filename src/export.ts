import { AnalysisResult } from './analyzer';
import { DuplicateFileGroup, LargeFile, EmptyFile } from './types';

export interface ExtendedAnalysisResult extends AnalysisResult {
    largeFiles?: LargeFile[];
    duplicateGroups?: DuplicateFileGroup[];
    duplicateStats?: {
        totalGroups: number;
        totalWastedSpace: number;
        totalWastedSpaceFormatted: string;
    };
    // Phase 1 new properties
    emptyFiles?: EmptyFile[];
    topLargestFiles?: LargeFile[];
    treeView?: string;
}

export class CSVExporter {
    static exportAnalysis(result: ExtendedAnalysisResult): string {
        const lines: string[] = [];

        // Header
        lines.push('Type,Path,Size (Bytes),Size (Formatted),Count,Details');

        // Summary
        lines.push(`Summary,${result.path},${result.totalSizeBytes},${result.totalSizeMB}MB,${result.files},Folders: ${result.folders}`);

        // File types
        Object.entries(result.types).forEach(([type, count]) => {
            if (count > 0) {
                lines.push(`FileType,${type},-,-,${count},-`);
            }
        });

        // Large files
        if (result.largeFiles && result.largeFiles.length > 0) {
            result.largeFiles.forEach(file => {
                lines.push(`LargeFile,"${file.path}",${file.size},"${file.sizeFormatted}",1,-`);
            });
        }

        // Duplicate groups
        if (result.duplicateGroups && result.duplicateGroups.length > 0) {
            result.duplicateGroups.forEach((group, index) => {
                group.files.forEach((file, fileIndex) => {
                    const details = fileIndex === 0
                        ? `Group ${index + 1}, Total files: ${group.files.length}, Wasted space: ${group.totalWastedSpaceFormatted}`
                        : `Group ${index + 1} (duplicate)`;
                    lines.push(`Duplicate,"${file}",${group.size},"${group.sizeFormatted}",1,"${details}"`);
                });
            });
        }

        return lines.join('\n');
    }

    static exportLargeFiles(largeFiles: LargeFile[]): string {
        const lines: string[] = [];
        lines.push('Path,Size (Bytes),Size (Formatted)');

        largeFiles.forEach(file => {
            lines.push(`"${file.path}",${file.size},"${file.sizeFormatted}"`);
        });

        return lines.join('\n');
    }

    static exportDuplicates(duplicateGroups: DuplicateFileGroup[]): string {
        const lines: string[] = [];
        lines.push('Group,Path,Size (Bytes),Size (Formatted),Files in Group,Wasted Space');

        duplicateGroups.forEach((group, index) => {
            group.files.forEach(file => {
                lines.push(`${index + 1},"${file}",${group.size},"${group.sizeFormatted}",${group.files.length},"${group.totalWastedSpaceFormatted}"`);
            });
        });

        return lines.join('\n');
    }
}
