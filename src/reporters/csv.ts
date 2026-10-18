import { CATEGORIES, type AnalysisResult, type ComparisonResult } from '../types.ts';

/**
 * Quotes a CSV cell when needed (RFC 4180) and neutralizes spreadsheet
 * formula injection: text starting with `=`, `+`, `-`, `@`, tab, or carriage
 * return is prefixed with an apostrophe so it is never evaluated.
 */
export function csvCell(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    let text = value;
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(header: string[], rows: Array<Array<string | number | null>>): string {
    // CRLF line endings and a UTF-8 byte order mark keep Excel happy with non-ASCII paths.
    return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * Flattens an analysis into one table. The `section` column tells rows apart:
 * summary, type, extension, largest-directory, largest-file, large-file,
 * duplicate, empty-file, empty-directory, stale-file, and error.
 */
export function renderAnalysisCsv(result: AnalysisResult): string {
    const rows: Array<Array<string | number | null>> = [];
    const s = result.summary;
    rows.push(['summary', result.root, s.bytes, s.files, null, null]);
    for (const c of CATEGORIES) {
        rows.push(['type', c, result.types[c].bytes, result.types[c].files, null, null]);
    }
    for (const e of result.extensions) {
        rows.push(['extension', e.extension, e.bytes, e.files, null, null]);
    }
    for (const d of result.largestDirectories) {
        rows.push(['largest-directory', d.path, d.bytes, d.files, null, null]);
    }
    for (const f of result.largestFiles) {
        rows.push(['largest-file', f.path, f.bytes, 1, f.modified, null]);
    }
    for (const f of result.largeFiles?.items ?? []) {
        rows.push(['large-file', f.path, f.bytes, 1, f.modified, null]);
    }
    result.duplicates?.items.forEach((group, i) => {
        for (const path of group.files) {
            rows.push(['duplicate', path, group.bytes, 1, null, `${i + 1}:${group.hash}`]);
        }
    });
    for (const f of result.emptyFiles?.items ?? []) {
        rows.push(['empty-file', f.path, 0, 1, f.modified, null]);
    }
    for (const d of result.emptyDirectories?.items ?? []) {
        rows.push(['empty-directory', d, 0, 0, null, null]);
    }
    for (const f of result.staleFiles?.items ?? []) {
        rows.push(['stale-file', f.path, f.bytes, 1, f.modified, null]);
    }
    for (const e of result.errors) rows.push(['error', e.path, null, null, null, e.code]);
    return csv(['section', 'item', 'bytes', 'files', 'modified', 'group'], rows);
}

/** Flattens a comparison: one row per added, removed, or changed file. */
export function renderComparisonCsv(result: ComparisonResult): string {
    const rows: Array<Array<string | number | null>> = [];
    for (const f of result.added.items) rows.push(['added', f.path, null, f.bytes, f.bytes]);
    for (const f of result.removed.items) rows.push(['removed', f.path, f.bytes, null, -f.bytes]);
    for (const c of result.changed.items) {
        rows.push(['changed', c.path, c.leftBytes, c.rightBytes, c.delta]);
    }
    return csv(['change', 'path', 'left_bytes', 'right_bytes', 'delta'], rows);
}
