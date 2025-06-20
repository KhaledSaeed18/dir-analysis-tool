import { promises as fs } from 'fs';
import * as path from 'path';
import { FileClassifier, FileTypeClassification } from './classifier';
import { shouldExcludeDirectory, shouldExcludeFile, formatSizeInMB } from './utils';
import { DuplicateDetector, LargeFileDetector, EmptyFileDetector, FileFilter } from './advanced-analysis';
import { ProgressCallback, LargeFile, DuplicateFileGroup, EmptyFile } from './types';
import { TreeViewGenerator } from './tree-view';
import { ExtendedAnalysisResult } from './export';

export interface AnalysisOptions {
    path: string;
    recursive: boolean;
    excludePatterns: string[];
    largeSizeThreshold?: number;
    enableDuplicateDetection?: boolean;
    progressCallback?: ProgressCallback;
    maxDepth?: number;
    // Phase 1 new options
    minSize?: number;
    maxSize?: number;
    dateFrom?: Date;
    dateTo?: Date;
    topN?: number;
    showEmptyFiles?: boolean;
}

export interface AnalysisResult {
    path: string;
    totalSizeBytes: number; totalSizeMB: number;
    folders: number;
    files: number;
    types: FileTypeClassification;
}

export class DirectoryAnalyzer {
    private classifier: FileClassifier;
    private totalSize: number = 0;
    private folderCount: number = 0;
    private fileCount: number = 0;
    private allFiles: Array<{ path: string; size: number }> = [];
    private processedFiles: number = 0;
    private currentDepth: number = 0;

    constructor() {
        this.classifier = new FileClassifier();
    }

    async analyze(options: AnalysisOptions): Promise<ExtendedAnalysisResult> {
        // Reset counters
        this.totalSize = 0;
        this.folderCount = 0;
        this.fileCount = 0;
        this.allFiles = [];
        this.processedFiles = 0;
        this.currentDepth = 0;
        this.classifier.reset();

        // Validate path exists
        try {
            const stats = await fs.stat(options.path);
            if (!stats.isDirectory()) {
                throw new Error(`Path '${options.path}' is not a directory`);
            }
        } catch (error) {
            throw new Error(`Unable to access path '${options.path}': ${error}`);
        }

        if (options.progressCallback) {
            options.progressCallback(0, 1, 'Scanning directories...');
        }

        // First pass: count total files for progress tracking
        const totalFiles = await this.countFiles(options.path, options.recursive, options.excludePatterns, options.maxDepth || -1);

        // Second pass: analyze directory
        await this.analyzeDirectory(
            options.path,
            options.recursive,
            options.excludePatterns,
            options.progressCallback,
            totalFiles,
            options.maxDepth || -1,
            0
        );

        const basicResult: AnalysisResult = {
            path: options.path,
            totalSizeBytes: this.totalSize,
            totalSizeMB: formatSizeInMB(this.totalSize),
            folders: this.folderCount,
            files: this.fileCount,
            types: this.classifier.getClassification()
        };

        const extendedResult: ExtendedAnalysisResult = { ...basicResult };

        // Large file detection
        if (options.largeSizeThreshold) {
            extendedResult.largeFiles = LargeFileDetector.detectLargeFiles(
                this.allFiles,
                options.largeSizeThreshold
            );
        }

        // Duplicate detection
        if (options.enableDuplicateDetection) {
            const duplicateDetector = new DuplicateDetector();
            const filePaths = this.allFiles.map(f => f.path);

            if (options.progressCallback) {
                options.progressCallback(0, filePaths.length, 'Detecting duplicates...');
            }

            extendedResult.duplicateGroups = await duplicateDetector.detectDuplicates(
                filePaths,
                options.progressCallback
            );

            if (extendedResult.duplicateGroups.length > 0) {
                const totalWastedSpace = extendedResult.duplicateGroups.reduce(
                    (sum, group) => sum + group.totalWastedSpace,
                    0
                ); extendedResult.duplicateStats = {
                    totalGroups: extendedResult.duplicateGroups.length,
                    totalWastedSpace,
                    totalWastedSpaceFormatted: require('./utils').formatSize(totalWastedSpace)
                };
            }
        }

        // Phase 1 new features
        // Apply file filters
        let filteredFiles = this.allFiles;

        // Apply size filters
        if (options.minSize !== undefined || options.maxSize !== undefined) {
            filteredFiles = FileFilter.filterBySize(filteredFiles, options.minSize, options.maxSize);
        }

        // Apply date filters
        if (options.dateFrom || options.dateTo) {
            filteredFiles = await FileFilter.filterByDate(filteredFiles, options.dateFrom, options.dateTo);
        }

        // Top N largest files
        if (options.topN) {
            extendedResult.topLargestFiles = LargeFileDetector.getTopLargestFiles(
                filteredFiles,
                options.topN
            );
        }

        // Empty file detection
        if (options.showEmptyFiles) {
            extendedResult.emptyFiles = await EmptyFileDetector.detectEmptyFiles(this.allFiles);
        }

        // Tree view generation (only for smaller datasets to avoid performance issues)
        if (filteredFiles.length <= 1000) {
            extendedResult.treeView = TreeViewGenerator.generateCompactTreeView(
                filteredFiles,
                options.path,
                50
            );
        }

        return extendedResult;
    }

