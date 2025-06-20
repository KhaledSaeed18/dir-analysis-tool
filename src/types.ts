export interface LargeFile {
    path: string;
    size: number;
    sizeFormatted: string;
    modifiedDate?: Date;
    createdDate?: Date;
}

export interface EmptyFile {
    path: string;
    modifiedDate: Date;
}

export interface FileInfo {
    path: string;
    size: number;
    modifiedDate: Date;
    createdDate: Date;
}

export interface DuplicateFileGroup {
    hash: string;
    size: number;
    sizeFormatted: string;
    files: string[];
    totalWastedSpace: number;
    totalWastedSpaceFormatted: string;
}

export interface ProgressCallback {
    (current: number, total: number, currentPath?: string): void;
}

export interface ConfigOptions {
    excludePatterns?: string[];
    largeSizeThreshold?: number;
    enableDuplicateDetection?: boolean;
    enableProgressBar?: boolean;
    outputFormat?: 'table' | 'json' | 'csv' | 'tree';
    maxDepth?: number;
    minSize?: number;
    maxSize?: number;
    dateFrom?: Date;
    dateTo?: Date;
    topN?: number;
    showEmptyFiles?: boolean;
}
