import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findConfigFile, loadConfig } from '../../src/config/load.ts';
import { buildJsonSchema, CONFIG_FIELDS, validateConfig } from '../../src/config/schema.ts';
import { DatError } from '../../src/errors.ts';
import { fixture } from '../helpers/fixture.ts';

describe('validateConfig', () => {
    it('accepts every documented key', () => {
        const config = {
            $schema: 'x',
            exclude: ['*.log'],
            defaultExcludes: false,
            gitignore: true,
            maxDepth: 3,
            followSymlinks: true,
            countHardlinks: false,
            minSize: '1k',
            maxSize: 1024,
            newerThan: '30d',
            olderThan: '2024-01-01',
            top: 5,
            largeFiles: '50MB',
            duplicates: true,
            minDuplicateSize: '4k',
            empty: true,
            stale: '2y',
            extensions: true,
            tree: true,
            treeDepth: 2,
            units: 'si',
            budgets: ['size<=1GB'],
        };
        const result = validateConfig(config);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        const { $schema: _ignored, ...rest } = config;
        expect(result.config).toEqual(rest);
    });

    it('reports each invalid value precisely', () => {
        const result = validateConfig({
            top: -1,
            gitignore: 'yes',
            largeFiles: 'big',
            stale: 5,
            newerThan: 'whenever',
            exclude: 'a',
            units: 'metric',
            budgets: ['speed<1'],
            minSize: [],
        });
        expect(result.errors).toHaveLength(9);
        expect(result.errors.join('\n')).toMatch(
            /"top" must be an integer of at least 0 \(got -1\)/
        );
        expect(result.errors.join('\n')).toMatch(/"units" must be one of "iec", "si"/);
    });

    it('translates v1 and v2 keys with deprecation warnings', () => {
        const result = validateConfig({
            excludePatterns: ['tmp'],
            clearDefaultExclusions: true,
            largeSizeThresholdMB: 50,
            enableDuplicateDetection: true,
            topN: 3,
            showEmptyFiles: true,
            maxDepth: -1,
            enableProgressBar: true,
            outputFormat: 'table',
            mystery: 1,
        });
        expect(result.errors).toEqual([]);
        expect(result.config).toEqual({
            exclude: ['tmp'],
            defaultExcludes: false,
            largeFiles: '50MiB',
            duplicates: true,
            top: 3,
            empty: true,
        });
        expect(result.warnings).toHaveLength(9);
        expect(result.warnings).toContain('unknown key "mystery" ignored');
    });

    it('maps the v1 byte threshold', () => {
        expect(validateConfig({ largeSizeThreshold: 5000 }).config).toEqual({ largeFiles: 5000 });
    });

    it('rejects non-objects', () => {
        expect(validateConfig([]).errors).toHaveLength(1);
        expect(validateConfig(null).errors).toHaveLength(1);
    });
});

describe('schema.json', () => {
    it('is generated from the config fields and committed up to date', async () => {
        const schema = buildJsonSchema();
        const properties = schema['properties'] as Record<string, unknown>;
        expect(Object.keys(properties).sort()).toEqual(
            ['$schema', ...Object.keys(CONFIG_FIELDS)].sort()
        );
        const committed: unknown = JSON.parse(
            await readFile(join(import.meta.dirname, '../../schema.json'), 'utf8')
        );
        expect(committed).toEqual(schema);
    });
});

describe('loadConfig', () => {
    it('discovers the nearest config walking up', async () => {
        const root = await fixture({
            '.dir-analyzer.json': JSON.stringify({ top: 3 }),
            'a/b/file.txt': 'x',
            'a/dir-analyzer.config.json': JSON.stringify({ top: 4 }),
        });
        expect(findConfigFile(join(root, 'a', 'b'))).toBe(
            join(root, 'a', 'dir-analyzer.config.json')
        );
        expect((await loadConfig({ searchFrom: root })).config).toEqual({ top: 3 });
    });

    it('returns an empty config when nothing is found', async () => {
        const root = await fixture({ 'x.txt': 'x' });
        const loaded = await loadConfig({ searchFrom: root });
        expect(loaded.path === null || !loaded.path.startsWith(root)).toBe(true);
    });

    it('fails loudly on missing, malformed, or invalid files', async () => {
        const root = await fixture({
            'bad.json': '{ nope',
            'invalid.json': JSON.stringify({ top: 'many' }),
        });
        await expect(
            loadConfig({ searchFrom: root, file: join(root, 'missing.json') })
        ).rejects.toThrow(/not found/);
        await expect(
            loadConfig({ searchFrom: root, file: join(root, 'bad.json') })
        ).rejects.toThrow(/Invalid JSON/);
        const error = await loadConfig({
            searchFrom: root,
            file: join(root, 'invalid.json'),
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DatError);
        expect((error as DatError).message).toMatch(/"top" must be an integer/);
        expect((error as DatError).hint).toMatch(/dat init/);
    });

    it('prefixes warnings with the file path', async () => {
        const root = await fixture({});
        const file = join(root, 'c.json');
        await writeFile(file, JSON.stringify({ topN: 2 }));
        const loaded = await loadConfig({ searchFrom: root, file });
        expect(loaded.warnings[0]).toContain(file);
        expect(loaded.config).toEqual({ top: 2 });
    });
});
