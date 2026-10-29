#!/usr/bin/env node
// Builds the directory trees used by the dir-analysis-tool skill evals (see evals.json).
//
//   node make-fixtures.mjs [directory]           create the fixtures (default: <tmp>/dat-skill-evals)
//   node make-fixtures.mjs --verify [directory]  check that no fixture file was changed or deleted
//
// Plain Node.js, no dependencies. File contents are generated from fixed seeds, so every run
// produces byte-identical trees and the expected numbers in evals.json always hold. Fixtures are
// generated rather than committed because they need a `.git` folder and git-ignored files.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const KiB = 1024;
const MiB = 1024 * KiB;
const MANIFEST = 'manifest.json';
/** Old enough to be stale under the default `--stale 1y`. */
const OLD = new Date('2023-01-15T12:00:00Z');

/**
 * Every fixture file: path -> content. `{ size, seed }` is pseudo-random data; equal seeds and
 * sizes give identical files (intentional duplicates), different seeds never collide.
 * @type {Record<string, string | { size: number, seed: number, mtime?: Date }>}
 */
const FILES = {
    // A project whose disk usage is dominated by things outside the source.
    'repo-size/.git/HEAD': 'ref: refs/heads/main\n',
    'repo-size/.git/objects/pack/pack-4f1c.pack': { size: 3 * MiB, seed: 101 },
    'repo-size/node_modules/heavy-lib/dist/heavy.js': { size: 1 * MiB, seed: 102 },
    'repo-size/.gitignore': 'dist/\n*.log\n',
    'repo-size/README.md': '# Example project\n\nUsed by the dir-analysis-tool skill evals.\n',
    'repo-size/src/index.js': { size: 6 * KiB, seed: 103 },
    'repo-size/src/util.js': { size: 3 * KiB, seed: 104 },
    'repo-size/assets/video/intro.mp4': { size: 2 * MiB, seed: 105 },
    'repo-size/assets/images/hero.png': { size: 256 * KiB, seed: 106 },
    'repo-size/dist/bundle.js': { size: 512 * KiB, seed: 107 },
    'repo-size/logs/debug.log': { size: 64 * KiB, seed: 108, mtime: OLD },

    // Copies, near-misses, and tiny duplicates.
    'duplicates/photos/2024/IMG_0001.jpg': { size: 300 * KiB, seed: 201 },
    'duplicates/photos/2024/IMG_0002.jpg': { size: 300 * KiB, seed: 202 },
    'duplicates/backup/IMG_0001 copy.jpg': { size: 300 * KiB, seed: 201 },
    'duplicates/export/final.jpg': { size: 300 * KiB, seed: 201 },
    'duplicates/docs/report.pdf': { size: 120 * KiB, seed: 203 },
    'duplicates/docs/report (1).pdf': { size: 120 * KiB, seed: 203 },
    'duplicates/docs/notes.txt': { size: 1 * KiB, seed: 204 },
    'duplicates/icons/check.svg': { size: 200, seed: 205 },
    'duplicates/icons/check-old.svg': { size: 200, seed: 205 },
    'duplicates/empty/a.txt': '',
    'duplicates/empty/b.txt': '',

    // A build output with a size budget, plus a project config that adds its own budget.
    'budgets/.dir-analyzer.json': '{\n    "budgets": ["size<=1MB"]\n}\n',
    'budgets/dist/app.js': { size: 180 * KiB, seed: 301 },
    'budgets/dist/vendor.js': { size: 700 * KiB, seed: 302 },
    'budgets/dist/app.js.map': { size: 400 * KiB, seed: 303 },
    'budgets/dist/styles.css': { size: 40 * KiB, seed: 304 },
    'budgets/dist/logo.svg': { size: 8 * KiB, seed: 305 },
};

/** Deterministic pseudo-random bytes (xorshift32), the same generator as the test suite. */
function bytes(size, seed) {
    const buffer = Buffer.alloc(size);
    let state = seed >>> 0 || 1;
    for (let i = 0; i < size; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        buffer[i] = state & 0xff;
    }
    return buffer;
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function create(root) {
    if (existsSync(root)) {
        const entries = await readdir(root);
        if (entries.length > 0 && !entries.includes(MANIFEST)) {
            throw new Error(
                `${root} is not empty and was not created by this script; refusing to overwrite it.`
            );
        }
        await rm(root, { recursive: true, force: true });
    }
    const manifest = {};
    for (const [path, spec] of Object.entries(FILES)) {
        const target = join(root, ...path.split('/'));
        const content = typeof spec === 'string' ? Buffer.from(spec) : bytes(spec.size, spec.seed);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
        if (typeof spec !== 'string' && spec.mtime) await utimes(target, spec.mtime, spec.mtime);
        manifest[path] = { bytes: content.length, sha256: sha256(content) };
    }
    await writeFile(join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Fixtures written to ${root}\n`);
    for (const name of ['repo-size', 'duplicates', 'budgets']) {
        process.stdout.write(`  ${join(root, name)}\n`);
    }
}

async function verify(root) {
    const manifest = JSON.parse(await readFile(join(root, MANIFEST), 'utf8'));
    const problems = [];
    for (const [path, expected] of Object.entries(manifest)) {
        const target = join(root, ...path.split('/'));
        if (!existsSync(target) || !(await stat(target)).isFile()) {
            problems.push(`missing: ${path}`);
        } else if (sha256(await readFile(target)) !== expected.sha256) {
            problems.push(`changed: ${path}`);
        }
    }
    if (problems.length > 0) {
        process.stderr.write(`${problems.join('\n')}\n`);
        process.exitCode = 1;
        return;
    }
    process.stdout.write(`All ${Object.keys(manifest).length} fixture files are unchanged.\n`);
}

const args = process.argv.slice(2);
const verifying = args[0] === '--verify';
const root = resolve(args[verifying ? 1 : 0] ?? join(tmpdir(), 'dat-skill-evals'));
try {
    await (verifying ? verify(root) : create(root));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
