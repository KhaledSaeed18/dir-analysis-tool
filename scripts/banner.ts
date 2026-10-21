/**
 * Renders the README banner from a real scan, analyzed with dat itself: a
 * treemap of the top-level folders of a large source tree (the published
 * banner uses a Linux kernel checkout), or of this repository's node_modules.
 *
 *   pnpm banner ~/src/linux --subject "The Linux kernel source tree"
 *   pnpm banner --packages         # this repository's node_modules, one tile per package
 *
 * Needs Google Chrome (or set CHROME to a Chromium binary) for the screenshot.
 */
import { execFileSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from '../src/core/analyze.ts';
import { DEFAULT_EXCLUDES } from '../src/core/exclude.ts';
import { formatBytes } from '../src/format/bytes.ts';
import { escapeHtml as e } from '../src/reporters/html.ts';
import type { Category } from '../src/types.ts';

const WIDTH = 1280;
const HEIGHT = 640;
const MAP = { x: 600, y: 0, w: WIDTH - 600, h: HEIGHT };
const SHOWN_TILES = 64;
const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    allowPositionals: true,
    options: { packages: { type: 'boolean' }, subject: { type: 'string' } },
});
const PACKAGES = flags.packages;
const SUBJECT = flags.subject;
const TARGET = positionals[0];
if ((!PACKAGES && !TARGET) || positionals.length > 1 || (PACKAGES && TARGET)) {
    process.stderr.write(
        'Usage: pnpm banner <directory> [--subject <caption>] | pnpm banner --packages\n'
    );
    process.exit(1);
}
/** IBM Plex Mono advances 0.6em per character. */
const CHAR_EM = 0.6;

const INK = '#15203A';
const COLORS: Partial<Record<Category, string>> & { rest: string } = {
    code: '#6E95DB',
    other: '#E8B04B',
    documents: '#A8B4C8',
    rest: '#33476E',
};

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface Tile {
    label: string;
    bytes: number;
    color: string;
    /** Largest entries inside the tile, drawn as subdivisions. */
    parts: number[];
}

/** Squarified treemap (Bruls, Huizing, van Wijk): keeps tiles close to square. */
function squarify(values: number[], rect: Rect): Rect[] {
    const total = values.reduce((sum, v) => sum + v, 0);
    const scale = (rect.w * rect.h) / total;
    const areas = values.map((v) => v * scale);
    const out: Rect[] = [];
    let { x, y, w, h } = rect;
    let i = 0;
    const worst = (row: number[], side: number): number => {
        const sum = row.reduce((s, a) => s + a, 0);
        const max = Math.max(...row);
        const min = Math.min(...row);
        return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
    };
    while (i < areas.length) {
        const side = Math.min(w, h);
        const row = [areas[i]!];
        let j = i + 1;
        while (j < areas.length && worst([...row, areas[j]!], side) <= worst(row, side)) {
            row.push(areas[j]!);
            j++;
        }
        const sum = row.reduce((s, a) => s + a, 0);
        if (w >= h) {
            const width = sum / h;
            let cy = y;
            for (const area of row) {
                out.push({ x, y: cy, w: width, h: area / width });
                cy += area / width;
            }
            x += width;
            w -= width;
        } else {
            const height = sum / w;
            let cx = x;
            for (const area of row) {
                out.push({ x: cx, y, w: area / height, h: height });
                cx += area / height;
            }
            y += height;
            h -= height;
        }
        i = j;
    }
    return out;
}

function packageName(dir: string): string {
    const match = /^(@?[^@]+)@/.exec(dir);
    return (match?.[1] ?? dir).replace('+', '/');
}

interface Collected {
    tiles: Tile[];
    files: number;
    directories: number;
    bytes: number;
    ms: number;
    /** What the tiles are: packages or folders. */
    unit: string;
    subject: string;
    legend: ReadonlyArray<readonly [string, string]>;
}

function dominant(types: Record<Category, { bytes: number }>): Category {
    return Object.entries(types).sort((a, b) => b[1].bytes - a[1].bytes)[0]![0] as Category;
}

