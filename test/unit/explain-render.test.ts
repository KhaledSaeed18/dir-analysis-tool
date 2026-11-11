import { describe, expect, it } from 'vitest';
import type {
    ExplainReason,
    ExplainSource,
    PathExplanation,
    SkipsExplanation,
} from '../../src/core/explain.ts';
import { createStyle } from '../../src/format/style.ts';
import { renderPathExplanation, renderSkipsExplanation } from '../../src/reporters/explain.ts';

const settings = {
    exclude: [],
    defaultExcludes: true,
    gitignore: false,
    maxDepth: null,
    followSymlinks: false,
    countHardlinks: false,
    minSize: null,
    maxSize: null,
    modifiedAfter: null,
    modifiedBefore: null,
};

function reason(source: ExplainSource, extra: Partial<ExplainReason> = {}): ExplainReason {
    return {
        source,
        at: 'dir',
        ancestor: false,
        file: null,
        line: null,
        rule: null,
        index: null,
        limit: null,
        actual: null,
        code: null,
        ...extra,
    };
}

function path(
    decision: PathExplanation['decision'],
    why: ExplainReason | null,
    type: PathExplanation['type'] = 'directory'
): PathExplanation {
    return {
        explainVersion: 1,
        root: '/r',
        path: 'dir',
        type,
        decision,
        reason: why,
        descendants: null,
        notes: [],
        ignoreCase: false,
        settings,
    };
}

describe('renderPathExplanation', () => {
    it.each([
        [reason('default', { rule: 'node_modules' }), 'default exclude node_modules'],
        [reason('pattern', { rule: '*.log', index: 1 }), 'exclude pattern 2  *.log'],
        [
            reason('info-exclude', { file: '.git/info/exclude', line: 3, rule: 'x' }),
            '.git/info/exclude:3  x',
        ],
        [
            reason('date', {
                rule: 'modifiedBefore',
                limit: '2024-01-01T00:00:00.000Z',
                actual: '2025-01-01T00:00:00.000Z',
            }),
            '--older-than 2024-01-01T00:00:00.000Z; modified 2025',
        ],
        [
            reason('max-depth', { limit: 1, actual: 2, ancestor: true }),
            '--max-depth 1; dir is at depth 2',
        ],
        [reason('symlink'), 'symbolic link; counted, not followed'],
        [reason('symlink', { code: 'ENOENT' }), 'symbolic link to nothing (ENOENT)'],
        [reason('special-file'), 'special file'],
        [reason('error', { code: 'EACCES' }), 'EACCES: could not read dir'],
        [reason('unknown'), 'no single rule identified'],
    ])('describes %o', (why, expected) => {
        const text = renderPathExplanation(path('skipped', why));
        expect(text).toContain(expected);
    });

    it('marks unvisited directories, and not symbolic links', () => {
        expect(renderPathExplanation(path('excluded', reason('default')))).toContain(
            'not measured'
        );
        expect(renderPathExplanation(path('skipped', reason('symlink'), 'symlink'))).not.toContain(
            'not measured'
        );
    });

    it('colors the decision', () => {
        const style = createStyle(true);
        expect(renderPathExplanation(path('included', null), { style })).toContain('\u001b[32m');
        expect(renderPathExplanation(path('not-found', null, null), { style })).toContain(
            '\u001b[33m'
        );
        expect(renderPathExplanation(path('excluded', reason('default')), { style })).toContain(
            '\u001b[31m'
        );
    });
});

describe('renderSkipsExplanation', () => {
    const base: SkipsExplanation = {
        explainVersion: 1,
        root: '/r',
        totals: { excluded: 0, filtered: 1, depthSkipped: 2, symlinks: 1, hardlinks: 0, errors: 1 },
        groups: [
            {
                source: 'max-depth',
                file: null,
                line: null,
                rule: 'maxDepth',
                index: null,
                limit: 1,
                count: 2,
                entries: ['a/b', 'a/c'],
                truncated: false,
            },
            {
                source: 'date',
                file: null,
                line: null,
                rule: 'modifiedAfter',
                index: null,
                limit: '2024-01-01T00:00:00.000Z',
                count: 1,
                entries: ['x'],
                truncated: false,
            },
            {
                source: 'symlink',
                file: null,
                line: null,
                rule: null,
                index: null,
                limit: null,
                count: 1,
                entries: ['l'],
                truncated: false,
            },
            {
                source: 'unknown',
                file: null,
                line: null,
                rule: null,
                index: null,
                limit: null,
                count: 0,
                entries: [],
                truncated: false,
            },
        ],
        errors: [{ path: 'locked', code: 'EACCES', message: 'permission denied' }],
        notes: [],
        limit: 20,
        ignoreCase: false,
        settings,
    };

    it('summarizes every kind of skip', () => {
        const text = renderSkipsExplanation(base);
        expect(text).toContain(
            'Skipped: 1 file filtered, 2 directories beyond --max-depth, 1 symbolic link not followed, 1 entry unreadable'
        );
        expect(text).toContain('--max-depth 1');
        expect(text).toContain('--newer-than 2024-01-01');
        expect(text).toContain('symbolic links (not followed)');
        expect(text).toContain('no single rule identified');
        expect(text).toMatch(/Unreadable\n\s+locked\s+EACCES/);
    });
});
