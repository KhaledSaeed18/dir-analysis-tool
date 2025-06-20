import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import { formatSize } from './utils';
import { DuplicateFileGroup, LargeFile, ProgressCallback, EmptyFile } from './types';

export class DuplicateDetector {
    private fileHashes = new Map<string, string[]>();
    private processedFiles = 0;
    private totalFiles = 0;

    async detectDuplicates(
        filePaths: string[],
        progressCallback?: ProgressCallback
    ): Promise<DuplicateFileGroup[]> {
        this.fileHashes.clear();
        this.processedFiles = 0;
        this.totalFiles = filePaths.length;

        if (progressCallback) {
            progressCallback(0, this.totalFiles, 'Starting duplicate detection...');
        }

        const batchSize = 50;
        for (let i = 0; i < filePaths.length; i += batchSize) {
            const batch = filePaths.slice(i, i + batchSize);
            await Promise.all(batch.map(filePath => this.processFile(filePath, progressCallback)));
        }

        return this.generateDuplicateGroups();
    }

    private async processFile(filePath: string, progressCallback?: ProgressCallback): Promise<void> {
        try {
            const hash = await this.calculateFileHash(filePath);

            if (!this.fileHashes.has(hash)) {
                this.fileHashes.set(hash, []);
            }
            this.fileHashes.get(hash)!.push(filePath);

            this.processedFiles++;

            if (progressCallback) {
                progressCallback(this.processedFiles, this.totalFiles, filePath);
            }
        } catch (error) {
            this.processedFiles++;
            if (progressCallback) {
                progressCallback(this.processedFiles, this.totalFiles);
            }
        }
    }

    private async calculateFileHash(filePath: string): Promise<string> {
        const hash = crypto.createHash('md5');
        const stream = await fs.readFile(filePath);
        hash.update(stream);
        return hash.digest('hex');
    }

    private async generateDuplicateGroups(): Promise<DuplicateFileGroup[]> {
        const groups: DuplicateFileGroup[] = [];

        for (const [hash, files] of this.fileHashes) {
            if (files.length > 1) {
                try {
                    const stats = await fs.stat(files[0]);
                    const size = stats.size;
                    const totalWastedSpace = size * (files.length - 1);

                    groups.push({
                        hash,
                        size,
                        sizeFormatted: formatSize(size),
                        files: [...files],
                        totalWastedSpace,
                        totalWastedSpaceFormatted: formatSize(totalWastedSpace)
                    });
                } catch (error) {
                    // Skip if we can't get file stats
                }
            }
        }

        return groups.sort((a, b) => b.totalWastedSpace - a.totalWastedSpace);
    }
}

export class LargeFileDetector {
    static detectLargeFiles(
        files: Array<{ path: string; size: number }>,
        threshold: number
    ): LargeFile[] {
        return files
            .filter(file => file.size >= threshold)
            .sort((a, b) => b.size - a.size)
            .map(file => ({
                path: file.path,
                size: file.size,
                sizeFormatted: formatSize(file.size)
            }));
    }

    static getTopLargestFiles(
        files: Array<{ path: string; size: number }>,
        count: number
    ): LargeFile[] {
        return files
            .sort((a, b) => b.size - a.size)
            .slice(0, count)
            .map(file => ({
                path: file.path,
                size: file.size,
                sizeFormatted: formatSize(file.size)
            }));
    }
}

export class EmptyFileDetector {
    static async detectEmptyFiles(
        files: Array<{ path: string; size: number }>
    ): Promise<EmptyFile[]> {
        const emptyFiles: EmptyFile[] = [];

        for (const file of files) {
            if (file.size === 0) {
                try {
                    const stats = await fs.stat(file.path);
                    emptyFiles.push({
                        path: file.path,
                        modifiedDate: stats.mtime
                    });
                } catch (error) {
                    // Skip files that can't be accessed
                }
            }
        }

        return emptyFiles.sort((a, b) =>
            b.modifiedDate.getTime() - a.modifiedDate.getTime()
        );
    }
}

export class FileFilter {
    static filterBySize(
        files: Array<{ path: string; size: number }>,
        minSize?: number,
        maxSize?: number
    ): Array<{ path: string; size: number }> {
        return files.filter(file => {
            if (minSize !== undefined && file.size < minSize) return false;
            if (maxSize !== undefined && file.size > maxSize) return false;
            return true;
        });
    }

    static async filterByDate(
        files: Array<{ path: string; size: number }>,
        dateFrom?: Date,
        dateTo?: Date
    ): Promise<Array<{ path: string; size: number }>> {
        if (!dateFrom && !dateTo) return files;

        const filteredFiles: Array<{ path: string; size: number }> = [];

        for (const file of files) {
            try {
                const stats = await fs.stat(file.path);
                const modifiedDate = stats.mtime;

                if (dateFrom && modifiedDate < dateFrom) continue;
                if (dateTo && modifiedDate > dateTo) continue;

                filteredFiles.push(file);
            } catch (error) {
                // Skip files that can't be accessed
            }
        }

        return filteredFiles;
    }
}
