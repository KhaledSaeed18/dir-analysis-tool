import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BufferPool } from '../../src/core/content.ts';
import {
    findDuplicates,
    hashFileOfSize,
    type DuplicateCandidate,
} from '../../src/core/duplicates.ts';
import {
    hashJobs,
    HashPool,
    WORKER_BUFFER_BYTES,
    workerCount,
    type HashJob,
} from '../../src/core/hash-pool.ts';
import { AbortError } from '../../src/errors.ts';
import { bytes, fixture, isRoot, isWindows } from '../helpers/fixture.ts';

const KIB = 1024;

interface Candidate extends DuplicateCandidate {
    path: string;
}

/** A tree with copies, same-size files that differ, and large files whose samples match. */
async function tree(): Promise<string> {
    const big = bytes(600 * KIB, 7);
    const bigMiddle = Buffer.from(big);
    bigMiddle[300 * KIB] = bigMiddle[300 * KIB]! ^ 0xff;
    const entries: Record<string, Buffer | string | { hardlink: string }> = {
        'big/a.bin': big,
        'big/b.bin': Buffer.from(big),
        // Same first and last 64 KiB as a.bin: only the full hash tells them apart.
        'big/middle.bin': bigMiddle,
        'big/other.bin': bytes(600 * KIB, 8),
        'link/a': 'linked contents',
        'link/b': { hardlink: 'link/a' },
    };
    for (let g = 0; g < 12; g++) {
        for (let c = 0; c < 3; c++) {
            entries[`small/g${g}/copy${c}.txt`] = `group ${g} `.repeat(g + 1);
        }
        // Same size as the copies, different bytes.
        entries[`small/g${g}/lookalike.txt`] = `GROUP ${g} `.repeat(g + 1);
    }
    entries['edge/exact.bin'] = bytes(256 * KIB, 3);
    entries['edge/exact-copy.bin'] = bytes(256 * KIB, 3);
    return fixture(entries);
}

async function candidates(root: string, paths: string[]): Promise<Candidate[][]> {
    const bySize = new Map<number, Candidate[]>();
    for (const path of paths) {
        const full = join(root, path);
        const stats = await lstat(full);
        const candidate: Candidate = {
            dir: 0,
            name: path,
            path: full,
            bytes: stats.size,
            dev: stats.dev,
            ino: stats.ino,
            nlink: stats.nlink,
        };
        const group = bySize.get(stats.size);
        if (group) group.push(candidate);
        else bySize.set(stats.size, [candidate]);
    }
    return [...bySize.values()];
}

function filesIn(root: string, dir = ''): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...filesIn(root, rel));
        else out.push(rel);
    }
    return out;
}

/** Groups as sorted path lists with their hash, independent of completion order. */
function normalize(groups: Array<{ hash: string; members: Candidate[] }>): string[] {
    return groups
        .map(
            (g) =>
                `${g.hash} ${g.members
                    .map((m) => m.name)
                    .sort()
                    .join(',')}`
        )
        .sort();
}

async function run(
    root: string,
    workers: number,
    extra: Partial<Parameters<typeof findDuplicates<Candidate>>[1]> = {}
): Promise<{ groups: string[]; errors: string[] }> {
    const errors: string[] = [];
    const groups = await findDuplicates(await candidates(root, filesIn(root)), {
        pathOf: (c) => c.path,
        concurrency: 8,
        workers,
        workerThreshold: 1,
        onError: (c, error) =>
            errors.push(`${c.name} ${(error as NodeJS.ErrnoException).code ?? 'none'}`),
        ...extra,
    });
    return { groups: normalize(groups), errors: errors.sort() };
}

