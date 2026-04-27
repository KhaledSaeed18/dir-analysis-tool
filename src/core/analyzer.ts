import { stat } from 'node:fs/promises';
import { relative, basename, sep } from 'node:path';
import prettyBytes from 'pretty-bytes';
import { walk } from './walker.js';
import { FileClassifier } from './classifier.js';
import {
    detectDuplicates,
    detectLargeFiles,
    getTopLargestFiles,
    detectEmptyFiles,
} from './detectors.js';
import type { AnalysisOptions, AnalysisResult, DuplicateStats } from '../types.js';

interface FileRecord {
    path: string;
    name: string;
    size: number;
    mtime: Date;
}

export async function analyze(options: AnalysisOptions): Promise<AnalysisResult> {
    const s = await stat(options.path).catch(() => {
        throw new Error(`Cannot access path: ${options.path}`);
    });
    if (!s.isDirectory()) {
        throw new Error(`Not a directory: ${options.path}`);
    }

    const classifier = new FileClassifier();
    let totalSize = 0;
    let fileCount = 0;
    let folderCount = 0;
    const allFiles: FileRecord[] = [];

    for await (const entry of walk(options.path, {
        recursive: options.recursive ?? true,
        maxDepth: options.maxDepth,
        excludeDirs: options.excludePatterns ?? [],
        clearDefaultExclusions: options.clearDefaultExclusions ?? false,
    })) {
        if (entry.kind === 'dir') {
            folderCount++;
            continue;
        }

        if (options.minSize !== undefined && entry.size < options.minSize) continue;
        if (options.maxSize !== undefined && entry.size > options.maxSize) continue;
        if (options.dateFrom && entry.mtime < options.dateFrom) continue;
        if (options.dateTo && entry.mtime > options.dateTo) continue;

        totalSize += entry.size;
        fileCount++;
        classifier.classifyFile(entry.name);
        allFiles.push({ path: entry.path, name: entry.name, size: entry.size, mtime: entry.mtime });

        options.onProgress?.(fileCount, entry.path);
    }

    const result: AnalysisResult = {
        path: options.path,
        totalSizeBytes: totalSize,
        totalSizeFormatted: prettyBytes(totalSize),
        totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 10) / 10,
        folders: folderCount,
        files: fileCount,
        types: classifier.getClassification(),
    };

    const thresholdBytes =
        options.largeSizeThresholdMB !== undefined
            ? options.largeSizeThresholdMB * 1024 * 1024
            : undefined;

    if (thresholdBytes !== undefined) {
        result.largeFiles = detectLargeFiles(allFiles, thresholdBytes);
    }

    if (options.enableDuplicateDetection && allFiles.length > 0) {
        result.duplicateGroups = await detectDuplicates(
            allFiles.map((f) => f.path),
            options.onHashProgress
        );
        if (result.duplicateGroups.length > 0) {
            const wastedSpace = result.duplicateGroups.reduce((sum, g) => sum + g.wastedSpace, 0);
            result.duplicateStats = {
                totalGroups: result.duplicateGroups.length,
                wastedSpace,
                wastedSpaceFormatted: prettyBytes(wastedSpace),
            } satisfies DuplicateStats;
        }
    }

    if (options.topN && options.topN > 0) {
        result.topLargestFiles = getTopLargestFiles(allFiles, options.topN);
    }

    if (options.showEmptyFiles) {
        result.emptyFiles = detectEmptyFiles(allFiles);
    }

    if (allFiles.length <= 1000) {
        result.treeView = buildTreeView(allFiles, options.path);
    }

    return result;
}

interface TreeNode {
    name: string;
    isDir: boolean;
    size: number;
    children: Map<string, TreeNode>;
}

function buildTreeView(files: FileRecord[], root: string): string {
    const rootNode: TreeNode = { name: basename(root) || root, isDir: true, size: 0, children: new Map() };

    for (const file of files) {
        const rel = relative(root, file.path);
        if (!rel || rel === '.') continue;

        const parts = rel.split(sep);
        let node = rootNode;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!node.children.has(part)) {
                node.children.set(part, { name: part, isDir: true, size: 0, children: new Map() });
            }
            node = node.children.get(part)!;
        }

        const fileName = parts[parts.length - 1];
        node.children.set(fileName, {
            name: fileName,
            isDir: false,
            size: file.size,
            children: new Map(),
        });
    }

    const lines: string[] = [];
    renderNode(rootNode, '', true, lines, 0);
    return lines.join('\n');
}

function renderNode(
    node: TreeNode,
    prefix: string,
    isLast: boolean,
    lines: string[],
    depth: number
): void {
    if (depth > 10) return;

    const connector = depth === 0 ? '' : isLast ? '└── ' : '├── ';
    const icon = node.isDir ? '📁' : '📄';
    const size = node.isDir ? '' : ` (${prettyBytes(node.size)})`;
    lines.push(`${prefix}${connector}${icon} ${node.name}${size}`);

    const children = [...node.children.values()].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    const newPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < children.length; i++) {
        renderNode(children[i], newPrefix, i === children.length - 1, lines, depth + 1);
    }
}
