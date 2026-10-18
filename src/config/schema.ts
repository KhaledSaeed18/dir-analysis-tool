import { parseBudget } from '../core/budgets.ts';
import { parseSize } from '../format/bytes.ts';
import { parsePointInTime } from '../format/time.ts';
import { errorMessage } from '../errors.ts';

/** Settings accepted in a config file. CLI flags always take precedence. */
export interface DatConfig {
    exclude?: string[];
    defaultExcludes?: boolean;
    gitignore?: boolean;
    maxDepth?: number;
    followSymlinks?: boolean;
    countHardlinks?: boolean;
    minSize?: string | number;
    maxSize?: string | number;
    newerThan?: string;
    olderThan?: string;
    top?: number;
    largeFiles?: boolean | string | number;
    duplicates?: boolean;
    minDuplicateSize?: string | number;
    empty?: boolean;
    stale?: boolean | string;
    extensions?: boolean;
    tree?: boolean;
    treeDepth?: number;
    units?: 'iec' | 'si';
    budgets?: string[];
}

type FieldType =
    | { kind: 'boolean' }
    | { kind: 'integer'; min: number }
    | { kind: 'size'; allowBoolean?: boolean }
    | { kind: 'time'; allowBoolean?: boolean }
    | { kind: 'strings'; item?: (value: string) => void }
    | { kind: 'enum'; values: readonly string[] };

interface Field {
    type: FieldType;
    description: string;
    examples?: unknown[];
}

const SIZE_HINT = 'Bytes, or a size such as "512k", "25MiB", or "1GB".';
const TIME_HINT = 'An age such as "30d", "6mo", or "1y", or a date (YYYY-MM-DD).';

/** Single source of truth for config validation, docs, and `schema.json`. */
export const CONFIG_FIELDS: Readonly<Record<keyof DatConfig, Field>> = {
    exclude: {
        type: { kind: 'strings' },
        description: 'Gitignore-style patterns to skip, relative to the analyzed directory.',
        examples: [['*.log', 'coverage/', 'docs/**/*.pdf']],
    },
    defaultExcludes: {
        type: { kind: 'boolean' },
        description: 'Skip .git, .hg, .svn, and node_modules. Default: true.',
    },
    gitignore: {
        type: { kind: 'boolean' },
        description: 'Honor .gitignore files. Default: false.',
    },
    maxDepth: {
        type: { kind: 'integer', min: 0 },
        description:
            'Directory levels to descend; 0 scans only the top-level files. Default: unlimited.',
    },
    followSymlinks: {
        type: { kind: 'boolean' },
        description: 'Follow symbolic links (cycles are detected). Default: false.',
    },
    countHardlinks: {
        type: { kind: 'boolean' },
        description:
            'Count every hard link separately instead of counting shared data once. Default: false.',
    },
    minSize: {
        type: { kind: 'size' },
        description: `Only include files at least this large. ${SIZE_HINT}`,
    },
    maxSize: {
        type: { kind: 'size' },
        description: `Only include files at most this large. ${SIZE_HINT}`,
    },
    newerThan: {
        type: { kind: 'time' },
        description: `Only include files modified after this point. ${TIME_HINT}`,
    },
    olderThan: {
        type: { kind: 'time' },
        description: `Only include files modified before this point. ${TIME_HINT}`,
    },
    top: {
        type: { kind: 'integer', min: 0 },
        description: 'Length of the largest files and folders lists; 0 hides them. Default: 10.',
    },
    largeFiles: {
        type: { kind: 'size', allowBoolean: true },
        description: `Report files at least this large; true uses 100 MiB. ${SIZE_HINT}`,
        examples: ['50MB'],
    },
    duplicates: { type: { kind: 'boolean' }, description: 'Find files with identical contents.' },
    minDuplicateSize: {
        type: { kind: 'size' },
        description: `Ignore files smaller than this when looking for duplicates. ${SIZE_HINT}`,
    },
    empty: { type: { kind: 'boolean' }, description: 'Report empty files and empty folders.' },
    stale: {
        type: { kind: 'time', allowBoolean: true },
        description: `Report files not modified since this point; true uses one year. ${TIME_HINT}`,
        examples: ['2y'],
    },
    extensions: { type: { kind: 'boolean' }, description: 'Show the extension breakdown.' },
    tree: { type: { kind: 'boolean' }, description: 'Show a size tree.' },
    treeDepth: {
        type: { kind: 'integer', min: 1 },
        description: 'Levels shown by the tree. Default: 3.',
    },
    units: {
        type: { kind: 'enum', values: ['iec', 'si'] },
        description:
            'Size units: "iec" (KiB, MiB; powers of 1024) or "si" (kB, MB; powers of 1000).',
    },
    budgets: {
        type: { kind: 'strings', item: (rule) => void parseBudget(rule) },
        description:
            'Rules that must hold, or the run exits with code 2. Metrics: size, disk, files, dirs, largest, large, duplicates, wasted, empty, stale, errors.',
        examples: [['size<=500MB', 'duplicates=0', 'largest<50MB']],
    },
};

const FIELDS = new Map<string, Field>(Object.entries(CONFIG_FIELDS));