describe('hashJobs, the worker side (#32)', () => {
    it('hashes exactly as the main thread does, for every kind of file', async () => {
        const root = await tree();
        const buffer = Buffer.allocUnsafe(WORKER_BUFFER_BYTES);
        const pool = new BufferPool(WORKER_BUFFER_BYTES);
        for (const name of ['big/a.bin', 'edge/exact.bin', 'small/g3/copy0.txt']) {
            const path = join(root, name);
            const size = fs.statSync(path).size;
            const [digest] = hashJobs([[path, size, false]], fs, crypto, buffer);
            expect(digest).toBe(await hashFileOfSize(path, size, pool));
            expect(digest).toBe(crypto.hash('sha256', fs.readFileSync(path), 'hex'));
        }
    });

    it('hashes the whole file when it changed size since the scan', async () => {
        const root = await tree();
        const path = join(root, 'big/a.bin');
        const whole = crypto.hash('sha256', fs.readFileSync(path), 'hex');
        const buffer = Buffer.allocUnsafe(WORKER_BUFFER_BYTES);
        // Measured smaller (it grew) and larger (it shrank) than it is now.
        const results = hashJobs(
            [
                [path, 10, false],
                [path, 10 * 1024 * KIB, false],
            ],
            fs,
            crypto,
            buffer
        );
        expect(results).toEqual([whole, whole]);
    });

    it('samples the first and last 64 KiB', async () => {
        const root = await tree();
        const buffer = Buffer.allocUnsafe(WORKER_BUFFER_BYTES);
        const size = 600 * KIB;
        const [a, middle, other] = hashJobs(
            ['big/a.bin', 'big/middle.bin', 'big/other.bin'].map((name): HashJob => [
                join(root, name),
                size,
                true,
            ]),
            fs,
            crypto,
            buffer
        );
        const data = fs.readFileSync(join(root, 'big/a.bin'));
        const expected = crypto
            .createHash('sha256')
            .update(data.subarray(0, 64 * KIB))
            .update(data.subarray(size - 64 * KIB))
            .digest('hex');
        expect(a).toBe(expected);
        expect(middle).toBe(a);
        expect(other).not.toBe(a);
    });

    it('reports a file it cannot read with its code, and goes on', async () => {
        const root = await tree();
        const buffer = Buffer.allocUnsafe(WORKER_BUFFER_BYTES);
        const ok = join(root, 'small/g0/copy0.txt');
        const results = hashJobs(
            [
                [join(root, 'missing'), 3, false],
                [join(root, 'small'), 3, false],
                [ok, fs.statSync(ok).size, false],
            ],
            fs,
            crypto,
            buffer
        );
        expect(results[0]).toMatchObject({ code: 'ENOENT' });
        expect(results[1]).toMatchObject({ message: expect.any(String) });
        expect(results[2]).toBe(crypto.hash('sha256', fs.readFileSync(ok), 'hex'));
    });
});

describe('HashPool (#32)', () => {
    it('returns each batch in job order, from any worker', async () => {
        const root = await tree();
        const paths = filesIn(root).filter((p) => p.startsWith('small/'));
        const pool = new HashPool(3);
        try {
            const batches = await Promise.all(
                paths.map((p) =>
                    pool.run([[join(root, p), fs.statSync(join(root, p)).size, false]])
                )
            );
            const expected = paths.map((p) =>
                crypto.hash('sha256', fs.readFileSync(join(root, p)), 'hex')
            );
            expect(batches.flat()).toEqual(expected);
        } finally {
            await pool.close();
        }
    });

    it('rejects work once it is closed', async () => {
        const pool = new HashPool(1);
        await pool.close(new Error('stopped'));
        await expect(pool.run([['x', 1, false]])).rejects.toThrow('stopped');
    });

    it('starts at most four workers, and never more than the concurrency', () => {
        expect(workerCount(1)).toBe(1);
        expect(workerCount(100)).toBeLessThanOrEqual(4);
        expect(workerCount(100)).toBeGreaterThanOrEqual(1);
    });
});

describe('findDuplicates with and without workers (#32)', () => {
    it('finds the same groups either way', async () => {
        const root = await tree();
        const inProcess = await run(root, 0);
        const withWorkers = await run(root, 2);
        expect(withWorkers).toEqual(inProcess);
        // 12 small groups of three copies, the large pair, and the 256 KiB pair.
        expect(inProcess.groups).toHaveLength(14);
        expect(inProcess.groups.some((g) => g.includes('big/a.bin,big/b.bin'))).toBe(true);
        expect(inProcess.groups.some((g) => g.includes('middle'))).toBe(false);
        expect(inProcess.groups.some((g) => g.includes('link/'))).toBe(false);
    });

    it('only starts workers for a stage with enough files', async () => {
        const root = await tree();
        expect(await run(root, 2, { workerThreshold: 1_000_000 })).toEqual(await run(root, 0));
    });

    it.skipIf(isWindows || isRoot)('records the same error either way', async () => {
        const root = await tree();
        fs.chmodSync(join(root, 'small/g2/copy1.txt'), 0o000);
        try {
            const inProcess = await run(root, 0);
            expect(inProcess.errors).toEqual(['small/g2/copy1.txt EACCES']);
            expect(await run(root, 2)).toEqual(inProcess);
        } finally {
            fs.chmodSync(join(root, 'small/g2/copy1.txt'), 0o644);
        }
    });

    it('stops with AbortError when aborted', async () => {
        const root = await tree();
        const controller = new AbortController();
        let calls = 0;
        const result = run(root, 2, {
            signal: controller.signal,
            onProgress: () => {
                if (++calls === 3) controller.abort();
            },
        });
        await expect(result).rejects.toBeInstanceOf(AbortError);
    });
});