    private async countFiles(
        dirPath: string,
        recursive: boolean,
        excludePatterns: string[],
        maxDepth: number,
        currentDepth: number = 0
    ): Promise<number> {
        if (maxDepth >= 0 && currentDepth > maxDepth) {
            return 0;
        }

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            let count = 0;

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (shouldExcludeDirectory(entry.name, excludePatterns)) {
                        continue;
                    }
                    if (recursive) {
                        const fullPath = path.join(dirPath, entry.name);
                        count += await this.countFiles(fullPath, recursive, excludePatterns, maxDepth, currentDepth + 1);
                    }
                } else if (entry.isFile()) {
                    if (!shouldExcludeFile(entry.name, excludePatterns)) {
                        count++;
                    }
                }
            }

            return count;
        } catch (error) {
            return 0;
        }
    }

    private async analyzeDirectory(
        dirPath: string,
        recursive: boolean,
        excludePatterns: string[],
        progressCallback?: ProgressCallback,
        totalFiles?: number,
        maxDepth: number = -1,
        currentDepth: number = 0
    ): Promise<void> {
        if (maxDepth >= 0 && currentDepth > maxDepth) {
            return;
        }

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    // Check if directory should be excluded
                    if (shouldExcludeDirectory(entry.name, excludePatterns)) {
                        continue;
                    }

                    this.folderCount++;

                    if (recursive) {
                        await this.analyzeDirectory(
                            fullPath,
                            recursive,
                            excludePatterns,
                            progressCallback,
                            totalFiles,
                            maxDepth,
                            currentDepth + 1
                        );
                    }
                } else if (entry.isFile()) {
                    // Check if file should be excluded
                    if (shouldExcludeFile(entry.name, excludePatterns)) {
                        continue;
                    }

                    try {
                        const stats = await fs.stat(fullPath);
                        this.totalSize += stats.size;
                        this.fileCount++;
                        this.classifier.classifyFile(entry.name);

                        // Store file info for advanced analysis
                        this.allFiles.push({
                            path: fullPath,
                            size: stats.size
                        });

                        this.processedFiles++;

                        if (progressCallback && totalFiles) {
                            progressCallback(this.processedFiles, totalFiles, fullPath);
                        }
                    } catch (error) {
                        // Skip files that can't be accessed
                        console.warn(`Warning: Unable to access file '${fullPath}': ${error}`);
                    }
                }
            }
        } catch (error) {
            console.warn(`Warning: Unable to read directory '${dirPath}': ${error}`);
        }
    }
}
