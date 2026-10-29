import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../src/types.ts';
import { VERSION } from '../../src/version.ts';
import { cli, json } from '../helpers/cli.ts';

const exec = promisify(execFile);

const SKILL = join(import.meta.dirname, '..', '..', 'skills', 'dir-analysis-tool');
const MAKE_FIXTURES = join(SKILL, '..', 'evals', 'dir-analysis-tool', 'make-fixtures.mjs');

async function text(relPath: string): Promise<string> {
    // Windows checkouts may convert line endings.
    return (await readFile(join(SKILL, relPath), 'utf8')).replaceAll('\r\n', '\n');
}

/** The frontmatter's top-level `key: value` pairs; enough for the fields the spec requires. */
function frontmatter(markdown: string): Record<string, string> {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
    if (!match?.[1]) throw new Error('SKILL.md has no frontmatter');
    const fields: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
        const field = /^([a-z-]+):\s*(.*)$/.exec(line);
        if (field?.[1] !== undefined) fields[field[1]] = field[2] ?? '';
    }
    return fields;
}

describe('agent skill: SKILL.md', () => {
    it('has valid Agent Skills frontmatter', async () => {
        const fields = frontmatter(await text('SKILL.md'));
        expect(fields['name']).toBe('dir-analysis-tool');
        expect(fields['name']).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        const description = fields['description'] ?? '';
        expect(description.length).toBeGreaterThan(50);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/[<>]/);
        expect((fields['compatibility'] ?? '').length).toBeLessThanOrEqual(500);
    });

    it('requires a released CLI version and asks npx for it explicitly', async () => {
        const skill = await text('SKILL.md');
        const floor =
            /written for dir-analysis-tool \*\*(\d+)\.(\d+) or later, below (\d+)\*\*/.exec(skill);
        expect(floor).not.toBeNull();
        const [major, minor, below] = (floor?.slice(1) ?? []).map(Number);
        // A plain "@3" lets npx reuse an older cached 3.x, so the range must carry the floor.
        expect(skill).toContain(`npx --yes "dir-analysis-tool@^${major}.${minor}" --version`);
        expect(below).toBe((major ?? 0) + 1);
        const [ownMajor, ownMinor] = VERSION.split('.').map(Number);
        expect(major).toBe(ownMajor);
        expect(minor).toBeLessThanOrEqual(ownMinor ?? 0);
    });

    it('links only to files that exist', async () => {
        const skill = await text('SKILL.md');
        const links = [...skill.matchAll(/\]\(([^)#]+)\)/g)]
            .map((m) => m[1] ?? '')
            .filter((target) => !/^[a-z]+:/.test(target));
        expect(links.length).toBeGreaterThan(0);
        expect(links.filter((target) => !existsSync(join(SKILL, target)))).toEqual([]);
    });

    it('only uses options the CLI documents', async () => {
        const help = (
            await Promise.all(
                [['--help'], ['analyze', '--help'], ['compare', '--help']].map(async (args) => {
                    const result = await cli(args);
                    return result.stdout;
                })
            )
        ).join('\n');
        // Flags that belong to other programs in the examples.
        const foreign = new Set(['--yes', '--verify']);
        const docs = (await text('SKILL.md')) + (await text('references/json-output.md'));
        const flags = new Set(docs.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? []);
        expect(flags.size).toBeGreaterThan(10);
        const unknown = [...flags].filter(
            (flag) => !foreign.has(flag) && !new RegExp(`${flag}(?![\\w-])`).test(help)
        );
        expect(unknown).toEqual([]);
    });
});

describe('agent skill: eval fixtures', () => {
    let root: string;

    beforeAll(async () => {
        root = join(await mkdtemp(join(tmpdir(), 'dat-skill-')), 'fixtures');
        await exec(process.execPath, [MAKE_FIXTURES, root]);
    });

    afterAll(async () => {
        await rm(join(root, '..'), { recursive: true, force: true });
    });

    async function analyze(args: string[]): Promise<{ code: number; data: AnalysisResult }> {
        const result = await cli([...args, '--json']);
        return { code: result.code, data: json<AnalysisResult>(result) };
    }

    it('evals.json states the numbers these tests measure', async () => {
        const evals = await readFile(join(MAKE_FIXTURES, '..', 'evals.json'), 'utf8');
        const parsed = JSON.parse(evals) as { skill_name: string; evals: { prompt: string }[] };
        expect(parsed.skill_name).toBe('dir-analysis-tool');
        expect(parsed.evals.every((e) => e.prompt.includes('{fixtures}'))).toBe(true);
        const measured = [
            7_152_735, 614_400, 122_880, 737_280, 737_480, 1_359_872, 716_800, 950_272,
        ];
        const missing = measured.filter((n) => !evals.includes(n.toLocaleString('en-US')));
        expect(missing).toEqual([]);
    });

    it('repo-size: matches the expected breakdown', async () => {
        const dir = join(root, 'repo-size');
        const all = await analyze([dir, '--all', '-t', '--tree-depth', '1', '-n', '15']);
        expect(all.data.summary.bytes).toBe(7_152_735);
        const top = Object.fromEntries(
            all.data.tree?.children?.map((c) => [c.path, c.bytes]) ?? []
        );
        expect(top).toMatchObject({
            '.git': 3_145_749,
            assets: 2_359_296,
            node_modules: 1_048_576,
            dist: 524_288,
            logs: 65_536,
        });

        const defaults = await analyze([dir]);
        expect(defaults.data.summary).toMatchObject({ bytes: 2_958_410, files: 8, excluded: 2 });
        expect(defaults.data.largestFiles[0]).toMatchObject({
            path: 'assets/video/intro.mp4',
            bytes: 2_097_152,
        });

        const tracked = await analyze([dir, '-g']);
        expect(tracked.data.summary.bytes).toBe(2_958_410 - 524_288 - 65_536);
        expect(tracked.data.largestFiles.map((f) => f.path)).not.toContain('dist/bundle.js');

        const stale = await analyze([dir, '--stale', '1y']);
        expect(stale.data.staleFiles?.items.map((f) => f.path)).toEqual(['logs/debug.log']);
    });

    it('duplicates: finds the copies, not the look-alikes', async () => {
        const dir = join(root, 'duplicates');
        const { data } = await analyze([dir, '-d']);
        expect(data.duplicates).toMatchObject({ count: 3, wastedBytes: 737_480 });
        expect(data.duplicates?.items.map((g) => [g.wastedBytes, g.files])).toEqual([
            [614_400, ['backup/IMG_0001 copy.jpg', 'export/final.jpg', 'photos/2024/IMG_0001.jpg']],
            [122_880, ['docs/report (1).pdf', 'docs/report.pdf']],
            [200, ['icons/check-old.svg', 'icons/check.svg']],
        ]);
        const listed = data.duplicates?.items.flatMap((g) => g.files) ?? [];
        expect(listed).not.toContain('photos/2024/IMG_0002.jpg');
        expect(listed).not.toContain('empty/a.txt');

        // Every group is in the JSON even when --top shortens the other lists.
        const short = await analyze([dir, '-d', '-n', '1']);
        expect(short.data.duplicates?.items).toHaveLength(3);

        const filtered = await analyze([dir, '-d', '--min-duplicate-size', '10KiB']);
        expect(filtered.data.duplicates).toMatchObject({ count: 2, wastedBytes: 737_280 });
    });

    it('budgets: the project config adds a rule, and exit code 2 reports failures', async () => {
        const dist = join(root, 'budgets', 'dist');
        const { code, data } = await analyze([dist, '-b', 'size<=1.5MB', '-b', 'largest<=500kB']);
        expect(code).toBe(2);
        expect(data.budgets?.map((b) => [b.rule, b.actual, b.passed])).toEqual([
            ['size<=1MB', 1_359_872, false],
            ['size<=1.5MB', 1_359_872, true],
            ['largest<=500kB', 716_800, false],
        ]);

        const isolated = await analyze([dist, '--no-config', '-b', 'size<=1.5MB']);
        expect(isolated.code).toBe(0);
        expect(isolated.data.budgets).toHaveLength(1);

        const noMaps = await analyze([dist, '--no-config', '-e', '*.map', '-b', 'size<=1MB']);
        expect(noMaps.code).toBe(0);
        expect(noMaps.data.summary.bytes).toBe(950_272);
    });

    it('verify mode detects changed and deleted files', async () => {
        const verify = (): Promise<{ stdout: string }> =>
            exec(process.execPath, [MAKE_FIXTURES, '--verify', root]);
        expect((await verify()).stdout).toContain('unchanged');

        const copy = join(root, 'duplicates', 'export', 'final.jpg');
        const original = await readFile(copy);
        await writeFile(copy, 'edited');
        await expect(verify()).rejects.toMatchObject({
            stderr: expect.stringContaining('changed: duplicates/export/final.jpg'),
        });
        await writeFile(copy, original);
        expect((await verify()).stdout).toContain('unchanged');
    });

    it('refuses to overwrite a directory it did not create', async () => {
        const other = await mkdtemp(join(tmpdir(), 'dat-skill-other-'));
        try {
            await writeFile(join(other, 'precious.txt'), 'keep me');
            await expect(exec(process.execPath, [MAKE_FIXTURES, other])).rejects.toMatchObject({
                stderr: expect.stringContaining('refusing to overwrite'),
            });
            expect(await readFile(join(other, 'precious.txt'), 'utf8')).toBe('keep me');
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });
});
