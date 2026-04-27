import { stat } from 'node:fs/promises';
import prettyBytes from 'pretty-bytes';
import { hashFile } from './hasher.js';
import type { DuplicateGroup, LargeFile, EmptyFile } from '../types.js';

const HASH_BATCH_SIZE = 20;

export async function detectDuplicates(
    filePaths: string[],
    onProgress?: (done: number, total: number) => void
): Promise<DuplicateGroup[]> {
    const hashMap = new Map<string, string[]>();
    const total = filePaths.length;
    let done = 0;

    for (let i = 0; i < filePaths.length; i += HASH_BATCH_SIZE) {
        const batch = filePaths.slice(i, i + HASH_BATCH_SIZE);
        await Promise.all(
            batch.map(async (filePath) => {
                try {
                    const hash = await hashFile(filePath);
                    const existing = hashMap.get(hash) ?? [];
                    existing.push(filePath);
                    hashMap.set(hash, existing);
                } catch {
                    // skip inaccessible files
                } finally {
                    done++;
                    onProgress?.(done, total);
                }
            })
        );
    }

    const groups: DuplicateGroup[] = [];
    for (const [hash, files] of hashMap) {
        if (files.length < 2) continue;
        try {
            const { size } = await stat(files[0]);
            const wastedSpace = size * (files.length - 1);
            groups.push({
                hash,
                size,
                sizeFormatted: prettyBytes(size),
                files,
                wastedSpace,
                wastedSpaceFormatted: prettyBytes(wastedSpace),
            });
        } catch {
            // skip
        }
    }

    return groups.sort((a, b) => b.wastedSpace - a.wastedSpace);
}

export function detectLargeFiles(
    files: Array<{ path: string; size: number }>,
    thresholdBytes: number
): LargeFile[] {
    return files
        .filter((f) => f.size >= thresholdBytes)
        .sort((a, b) => b.size - a.size)
        .map((f) => ({ path: f.path, size: f.size, sizeFormatted: prettyBytes(f.size) }));
}

export function getTopLargestFiles(
    files: Array<{ path: string; size: number }>,
    n: number
): LargeFile[] {
    return [...files]
        .sort((a, b) => b.size - a.size)
        .slice(0, n)
        .map((f) => ({ path: f.path, size: f.size, sizeFormatted: prettyBytes(f.size) }));
}

export function detectEmptyFiles(
    files: Array<{ path: string; size: number; mtime: Date }>
): EmptyFile[] {
    return files
        .filter((f) => f.size === 0)
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
        .map((f) => ({ path: f.path, mtime: f.mtime }));
}
