import prettyBytes from 'pretty-bytes';

export function formatSize(bytes: number): string {
    return prettyBytes(bytes);
}

export function formatSizeInMB(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function shouldExcludeDirectory(dirName: string, excludePatterns: string[] = []): boolean {
    const defaultExcludes = ['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.cache'];
    const allExcludes = [...defaultExcludes, ...excludePatterns];

    return allExcludes.some(pattern => {
        if (pattern.includes('*')) {
            // Simple glob pattern matching
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(dirName);
        }
        return dirName === pattern;
    });
}

export function shouldExcludeFile(fileName: string, excludePatterns: string[] = []): boolean {
    return excludePatterns.some(pattern => {
        if (pattern.includes('*')) {
            // Simple glob pattern matching
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(fileName);
        }
        return fileName.endsWith(pattern) || fileName === pattern;
    });
}

export const EMOJIS = {
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
    progress: '🔍',
    success: '✅',
    csv: '📄'
} as const;
