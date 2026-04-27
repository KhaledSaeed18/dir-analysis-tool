export interface FileTypeClassification {
    images: number;
    videos: number;
    documents: number;
    audio: number;
    code: number;
    archives: number;
    other: number;
}

export interface LargeFile {
    path: string;
    size: number;
    sizeFormatted: string;
    mtime?: Date;
    ctime?: Date;
}

export interface EmptyFile {
    path: string;
    mtime: Date;
}

export interface DuplicateGroup {
    hash: string;
    size: number;
    sizeFormatted: string;
    files: string[];
    wastedSpace: number;
    wastedSpaceFormatted: string;
}

export interface DuplicateStats {
    totalGroups: number;
    wastedSpace: number;
    wastedSpaceFormatted: string;
}

export interface AnalysisResult {
    path: string;
    totalSizeBytes: number;
    totalSizeFormatted: string;
    totalSizeMB: number;
    folders: number;
    files: number;
    types: FileTypeClassification;
    largeFiles?: LargeFile[];
    duplicateGroups?: DuplicateGroup[];
    duplicateStats?: DuplicateStats;
    emptyFiles?: EmptyFile[];
    topLargestFiles?: LargeFile[];
    treeView?: string;
}

export interface AnalysisOptions {
    path: string;
    recursive?: boolean;
    excludePatterns?: string[];
    clearDefaultExclusions?: boolean;
    largeSizeThresholdMB?: number;
    enableDuplicateDetection?: boolean;
    maxDepth?: number;
    minSize?: number;
    maxSize?: number;
    dateFrom?: Date;
    dateTo?: Date;
    topN?: number;
    showEmptyFiles?: boolean;
    onProgress?: (scanned: number, currentPath: string) => void;
    onHashProgress?: (done: number, total: number) => void;
}

export interface Config {
    excludePatterns?: string[];
    clearDefaultExclusions?: boolean;
    largeSizeThresholdMB?: number;
    enableDuplicateDetection?: boolean;
    maxDepth?: number;
    topN?: number;
    showEmptyFiles?: boolean;
}