function finish(tiles: Tile[], restLabel: string): Tile[] {
    tiles.sort((a, b) => b.bytes - a.bytes);
    const shown = tiles.slice(0, SHOWN_TILES);
    const rest = tiles.slice(SHOWN_TILES);
    if (rest.length > 0) {
        shown.push({
            label: `${rest.length} more ${restLabel}`,
            bytes: rest.reduce((s, p) => s + p.bytes, 0),
            color: COLORS.rest,
            parts: [],
        });
    }
    return shown;
}

/** One tile per package of this repository's node_modules. */
async function collectPackages(): Promise<Collected> {
    const root = join(import.meta.dirname, '..', 'node_modules', '.pnpm');
    const started = performance.now();
    const whole = await analyze(root, { defaultExcludes: false, top: 0 });
    const ms = performance.now() - started;
    const packages: Tile[] = [];
    for (const dir of await readdir(root)) {
        if (dir.startsWith('.') || dir === 'node_modules' || dir === 'lock.yaml') continue;
        const result = await analyze(join(root, dir), { defaultExcludes: false, top: 4 });
        if (result.summary.bytes === 0) continue;
        packages.push({
            label: packageName(dir),
            bytes: result.summary.bytes,
            color: COLORS[dominant(result.types)] ?? COLORS.documents!,
            parts: result.largestFiles.map((f) => f.bytes),
        });
    }
    return {
        tiles: finish(packages, ''),
        files: whole.summary.files,
        directories: packages.length,
        bytes: whole.summary.bytes,
        ms,
        unit: 'packages',
        subject: 'This repository’s node_modules',
        legend: [
            ['JavaScript and types', COLORS.code!],
            ['Native binaries', COLORS.other!],
            ['Smaller packages', COLORS.rest],
        ],
    };
}

/**
 * Sizes of the largest subfolders, for the lines inside a tile. A folder whose
 * size sits almost entirely in one child is looked at through that child, so
 * the lines show where the data actually lives.
 */
async function subfolderSizes(dir: string, depth = 0): Promise<number[]> {
    const result = await analyze(dir, { top: 0, tree: { depth: 1, limit: 6 } });
    const children = (result.tree?.children ?? []).filter((c) => c.type === 'directory');
    const [largest] = children;
    if (largest && largest.bytes >= result.summary.bytes * 0.9 && depth < 3) {
        return subfolderSizes(join(dir, largest.name), depth + 1);
    }
    return children.map((c) => c.bytes);
}

/** A folder holding more than this share of the tree is shown as its children. */
const SPLIT_SHARE = 0.07;

/**
 * One tile per folder, going deeper wherever one folder dominates, so the map
 * shows where the data actually lives instead of one giant block.
 */
async function collectTree(root: string): Promise<Collected> {
    const started = performance.now();
    const whole = await analyze(root, { top: 0 });
    const ms = performance.now() - started;
    const limit = whole.summary.bytes * SPLIT_SHARE;
    const folders: Tile[] = [];

    const visit = async (relative: string[]): Promise<void> => {
        const dir = join(root, ...relative);
        const result = await analyze(dir, { top: 0, tree: { depth: 1, limit: 1000 } });
        const children = (result.tree?.children ?? []).filter(
            (c) => c.type === 'directory' && !DEFAULT_EXCLUDES.includes(c.name)
        );
        // Keep a folder intact when most of its bytes are direct files.
        if (
            relative.length > 0 &&
            children.reduce((sum, child) => sum + child.bytes, 0) < result.summary.bytes * 0.5
        ) {
            folders.push({
                label: `${relative.join('/')}/`,
                bytes: result.summary.bytes,
                color: COLORS[dominant(result.types)] ?? COLORS.other!,
                parts: (result.tree?.children ?? []).map((child) => child.bytes),
            });
            return;
        }
        // Preserve bytes in direct files (and entries beyond the tree display limit).
        const remainder =
            result.summary.bytes - children.reduce((sum, child) => sum + child.bytes, 0);
        if (remainder > 0) {
            folders.push({
                label: `${relative.length ? `${relative.join('/')}/` : ''}files`,
                bytes: remainder,
                color: COLORS[dominant(result.types)] ?? COLORS.other!,
                parts: [],
            });
        }
        for (const child of children) {
            if (child.bytes === 0) continue;
            if (child.bytes > limit) {
                await visit([...relative, child.name]);
                continue;
            }
            const path = [...relative, child.name];
            const own = await analyze(join(root, ...path), { top: 0 });
            folders.push({
                label: `${path.join('/')}/`,
                bytes: own.summary.bytes,
                color: COLORS[dominant(own.types)] ?? COLORS.documents!,
                parts: await subfolderSizes(join(root, ...path)),
            });
        }
    };
    await visit([]);

    return {
        tiles: finish(folders, 'entries'),
        files: whole.summary.files,
        directories: whole.summary.directories,
        bytes: whole.summary.bytes,
        ms,
        unit: 'folders',
        subject: SUBJECT ?? `The ${basename(root)} source tree`,
        legend: [
            ['Source code', COLORS.code!],
            ['Documentation', COLORS.documents!],
            ['Other files', COLORS.other!],
        ],
    };
}

