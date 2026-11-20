import { describe, expect, it } from 'vitest';
import { compactAnalysis } from '../../src/core/compact.ts';
import type { AnalysisResult } from '../../src/types.ts';

function result(): AnalysisResult {
    const file = (path: string, bytes: number) => ({
        path,
        bytes,
        modified: '2026-01-01T00:00:00.000Z',
    });
    return {
        schemaVersion: 3,
        tool: { name: 'dir-analysis-tool', version: '0.0.0' },
        root: '/r',
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 1,
        settings: {
            exclude: [],
            defaultExcludes: true,
            gitignore: false,
            maxDepth: null,
            followSymlinks: false,
            countHardlinks: false,
            minSize: null,
            maxSize: null,
            modifiedAfter: null,
            modifiedBefore: null,
        },
        summary: {
            bytes: 100,
            diskBytes: 100,
            files: 9,
            directories: 1,
            largestFileBytes: 40,
            symlinks: 0,
            hardlinks: 0,
            excluded: 0,
            filtered: 0,
            errors: 250,
        },
        types: {
            code: { files: 0, bytes: 0 },
            documents: { files: 0, bytes: 0 },
            images: { files: 0, bytes: 0 },
            videos: { files: 0, bytes: 0 },
            audio: { files: 0, bytes: 0 },
            archives: { files: 0, bytes: 0 },
            fonts: { files: 0, bytes: 0 },
            data: { files: 0, bytes: 0 },
            other: { files: 9, bytes: 100 },
        },
        extensions: [
            { extension: '.a', files: 3, bytes: 50 },
            { extension: '.b', files: 3, bytes: 30 },
            { extension: '.c', files: 3, bytes: 20 },
        ],
        largestDirectories: [{ path: 'd', bytes: 100, files: 9 }],
        largestFiles: [file('x.a', 40)],
        errors: Array.from({ length: 100 }, (_, i) => ({
            path: `e${i}`,
            code: 'EACCES',
            message: 'permission denied',
        })),
        largeFiles: {
            threshold: 1,
            count: 3,
            bytes: 90,
            items: [file('x', 40), file('y', 30), file('z', 20)],
        },
        duplicates: {
            count: 2,
            files: 7,
            bytes: 50,
            wastedBytes: 35,
            items: [
                { hash: 'h1', bytes: 5, wastedBytes: 20, files: ['a', 'b', 'c', 'd', 'e'] },
                { hash: 'h2', bytes: 5, wastedBytes: 5, files: ['f', 'g'] },
            ],
        },
        emptyDirectories: { count: 1, items: ['hollow'] },
    };
}

describe('compactAnalysis', () => {
    it('cuts lists, keeps totals, and reports cuts in document order', () => {
        const out = compactAnalysis(result(), { limit: 2 });
        expect(out.extensions.map((e) => e.extension)).toEqual(['.a', '.b']);
        expect(out.errors).toHaveLength(2);
        expect(out.largeFiles).toMatchObject({ count: 3, bytes: 90 });
        expect(out.largeFiles?.items).toHaveLength(2);
        expect(out.duplicates?.items[0]).toEqual({
            hash: 'h1',
            bytes: 5,
            wastedBytes: 20,
            files: ['a', 'b'],
            omittedFiles: 3,
        });
        expect(out.duplicates?.items[1]).not.toHaveProperty('omittedFiles');
        expect(out.emptyDirectories).toEqual({ count: 1, items: ['hollow'] });
        expect(out.compact).toEqual({
            limit: 2,
            truncated: true,
            omitted: {
                extensions: 1,
                errors: 248,
                'largeFiles.items': 1,
                'duplicates.items[].files': 3,
            },
        });
        expect(Object.keys(out.compact!.omitted)).toEqual([
            'extensions',
            'errors',
            'largeFiles.items',
            'duplicates.items[].files',
        ]);
        expect(Object.keys(out).at(-1)).toBe('compact');
    });

    it('does not change its input', () => {
        const input = result();
        const copy = structuredClone(input);
        compactAnalysis(input, { limit: 1 });
        expect(input).toEqual(copy);
    });

    it('accepts 0 and rejects other invalid limits', () => {
        const out = compactAnalysis(result(), { limit: 0 });
        expect(out.duplicates?.items).toEqual([]);
        expect(out.compact?.omitted['duplicates.items']).toBe(2);
        for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => compactAnalysis(result(), { limit })).toThrow(RangeError);
        }
    });

    it('gives the same counts when applied twice', () => {
        const once = compactAnalysis(result(), { limit: 2 });
        const twice = compactAnalysis(once, { limit: 2 });
        expect(twice.compact).toEqual(once.compact);
        const narrower = compactAnalysis(once, { limit: 1 });
        expect(narrower.compact?.omitted).toMatchObject({
            extensions: 2,
            'duplicates.items': 1,
            'duplicates.items[].files': 4,
        });
    });
});
