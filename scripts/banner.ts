/**
 * Renders the README banner from a real scan: a treemap of this
 * repository's node_modules, analyzed with dat itself.
 *
 *   pnpm install && pnpm banner
 *
 * Needs Google Chrome (or set CHROME to a Chromium binary) for the screenshot.
 */
import { execFileSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../src/core/analyze.ts';
import { formatBytes } from '../src/format/bytes.ts';
import { escapeHtml as e } from '../src/reporters/html.ts';
import type { Category } from '../src/types.ts';

const WIDTH = 1280;
const HEIGHT = 640;
const MAP = { x: 600, y: 0, w: WIDTH - 600, h: HEIGHT };
const SHOWN_PACKAGES = 64;
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
    /** Largest files inside the package, drawn as subdivisions. */
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

async function collect(): Promise<{
    tiles: Tile[];
    files: number;
    bytes: number;
    ms: number;
    packages: number;
}> {
    const root = join(import.meta.dirname, '..', 'node_modules', '.pnpm');
    const started = performance.now();
    const whole = await analyze(root, { defaultExcludes: false, top: 0 });
    const ms = performance.now() - started;
    const packages: Tile[] = [];
    for (const dir of await readdir(root)) {
        if (dir.startsWith('.') || dir === 'node_modules' || dir === 'lock.yaml') continue;
        const result = await analyze(join(root, dir), { defaultExcludes: false, top: 4 });
        if (result.summary.bytes === 0) continue;
        const [category] = Object.entries(result.types).sort((a, b) => b[1].bytes - a[1].bytes)[0]!;
        packages.push({
            label: packageName(dir),
            bytes: result.summary.bytes,
            color: COLORS[category as Category] ?? COLORS.documents!,
            parts: result.largestFiles.map((f) => f.bytes),
        });
    }
    packages.sort((a, b) => b.bytes - a.bytes);
    const shown = packages.slice(0, SHOWN_PACKAGES);
    const rest = packages.slice(SHOWN_PACKAGES);
    shown.push({
        label: `${rest.length} more`,
        bytes: rest.reduce((s, p) => s + p.bytes, 0),
        color: COLORS.rest,
        parts: [],
    });
    return {
        tiles: shown,
        files: whole.summary.files,
        bytes: whole.summary.bytes,
        ms,
        packages: packages.length,
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
    const slash = tile.label.indexOf('/');
    const lines =
        tile.label.startsWith('@') && slash > 0
            ? [tile.label.slice(0, slash + 1), tile.label.slice(slash + 1)]
            : [tile.label];
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

function page(data: Awaited<ReturnType<typeof collect>>): string {
    const caption = `This repository’s node_modules, scanned by dat in ${Math.max(1, Math.round(data.ms))} ms.<br>${data.packages} packages, ${data.files.toLocaleString('en-US')} files, ${formatBytes(data.bytes)}.`;
    const legend = [
        ['JavaScript and types', COLORS.code],
        ['Native binaries', COLORS.other],
        ['Smaller packages', COLORS.rest],
    ] as const;
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

const data = await collect();
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
