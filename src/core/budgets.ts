import { formatBytes, parseSize, unitsOf, type ByteUnits } from '../format/bytes.ts';
import type { AnalysisResult, BudgetMetric, BudgetOperator, BudgetResult } from '../types.ts';

/** A feature a metric depends on; requesting the metric turns the feature on. */
export type BudgetFeature = 'largeFiles' | 'duplicates' | 'empty' | 'stale';

interface MetricSpec {
    kind: 'size' | 'count';
    description: string;
    requires?: BudgetFeature;
    read: (result: AnalysisResult) => number;
}

export const BUDGET_METRICS: Readonly<Record<BudgetMetric, MetricSpec>> = {
    size: { kind: 'size', description: 'total apparent size', read: (r) => r.summary.bytes },
    disk: { kind: 'size', description: 'total size on disk', read: (r) => r.summary.diskBytes },
    files: { kind: 'count', description: 'number of files', read: (r) => r.summary.files },
    dirs: {
        kind: 'count',
        description: 'number of directories',
        read: (r) => r.summary.directories,
    },
    largest: {
        kind: 'size',
        description: 'size of the largest file',
        read: (r) => r.summary.largestFileBytes,
    },
    large: {
        kind: 'count',
        description: 'number of large files',
        requires: 'largeFiles',
        read: (r) => r.largeFiles?.count ?? 0,
    },
    duplicates: {
        kind: 'count',
        description: 'number of duplicate groups',
        requires: 'duplicates',
        read: (r) => r.duplicates?.count ?? 0,
    },
    wasted: {
        kind: 'size',
        description: 'space wasted by duplicates',
        requires: 'duplicates',
        read: (r) => r.duplicates?.wastedBytes ?? 0,
    },
    empty: {
        kind: 'count',
        description: 'number of empty files',
        requires: 'empty',
        read: (r) => r.emptyFiles?.count ?? 0,
    },
    stale: {
        kind: 'count',
        description: 'number of stale files',
        requires: 'stale',
        read: (r) => r.staleFiles?.count ?? 0,
    },
    errors: {
        kind: 'count',
        description: 'number of unreadable paths',
        read: (r) => r.summary.errors,
    },
};

export interface Budget {
    rule: string;
    metric: BudgetMetric;
    operator: BudgetOperator;
    limit: number;
}

const OPERATORS: Readonly<Record<string, BudgetOperator>> = {
    '<': '<',
    '<=': '<=',
    '>': '>',
    '>=': '>=',
    '=': '=',
    '==': '=',
    '!=': '!=',
};

function isBudgetMetric(value: string): value is BudgetMetric {
    return Object.hasOwn(BUDGET_METRICS, value);
}

const RULE_PATTERN = /^\s*([a-z]+)\s*(<=|>=|!=|==|<|>|=)\s*(\S.*?)\s*$/i;

/** Parses a rule such as `size<=500MB`, `duplicates=0`, or `files < 10000`. */
export function parseBudget(rule: string): Budget {
    const match = RULE_PATTERN.exec(rule);
    if (!match) {
        throw new RangeError(
            `Invalid budget "${rule}". Expected <metric><operator><value>, for example size<=500MB.`
        );
    }
    const metric = match[1]!.toLowerCase();
    if (!isBudgetMetric(metric)) {
        throw new RangeError(
            `Unknown budget metric "${match[1]}" in "${rule}". Known metrics: ${Object.keys(BUDGET_METRICS).join(', ')}.`
        );
    }
    const spec = BUDGET_METRICS[metric];
    const operator = OPERATORS[match[2]!]!;
    const raw = match[3]!;
    let limit: number;
    if (spec.kind === 'size') {
        limit = parseSize(raw);
    } else {
        limit = Number(raw.replaceAll(/[_,]/g, ''));
        if (!Number.isInteger(limit) || limit < 0) {
            throw new RangeError(
                `Budget "${rule}": ${metric} needs a whole number (got "${raw}").`
            );
        }
    }
    return { rule: rule.trim(), metric, operator, limit };
}

/** Features that must be enabled for the given budgets to be measurable. */
export function requiredFeatures(budgets: readonly Budget[]): Set<BudgetFeature> {
    const features = new Set<BudgetFeature>();
    for (const budget of budgets) {
        const required = BUDGET_METRICS[budget.metric].requires;
        if (required) features.add(required);
    }
    return features;
}

export function evaluateBudgets(
    budgets: readonly Budget[],
    result: AnalysisResult
): BudgetResult[] {
    return budgets.map((budget) => {
        const actual = BUDGET_METRICS[budget.metric].read(result);
        return { ...budget, actual, passed: compare(actual, budget.operator, budget.limit) };
    });
}

function compare(actual: number, operator: BudgetOperator, limit: number): boolean {
    switch (operator) {
        case '<':
            return actual < limit;
        case '<=':
            return actual <= limit;
        case '>':
            return actual > limit;
        case '>=':
            return actual >= limit;
        case '=':
            return actual === limit;
        case '!=':
            return actual !== limit;
    }
}

/**
 * Formats a budget's measured value for display. Sizes use the unit system of
 * the rule's own limit, so "size<=500MB" reads "actual 312 MB", not "297 MiB".
 */
export function formatBudgetActual(budget: BudgetResult, units: ByteUnits): string {
    if (BUDGET_METRICS[budget.metric].kind === 'count') {
        return budget.actual.toLocaleString('en-US');
    }
    return formatBytes(budget.actual, unitsOf(budget.limit, units));
}
