import { formatBudgetActual } from '../core/budgets.ts';
import { formatBytes, unitsOf, type ByteUnits } from '../format/bytes.ts';
import { formatElapsed } from '../format/time.ts';
import { formatCount, formatPercent, plural } from '../format/text.ts';
import {
    CATEGORIES,
    type AnalysisResult,
    type Category,
    type FileEntry,
    type TreeNode,
} from '../types.ts';

export interface HtmlOptions {
    units?: ByteUnits;
    /** Maximum rows per table. Default: 500. */
    limit?: number;
}

/** Duplicate groups listed in the HTML report; the full list is in JSON and CSV. */
const DUPLICATE_GROUPS_SHOWN = 100;

const CATEGORY_COLORS: Record<Category, string> = {
    code: '#6366f1',
    documents: '#0ea5e9',
    images: '#10b981',
    videos: '#f43f5e',
    audio: '#f59e0b',
    archives: '#8b5cf6',
    fonts: '#ec4899',
    data: '#14b8a6',
    other: '#94a3b8',
};

export function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

const e = escapeHtml;

/**
 * Renders a fully self-contained HTML report: no external requests, no
 * frameworks, charts drawn with inline SVG. A Content-Security-Policy blocks
 * all network access, so the file is safe to open and share offline.
 */