/** Keys from v1 and v2 config files, mapped to their v3 equivalents. */
const LEGACY_KEYS: Record<string, (value: unknown, config: Record<string, unknown>) => string> = {
    excludePatterns: (value, config) => {
        config['exclude'] = value;
        return 'exclude';
    },
    clearDefaultExclusions: (value, config) => {
        if (typeof value === 'boolean') config['defaultExcludes'] = !value;
        else config['defaultExcludes'] = value;
        return 'defaultExcludes';
    },
    largeSizeThresholdMB: (value, config) => {
        config['largeFiles'] = typeof value === 'number' ? `${value}MiB` : value;
        return 'largeFiles';
    },
    largeSizeThreshold: (value, config) => {
        config['largeFiles'] = value;
        return 'largeFiles';
    },
    enableDuplicateDetection: (value, config) => {
        config['duplicates'] = value;
        return 'duplicates';
    },
    topN: (value, config) => {
        config['top'] = value;
        return 'top';
    },
    showEmptyFiles: (value, config) => {
        config['empty'] = value;
        return 'empty';
    },
};

/** v1 keys with no v3 equivalent. */
const REMOVED_KEYS: Record<string, string> = {
    enableProgressBar: 'progress is shown automatically in interactive terminals',
    outputFormat: 'use --format on the command line',
};

export interface ValidationResult {
    config: DatConfig;
    warnings: string[];
    errors: string[];
}

/** Validates parsed JSON against {@link CONFIG_FIELDS}, translating legacy keys. */
export function validateConfig(raw: unknown): ValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { config: {}, warnings, errors: ['the file must contain a JSON object'] };
    }

    const input: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
    delete input['$schema'];

    // A v2 "maxDepth: -1" meant unlimited.
    if (input['maxDepth'] === -1) delete input['maxDepth'];

    for (const [key, translate] of Object.entries(LEGACY_KEYS)) {
        if (!(key in input)) continue;
        const value = input[key];
        delete input[key];
        const replacement = translate(value, input);
        warnings.push(`"${key}" is deprecated; use "${replacement}" instead`);
    }
    for (const [key, reason] of Object.entries(REMOVED_KEYS)) {
        if (!(key in input)) continue;
        delete input[key];
        warnings.push(`"${key}" is no longer supported (${reason}); ignoring it`);
    }

    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        const field = FIELDS.get(key);
        if (!field) {
            warnings.push(`unknown key "${key}" ignored`);
            continue;
        }
        const problem = checkValue(field.type, value);
        if (problem) errors.push(`"${key}" ${problem}`);
        else config[key] = value;
    }
    // Every value was checked against CONFIG_FIELDS above.
    return { config, warnings, errors };
}

function checkValue(type: FieldType, value: unknown): string | null {
    const got = `(got ${JSON.stringify(value)})`;
    switch (type.kind) {
        case 'boolean':
            return typeof value === 'boolean' ? null : `must be true or false ${got}`;
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value) && value >= type.min
                ? null
                : `must be an integer of at least ${type.min} ${got}`;
        case 'size':
            if (type.allowBoolean && typeof value === 'boolean') return null;
            if (typeof value !== 'string' && typeof value !== 'number') {
                return `must be a size such as "25MiB" ${got}`;
            }
            try {
                parseSize(value);
                return null;
            } catch (error) {
                return `is invalid: ${errorMessage(error)}`;
            }
        case 'time':
            if (type.allowBoolean && typeof value === 'boolean') return null;
            if (typeof value !== 'string') return `must be an age or a date such as "30d" ${got}`;
            try {
                parsePointInTime(value);
                return null;
            } catch (error) {
                return `is invalid: ${errorMessage(error)}`;
            }
        case 'strings': {
            if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string')) {
                return `must be an array of strings ${got}`;
            }
            if (type.item) {
                for (const item of value) {
                    try {
                        type.item(item);
                    } catch (error) {
                        return `is invalid: ${errorMessage(error)}`;
                    }
                }
            }
            return null;
        }
        case 'enum':
            return typeof value === 'string' && type.values.includes(value)
                ? null
                : `must be one of ${type.values.map((v) => `"${v}"`).join(', ')} ${got}`;
    }
}

/** Builds the JSON Schema published as `dir-analysis-tool/schema.json`. */
export function buildJsonSchema(): Record<string, unknown> {
    const properties: Record<string, unknown> = {
        $schema: { type: 'string', description: 'JSON Schema reference for editor support.' },
    };
    for (const [key, field] of Object.entries(CONFIG_FIELDS)) {
        properties[key] = {
            ...jsonType(field.type),
            description: field.description,
            ...(field.examples ? { examples: field.examples } : {}),
        };
    }
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'https://unpkg.com/dir-analysis-tool/schema.json',
        title: 'dir-analysis-tool configuration',
        description:
            'Configuration for dir-analysis-tool (dat). Place it in .dir-analyzer.json or dir-analyzer.config.json.',
        type: 'object',
        additionalProperties: false,
        properties,
    };
}

function jsonType(type: FieldType): Record<string, unknown> {
    const size = {
        anyOf: [
            { type: 'integer', minimum: 0 },
            {
                type: 'string',
                pattern: '^\\s*(\\d+(\\.\\d+)?|\\.\\d+)\\s*([kKmMgGtTpP]([iI]?[bB])?|[bB])?\\s*$',
            },
        ],
    };
    switch (type.kind) {
        case 'boolean':
            return { type: 'boolean' };
        case 'integer':
            return { type: 'integer', minimum: type.min };
        case 'size':
            return type.allowBoolean ? { anyOf: [{ type: 'boolean' }, ...size.anyOf] } : size;
        case 'time':
            return type.allowBoolean
                ? { anyOf: [{ type: 'boolean' }, { type: 'string' }] }
                : { type: 'string' };
        case 'strings':
            return { type: 'array', items: { type: 'string' } };
        case 'enum':
            return { enum: [...type.values] };
    }
}