/**
 * Fits a package label into a tile: scoped names wrap after the scope, the
 * font shrinks once if needed, and only then is the last line truncated.
 */
function layoutLabel(
    tile: Tile,
    width: number,
    height: number
): { lines: string[]; size: number; height: number } | null {
    // "drivers/gpu/drm/amd/" becomes "drivers/" over "…/amd/"; packages wrap after the scope.
    const segments = tile.label.replace(/\/$/, '').split('/');
    const lines =
        segments.length === 1
            ? [tile.label]
            : segments.length === 2
              ? [`${segments[0]}/`, `${segments[1]}/`]
              : [`${segments[0]}/`, `…/${segments.at(-1)}/`];
    for (const size of [15, 13]) {
        const chars = Math.floor(width / (size * CHAR_EM));
        const total = 12 + (lines.length + 1) * size * 1.2 + 8;
        if (chars < 7 || total > height) continue;
        const fitted = lines.map((line) =>
            line.length > chars ? `${line.slice(0, chars - 1)}…` : line
        );
        const truncated = fitted.some((line, i) => line !== lines[i]);
        if (truncated && size === 15) continue;
        if (formatBytes(tile.bytes).length > chars) continue;
        return { lines: fitted, size, height: total };
    }
    return null;
}

function shade(hex: string, amount: number): string {
    const n = Number.parseInt(hex.slice(1), 16);
    const mix = (c: number, t: number): number => Math.round(c + (t - c) * amount);
    const ink = Number.parseInt(INK.slice(1), 16);
    const r = mix(n >> 16, ink >> 16);
    const g = mix((n >> 8) & 255, (ink >> 8) & 255);
    const b = mix(n & 255, ink & 255);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function renderMap(tiles: Tile[]): string {
    const GAP = 3;
    const rects = squarify(
        tiles.map((t) => t.bytes),
        MAP
    );
    return tiles
        .map((tile, i) => {
            const r = rects[i]!;
            const box = { x: r.x + GAP / 2, y: r.y + GAP / 2, w: r.w - GAP, h: r.h - GAP };
            if (box.w <= 0 || box.h <= 0) return '';
            let svg = `<rect x="${box.x.toFixed(2)}" y="${box.y.toFixed(2)}" width="${box.w.toFixed(2)}" height="${box.h.toFixed(2)}" rx="2" fill="${tile.color}"/>`;

            const fill = tile.color === COLORS.rest ? '#D5DDEC' : INK;
            const label = layoutLabel(tile, box.w - 24, box.h);
            if (label) {
                let y = box.y + 12 + label.size;
                for (const line of label.lines) {
                    svg += `<text x="${(box.x + 12).toFixed(2)}" y="${y.toFixed(2)}" font-size="${label.size}" class="tile" fill="${fill}">${e(line)}</text>`;
                    y += label.size * 1.2;
                }
                svg += `<text x="${(box.x + 12).toFixed(2)}" y="${(y + 2).toFixed(2)}" font-size="${label.size - 1}" class="size" fill="${fill}">${e(formatBytes(tile.bytes))}</text>`;
            }

            // Subdivide large tiles by their biggest files, below the label, like a real disk map.
            const header = label ? label.height + 8 : 0;
            const body = { x: box.x, y: box.y + header, w: box.w, h: box.h - header };
            if (tile.parts.length > 0 && body.w > 60 && body.h > 60) {
                const remainder = Math.max(
                    0,
                    tile.bytes - tile.parts.reduce((sum, part) => sum + part, 0)
                );
                const values = [...tile.parts, remainder].filter((v) => v > tile.bytes * 0.01);
                const stroke = shade(tile.color, 0.22);
                if (header > 0) {
                    svg += `<line x1="${body.x.toFixed(2)}" x2="${(body.x + body.w).toFixed(2)}" y1="${body.y.toFixed(2)}" y2="${body.y.toFixed(2)}" stroke="${stroke}" stroke-width="1"/>`;
                }
                svg += squarify(values, body)
                    .slice(0, -1)
                    .map(
                        (part) =>
                            `<rect x="${part.x.toFixed(2)}" y="${part.y.toFixed(2)}" width="${part.w.toFixed(2)}" height="${part.h.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="1"/>`
                    )
                    .join('');
            }
            return svg;
        })
        .join('');
}

function page(data: Collected): string {
    const n = (value: number): string => value.toLocaleString('en-US');
    const caption = `${e(data.subject)}, scanned by dat in ${Math.max(1, Math.round(data.ms))} ms.<br>${n(data.files)} files in ${n(data.directories)} ${data.unit}, ${formatBytes(data.bytes)}. Zero dependencies.`;
    const legend = data.legend;
    return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Schibsted+Grotesk:wght@400;500;700&display=block" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; background: ${INK}; overflow: hidden; }
  body { position: relative; color: #EEF2F8; font-family: 'Schibsted Grotesk', sans-serif; -webkit-font-smoothing: antialiased; }
  svg { position: absolute; inset: 0; }
  .tile { font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
  .size { font-family: 'IBM Plex Mono', monospace; font-weight: 400; opacity: .8; }
  .copy { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
  h1 { font-weight: 700; font-size: 54px; line-height: 1; letter-spacing: -0.025em; }
  p.lead { margin-top: 18px; font-size: 25px; line-height: 1.3; color: #B8C4D8; font-weight: 400; max-width: 420px; }
  .cmd { margin-top: 34px; align-self: flex-start; font: 500 18px 'IBM Plex Mono', monospace; color: #EEF2F8; border: 1px solid #34466B; border-radius: 6px; padding: 11px 16px 11px 14px; }
  .cmd span { color: #7F8FAD; margin-right: 10px; }
  .foot { position: absolute; left: 72px; bottom: 44px; width: 470px; }
  .legend { display: flex; gap: 22px; font-size: 14px; color: #B8C4D8; }
  .legend i { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 8px; vertical-align: -1px; }
  .caption { margin-top: 14px; font-size: 14.5px; line-height: 1.45; color: #7F8FAD; }
</style></head>
<body>
  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">${renderMap(data.tiles)}</svg>
  <div class="copy">
    <h1>dir-analysis-tool</h1>
    <p class="lead">Find out what is taking up space, and why.</p>
    <div class="cmd"><span>$</span>npx dir-analysis-tool</div>
  </div>
  <div class="foot">
    <div class="legend">${legend.map(([label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('')}</div>
    <p class="caption">${caption}</p>
  </div>
</body></html>`;
}

const data = PACKAGES ? await collectPackages() : await collectTree(resolve(TARGET!));
const html = join(tmpdir(), 'dat-banner.html');
await writeFile(html, page(data));
const output = join(import.meta.dirname, '..', '.github', 'assets', 'dir-analysis-tool-banner.png');
const chrome =
    process.env['CHROME'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
execFileSync(chrome, [
    '--headless',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    `--window-size=${WIDTH},${HEIGHT}`,
    '--virtual-time-budget=8000',
    `--screenshot=${output}`,
    `file://${html}`,
]);
process.stdout.write(`Wrote ${output}\n`);