export function renderAnalysisHtml(result: AnalysisResult, options: HtmlOptions = {}): string {
    const units = options.units ?? 'iec';
    const limit = options.limit ?? 500;
    const b = (n: number): string => formatBytes(n, units);
    const sum = result.summary;
    const sections: string[] = [];

    const truncatedNote = (shown: number, total: number): string =>
        total > shown
            ? `<p class="muted">Showing ${formatCount(shown)} of ${formatCount(total)}. Use <code>--format json</code> for the full list.</p>`
            : '';

    const fileTable = (items: FileEntry[], total: number, showModified = false): string => {
        const shown = items.slice(0, limit);
        const max = shown[0]?.bytes ?? 0;
        return `<table class="filterable"><thead><tr><th class="num">Size</th><th>Path</th>${showModified ? '<th>Modified</th>' : ''}</tr></thead><tbody>${shown
            .map(
                (f) =>
                    `<tr><td class="num">${e(b(f.bytes))}</td><td class="path">${meter(f.bytes, max)}<span>${e(f.path)}</span></td>${showModified ? `<td class="muted date">${e(f.modified.slice(0, 10))}</td>` : ''}</tr>`
            )
            .join('')}</tbody></table>${truncatedNote(shown.length, total)}`;
    };

    if (result.budgets && result.budgets.length > 0) {
        const failed = result.budgets.filter((x) => !x.passed).length;
        sections.push(
            section(
                'Budgets',
                failed > 0 ? `${failed} failed` : 'all passed',
                `<ul class="budgets">${result.budgets
                    .map((x) => {
                        const actual = formatBudgetActual(x, units);
                        return `<li class="${x.passed ? 'pass' : 'fail'}"><span>${x.passed ? '✔' : '✘'}</span><code>${e(x.rule)}</code><span class="muted">actual ${e(actual)}</span></li>`;
                    })
                    .join('')}</ul>`
            )
        );
    }

    const types = CATEGORIES.filter((c) => result.types[c].files > 0).sort(
        (x, y) => result.types[y].bytes - result.types[x].bytes
    );
    if (types.length > 0) {
        sections.push(
            section(
                'File types',
                plural(types.length, 'category', 'categories'),
                `<div class="types">${donut(types.map((c) => ({ value: result.types[c].bytes, color: CATEGORY_COLORS[c] })))}<table><thead><tr><th>Type</th><th class="num">Size</th><th class="num">Share</th><th class="num">Files</th></tr></thead><tbody>${types
                    .map(
                        (c) =>
                            `<tr><td><span class="swatch" style="background:${CATEGORY_COLORS[c]}"></span>${c.charAt(0).toUpperCase()}${c.slice(1)}</td><td class="num">${e(b(result.types[c].bytes))}</td><td class="num">${formatPercent(result.types[c].bytes, sum.bytes)}</td><td class="num">${formatCount(result.types[c].files)}</td></tr>`
                    )
                    .join('')}</tbody></table></div>`
            )
        );
    }

    if (result.largestDirectories.length > 0) {
        const max = result.largestDirectories[0]!.bytes;
        sections.push(
            section(
                'Largest folders',
                '',
                `<table class="filterable"><thead><tr><th class="num">Size</th><th>Folder</th><th class="num">Files</th></tr></thead><tbody>${result.largestDirectories
                    .map(
                        (d) =>
                            `<tr><td class="num">${e(b(d.bytes))}</td><td class="path">${meter(d.bytes, max)}<span>${e(d.path)}/</span></td><td class="num">${formatCount(d.files)}</td></tr>`
                    )
                    .join('')}</tbody></table>`
            )
        );
    }
    if (result.largestFiles.length > 0) {
        sections.push(
            section(
                'Largest files',
                '',
                fileTable(result.largestFiles, result.largestFiles.length, true)
            )
        );
    }
    if (result.extensions.length > 0) {
        const shown = result.extensions.slice(0, 25);
        sections.push(
            section(
                'Extensions',
                plural(result.extensions.length, 'extension'),
                `<table class="filterable"><thead><tr><th>Extension</th><th class="num">Size</th><th class="num">Share</th><th class="num">Files</th></tr></thead><tbody>${shown
                    .map(
                        (x) =>
                            `<tr><td><code>${e(x.extension || '(none)')}</code></td><td class="num">${e(b(x.bytes))}</td><td class="num">${formatPercent(x.bytes, sum.bytes)}</td><td class="num">${formatCount(x.files)}</td></tr>`
                    )
                    .join(
                        ''
                    )}</tbody></table>${truncatedNote(shown.length, result.extensions.length)}`
            )
        );
    }
    if (result.largeFiles) {
        const lf = result.largeFiles;
        sections.push(
            section(
                `Large files ≥ ${formatBytes(lf.threshold, unitsOf(lf.threshold, units))}`,
                lf.count > 0 ? `${plural(lf.count, 'file')} · ${b(lf.bytes)}` : 'none',
                lf.count > 0 ? fileTable(lf.items, lf.count, true) : ''
            )
        );
    }
    if (result.duplicates) {
        const d = result.duplicates;
        // Groups are long to scan, so fewer are shown than other lists; JSON and CSV have them all.
        const groups = d.items.slice(0, Math.min(limit, DUPLICATE_GROUPS_SHOWN));
        sections.push(
            section(
                'Duplicates',
                d.count > 0
                    ? `${plural(d.count, 'group')} · ${b(d.wastedBytes)} reclaimable`
                    : 'none found',
                groups
                    .map(
                        (g) =>
                            `<details class="group"><summary><strong>${e(b(g.wastedBytes))}</strong> <span class="muted">${g.files.length} × ${e(b(g.bytes))}</span> <span class="path first">${e(g.files[0]!)}</span>${g.files.length > 1 ? ` <span class="muted">and ${g.files.length - 1} more</span>` : ''}</summary><ul>${g.files
                                .map((f) => `<li class="path">${e(f)}</li>`)
                                .join(
                                    ''
                                )}</ul><p class="muted hash">sha256 ${e(g.hash)}</p></details>`
                    )
                    .join('') + truncatedNote(groups.length, d.count)
            )
        );
    }
    if (result.emptyFiles || result.emptyDirectories) {
        const files = result.emptyFiles?.items ?? [];
        const dirs = result.emptyDirectories?.items ?? [];
        const list = (items: string[]): string =>
            `<ul class="plain">${items
                .slice(0, limit)
                .map((p) => `<li class="path">${e(p)}</li>`)
                .join('')}</ul>${truncatedNote(Math.min(limit, items.length), items.length)}`;
        sections.push(
            section(
                'Empty files and folders',
                `${plural(files.length, 'file')} · ${plural(dirs.length, 'folder')}`,
                `${files.length > 0 ? `<h3>Files</h3>${list(files.map((f) => f.path))}` : ''}${dirs.length > 0 ? `<h3>Folders</h3>${list(dirs.map((d) => `${d}/`))}` : ''}`
            )
        );
    }
    if (result.staleFiles) {
        const sf = result.staleFiles;
        sections.push(
            section(
                `Not modified since ${sf.modifiedBefore.slice(0, 10)}`,
                sf.count > 0 ? `${plural(sf.count, 'file')} · ${b(sf.bytes)}` : 'none',
                sf.count > 0 ? fileTable(sf.items, sf.count, true) : ''
            )
        );
    }
    if (result.tree) {
        sections.push(
            section(
                'Tree',
                '',
                `<div class="tree">${treeHtml(result.tree, result.tree.bytes, b, true)}</div>`
            )
        );
    }
    if (result.errors.length > 0) {
        sections.push(
            section(
                'Unreadable paths',
                plural(sum.errors, 'path'),
                `<table><thead><tr><th>Code</th><th>Path</th><th>Reason</th></tr></thead><tbody>${result.errors
                    .map(
                        (x) =>
                            `<tr><td><code>${e(x.code)}</code></td><td class="path">${e(x.path)}</td><td class="muted">${e(x.message)}</td></tr>`
                    )
                    .join('')}</tbody></table>`
            )
        );
    }

    const cards: Array<[string, string, (string | undefined)?]> = [
        [
            'Size',
            b(sum.bytes),
            sum.diskBytes !== sum.bytes ? `${b(sum.diskBytes)} on disk` : undefined,
        ],
        ['Files', formatCount(sum.files)],
        ['Folders', formatCount(sum.directories)],
        ['Largest file', b(sum.largestFileBytes)],
    ];
    if (result.duplicates) {
        cards.push([
            'Reclaimable',
            b(result.duplicates.wastedBytes),
            plural(result.duplicates.count, 'duplicate group'),
        ]);
    }
    const skipped = [
        sum.excluded > 0 ? `${formatCount(sum.excluded)} excluded` : '',
        sum.filtered > 0 ? `${formatCount(sum.filtered)} filtered` : '',
        sum.errors > 0 ? `${formatCount(sum.errors)} unreadable` : '',
    ].filter(Boolean);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<meta name="generator" content="dir-analysis-tool ${e(result.tool.version)}">
<title>${e(baseName(result.root))} · Directory analysis</title>
<style>${CSS}</style>
</head>
<body>
<header>
<p class="eyebrow">Directory analysis</p>
<h1>${e(baseName(result.root))}</h1>
<p class="path root">${e(result.root)}</p>
<p class="muted">Generated ${e(result.startedAt.replace('T', ' ').slice(0, 19))} UTC · scanned in ${e(formatElapsed(result.durationMs))}${skipped.length > 0 ? ` · ${e(skipped.join(' · '))}` : ''}</p>
</header>
<main>
<div class="cards">${cards
        .map(
            ([label, value, note]) =>
                `<div class="card"><p class="label">${e(label)}</p><p class="value">${e(value)}</p>${note ? `<p class="muted">${e(note)}</p>` : ''}</div>`
        )
        .join('')}</div>
<input id="filter" type="search" placeholder="Filter paths…" aria-label="Filter paths">
${sections.join('\n')}
</main>
<footer>Generated by <a href="https://github.com/KhaledSaeed18/dir-analysis-tool">dir-analysis-tool</a> v${e(result.tool.version)}</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function section(title: string, detail: string, body: string): string {
    return `<section><h2>${e(title)}${detail ? ` <span class="muted">${e(detail)}</span>` : ''}</h2>${body}</section>`;
}

function meter(value: number, max: number): string {
    const pct = max > 0 ? Math.max(0.5, (value / max) * 100) : 0;
    return `<i class="meter" style="width:${pct.toFixed(1)}%"></i>`;
}

function donut(segments: Array<{ value: number; color: string }>): string {
    const total = segments.reduce((s, x) => s + x.value, 0);
    if (total === 0) return '';
    let offset = 25; // start at 12 o'clock
    const circles = segments
        .filter((x) => x.value > 0)
        .map((x) => {
            const pct = (x.value / total) * 100;
            const circle = `<circle r="15.9155" cx="21" cy="21" fill="none" stroke="${x.color}" stroke-width="6" stroke-dasharray="${pct.toFixed(3)} ${(100 - pct).toFixed(3)}" stroke-dashoffset="${offset.toFixed(3)}"></circle>`;
            offset = (offset - pct + 100) % 100;
            return circle;
        })
        .join('');
    return `<svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Size by file type">${circles}</svg>`;
}

function treeHtml(
    node: TreeNode,
    rootBytes: number,
    b: (n: number) => string,
    open: boolean
): string {
    const label = `<span class="num">${e(b(node.bytes))}</span><span class="share">${formatPercent(node.bytes, rootBytes)}</span><span class="path">${e(node.type === 'directory' && node.path ? `${node.name}/` : node.name)}</span>`;
    if (!node.children || node.children.length === 0) return `<div class="leaf">${label}</div>`;
    const omitted = node.omitted
        ? `<div class="leaf muted"><span class="num">${e(b(node.omitted.bytes))}</span><span class="share"></span><span>… ${plural(node.omitted.entries, 'more entry', 'more entries')}</span></div>`
        : '';
    return `<details${open ? ' open' : ''}><summary>${label}</summary>${node.children.map((c) => treeHtml(c, rootBytes, b, false)).join('')}${omitted}</details>`;
}

function baseName(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? path;
}

const CSS = `
:root{--bg:#f8fafc;--panel:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#6366f1;--meter:rgba(99,102,241,.14);--ok:#059669;--bad:#dc2626;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--panel:#121a2e;--text:#e2e8f0;--muted:#94a3b8;--line:#1f2a44;--accent:#818cf8;--meter:rgba(129,140,248,.18);--ok:#34d399;--bad:#f87171}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header,main,footer{max-width:1100px;margin:0 auto;padding:0 24px}
header{padding-top:40px;padding-bottom:8px}
.eyebrow{margin:0;color:var(--accent);font-weight:600;text-transform:uppercase;letter-spacing:.08em;font-size:12px}
h1{margin:4px 0;font-size:32px;letter-spacing:-.02em}
h2{font-size:18px;margin:0 0 16px}
h3{font-size:14px;margin:16px 0 8px;color:var(--muted)}
.muted{color:var(--muted);font-weight:400}
code,.path,.num{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.root{word-break:break-all;margin:0 0 4px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:24px 0}
.card,section{background:var(--panel);border:1px solid var(--line);border-radius:12px}
.card{padding:16px}
.card p{margin:0}
.label{color:var(--muted);font-size:13px}
.value{font-size:24px;font-weight:650;letter-spacing:-.01em}
section{padding:20px;margin:16px 0}
#filter{width:100%;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);font:inherit}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.num{text-align:right;white-space:nowrap}
td.path{position:relative;word-break:break-all}
td.date{white-space:nowrap}
td.path span{position:relative}
.meter{position:absolute;left:0;top:4px;bottom:4px;background:var(--meter);border-radius:4px}
.types{display:grid;grid-template-columns:180px 1fr;gap:24px;align-items:center}
.donut{width:180px;height:180px;transform:rotate(0)}
.swatch{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px}
.group{border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:8px 0}
.group summary{cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.group .first{margin-left:6px}
.group ul,.plain{margin:8px 0 0;padding-left:18px}
.hash{font-family:ui-monospace,monospace;font-size:11px;margin:6px 0 0;word-break:break-all}
.budgets{list-style:none;padding:0;margin:0}
.budgets li{display:flex;gap:12px;align-items:center;padding:6px 0}
.pass span:first-child{color:var(--ok)}.fail span:first-child{color:var(--bad)}.fail code{color:var(--bad)}
.tree details>details,.tree details>.leaf{margin-left:22px}
.tree summary,.tree .leaf{display:flex;gap:12px;padding:3px 0;cursor:default}
.tree summary{cursor:pointer;list-style:none}
.tree summary::-webkit-details-marker{display:none}
.tree summary::before,.tree .leaf::before{content:'';width:12px;flex:none;color:var(--muted)}
.tree summary::before{content:'▸'}
.tree details[open]>summary::before{content:'▾'}
.tree .num{min-width:84px}.tree .share{min-width:40px;color:var(--muted);font-size:12px;text-align:right}
.hidden{display:none}
footer{padding:24px;color:var(--muted);font-size:13px;text-align:center}
a{color:var(--accent)}
@media (max-width:640px){.types{grid-template-columns:1fr}.donut{margin:0 auto}}
`;

const SCRIPT = `
document.getElementById('filter').addEventListener('input', function (event) {
  var query = event.target.value.toLowerCase();
  document.querySelectorAll('table.filterable tbody tr, .group, .plain li').forEach(function (row) {
    row.classList.toggle('hidden', query !== '' && row.textContent.toLowerCase().indexOf(query) === -1);
  });
});
`;
