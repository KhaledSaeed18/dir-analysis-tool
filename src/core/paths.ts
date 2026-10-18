import { sep } from 'node:path';

/** Ordinal comparison, so output order never depends on the locale. */
export function comparePaths(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Joins an absolute native directory and a `/`-separated relative path. */
export function joinRelative(root: string, relative: string): string {
    if (!relative) return root;
    const native = sep === '/' ? relative : relative.replaceAll('/', sep);
    return root.endsWith(sep) ? root + native : root + sep + native;
}
