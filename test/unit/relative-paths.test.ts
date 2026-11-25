import { describe, expect, it } from 'vitest';
import { comparePaths } from '../../src/core/paths.ts';
import { compareRelativePaths } from '../../src/core/scanner.ts';

interface Dir {
    name: string;
    parent: number;
    depth: number;
}

/** The reference: build both paths, as `Scanner.relativePath` does, and compare the strings. */
function pathOf(dirs: Dir[], dir: number, name?: string): string {
    const parts: string[] = name === undefined ? [] : [name];
    for (let i = dir; i > 0; i = dirs[i]!.parent) parts.push(dirs[i]!.name);
    return parts.toReversed().join('/');
}

function tree(paths: string[]): Dir[] {
    const dirs: Dir[] = [{ name: '', parent: -1, depth: 0 }];
    const index = new Map<string, number>([['', 0]]);
    for (const path of paths) {
        let parent = 0;
        let sofar = '';
        for (const name of path.split('/')) {
            sofar = sofar ? `${sofar}/${name}` : name;
            let i = index.get(sofar);
            if (i === undefined) {
                i = dirs.push({ name, parent, depth: dirs[parent]!.depth + 1 }) - 1;
                index.set(sofar, i);
            }
            parent = i;
        }
    }
    return dirs;
}

/** A small seeded generator, so a failure reproduces. */
function random(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const sign = (n: number): number => Math.sign(n);

describe('compareRelativePaths (#31)', () => {
    // Characters on both sides of '/' (0x2F), a non-ASCII letter, the last BMP
    // code unit and an astral character (a surrogate pair).
    const ALPHABET = ['a', 'b', '-', '.', '0', ' ', '_', 'é', '￿', '\u{1f600}'];

    it('agrees with comparing the built paths on random trees', () => {
        const next = random(31);
        const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
        const word = (): string =>
            Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(ALPHABET)).join('');

        for (let round = 0; round < 20; round++) {
            const dirs: Dir[] = [{ name: '', parent: -1, depth: 0 }];
            const used = new Map<number, Set<string>>();
            const unique = (dir: number): string => {
                let names = used.get(dir);
                if (!names) used.set(dir, (names = new Set()));
                let name = word();
                while (names.has(name)) name = word();
                names.add(name);
                return name;
            };
            for (let i = 0; i < 60; i++) {
                // Mostly deepen the newest folders, so chains get long.
                const parent = next() < 0.7 ? dirs.length - 1 : Math.floor(next() * dirs.length);
                dirs.push({ name: unique(parent), parent, depth: dirs[parent]!.depth + 1 });
            }
            const entries: Array<[number, string | undefined]> = [];
            for (let d = 0; d < dirs.length; d++) {
                entries.push([d, undefined]);
                for (let f = 0; f < 2; f++) entries.push([d, unique(d)]);
            }
            const wrong: string[] = [];
            for (const [dirA, nameA] of entries) {
                for (const [dirB, nameB] of entries) {
                    const a = pathOf(dirs, dirA, nameA);
                    const b = pathOf(dirs, dirB, nameB);
                    const actual = sign(compareRelativePaths(dirs, dirA, nameA, dirB, nameB));
                    if (actual !== sign(comparePaths(a, b))) wrong.push(`${a} vs ${b}: ${actual}`);
                }
            }
            expect(wrong).toEqual([]);
        }
    });

    it.each([
        // '/' sorts after '-' and '.', so a folder is not simply ordered by its name.
        ['a/b', undefined, 'a-b', 'c'],
        ['a/b', undefined, 'a.b', undefined],
        ['a', 'x', 'a0', undefined],
        // A folder sorts before everything inside it, and a name ends where '/' would follow.
        ['a', undefined, 'a', 'b'],
        ['a/b', 'c', 'a', 'b'],
        ['', undefined, '', 'a'],
        ['', 'a', 'a', 'b'],
        ['deep/er/st', 'f', 'deep', 'f'],
        ['x', '￿', 'x', '\u{1f600}'],
    ])('%s + %s against %s + %s', (dirA, nameA, dirB, nameB) => {
        const dirs = tree([dirA, dirB].filter(Boolean));
        const find = (path: string): number =>
            path === '' ? 0 : dirs.findIndex((_, i) => i > 0 && pathOf(dirs, i) === path);
        const a = find(dirA);
        const b = find(dirB);
        const expected = sign(comparePaths(pathOf(dirs, a, nameA), pathOf(dirs, b, nameB)));
        expect(expected).not.toBe(0);
        expect(sign(compareRelativePaths(dirs, a, nameA, b, nameB))).toBe(expected);
        expect(sign(compareRelativePaths(dirs, b, nameB, a, nameA))).toBe(-expected);
        expect(compareRelativePaths(dirs, a, nameA, a, nameA)).toBe(0);
    });
});
