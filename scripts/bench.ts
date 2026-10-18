/**
 * Benchmarks a scan on a synthetic tree, or on a directory you pass in.
 *
 *   pnpm bench                       # synthetic tree, 20,000 files
 *   pnpm bench --files 100000        # bigger synthetic tree
 *   pnpm bench ~/some/directory      # a real directory
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from '../src/core/analyze.ts';
import { formatBytes } from '../src/format/bytes.ts';
import type { AnalysisResult } from '../src/types.ts';

const { values, positionals } = parseArgs({
    // `pnpm bench -- <args>` forwards a literal "--".
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    allowPositionals: true,
    options: {
        files: { type: 'string', default: '20000' },
        runs: { type: 'string', default: '3' },
    },
});

async function synthesize(count: number): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'dat-bench-'));
    const perDir = 50;
    for (let i = 0; i < count; i++) {
        const dir = join(
            root,
            `d${Math.floor(i / perDir / 20)}`,
            `s${Math.floor(i / perDir) % 20}`
        );
        if (i % perDir === 0) await mkdir(dir, { recursive: true });
        // Every 10th file shares content with another, so duplicate detection has work to do.
        const content = i % 10 === 0 ? `shared-${i % 100}` : `file-${i}-${'x'.repeat(i % 512)}`;
        await writeFile(join(dir, `f${i}.txt`), content);
    }
    return root;
}

const target = positionals[0] ?? (await synthesize(Number(values.files)));
const synthetic = positionals[0] === undefined;
const runs = Number(values.runs);

for (const duplicates of [false, true]) {
    const times: number[] = [];
    const measure = async (): Promise<AnalysisResult> => {
        const started = performance.now();
        const result = await analyze(target, { duplicates, defaultExcludes: !synthetic });
        times.push(performance.now() - started);
        return result;
    };
    const result = await measure();
    for (let i = 1; i < runs; i++) await measure();
    const best = Math.min(...times);
    console.log(
        `${duplicates ? 'scan + duplicates' : 'scan'}: best ${best.toFixed(0)} ms of ${runs} · ` +
            `${result.summary.files.toLocaleString('en-US')} files · ${formatBytes(result.summary.bytes)} · ` +
            `${Math.round(result.summary.files / (best / 1000)).toLocaleString('en-US')} files/s`
    );
}
console.log(`peak RSS ${formatBytes(process.memoryUsage().rss)}`);
if (synthetic) await rm(target, { recursive: true, force: true });
