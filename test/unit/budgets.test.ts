import { describe, expect, it } from 'vitest';
import { evaluateBudgets, parseBudget, requiredFeatures } from '../../src/core/budgets.ts';
import type { AnalysisResult } from '../../src/types.ts';

describe('parseBudget', () => {
    it('parses sizes, counts, and operators', () => {
        expect(parseBudget('size<=500MB')).toEqual({
            rule: 'size<=500MB',
            metric: 'size',
            operator: '<=',
            limit: 500_000_000,
        });
        expect(parseBudget(' files < 10,000 ')).toMatchObject({
            metric: 'files',
            operator: '<',
            limit: 10_000,
        });
        expect(parseBudget('duplicates==0')).toMatchObject({ operator: '=', limit: 0 });
        expect(parseBudget('Largest != 1k')).toMatchObject({
            metric: 'largest',
            operator: '!=',
            limit: 1024,
        });
    });

    it.each([
        ['nonsense', /Invalid budget/],
        ['speed<1', /Unknown budget metric/],
        ['files<1.5', /whole number/],
        ['size<huge', /Invalid size/],
    ])('rejects %s', (rule, message) => {
        expect(() => parseBudget(rule)).toThrow(message);
    });
});

describe('budgets', () => {
    const result = {
        summary: {
            bytes: 2000,
            diskBytes: 4096,
            files: 3,
            directories: 1,
            largestFileBytes: 1500,
            errors: 0,
        },
        duplicates: { count: 1, wastedBytes: 100 },
        largeFiles: { count: 2 },
        emptyFiles: { count: 0 },
        staleFiles: { count: 4 },
    } as unknown as AnalysisResult;

    it('evaluates every operator', () => {
        const rules = [
            'size<=2000',
            'size<2000',
            'files>2',
            'files>=4',
            'dirs=1',
            'errors!=0',
            'disk>4k',
            'largest<2k',
        ];
        expect(evaluateBudgets(rules.map(parseBudget), result).map((b) => b.passed)).toEqual([
            true,
            false,
            true,
            false,
            true,
            false,
            false,
            true,
        ]);
    });

    it('reads optional reports and lists the features they need', () => {
        const budgets = ['duplicates=0', 'wasted<1k', 'large<=2', 'empty=0', 'stale<5'].map(
            parseBudget
        );
        expect(evaluateBudgets(budgets, result).map((b) => [b.actual, b.passed])).toEqual([
            [1, false],
            [100, true],
            [2, true],
            [0, true],
            [4, true],
        ]);
        expect([...requiredFeatures(budgets)].sort()).toEqual([
            'duplicates',
            'empty',
            'largeFiles',
            'stale',
        ]);
        const bare = { summary: result.summary } as unknown as AnalysisResult;
        expect(evaluateBudgets(budgets, bare).map((b) => b.actual)).toEqual([0, 0, 0, 0, 0]);
    });
});
