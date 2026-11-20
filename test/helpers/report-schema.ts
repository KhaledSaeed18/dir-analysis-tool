import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';

export interface SchemaNode {
    $ref?: string;
    type?: string | string[];
    const?: unknown;
    enum?: unknown[];
    required?: string[];
    properties?: Record<string, SchemaNode>;
    items?: SchemaNode;
    anyOf?: SchemaNode[];
    description?: string;
}

export interface ReportSchema extends SchemaNode {
    $id: string;
    $defs: Record<string, SchemaNode>;
}

export const REPORT_SCHEMA: ReportSchema = JSON.parse(
    readFileSync(new URL('../../report.schema.json', import.meta.url), 'utf8')
) as ReportSchema;

/** The kinds of report, named by their entry in `$defs`. */
export type ReportKind = 'analysis' | 'comparison' | 'pathExplanation' | 'skipsExplanation';

const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    // Nullable fields are written as ["integer", "null"], as JSON Schema allows.
    allowUnionTypes: true,
    formats: { 'date-time': true },
});
ajv.addSchema(REPORT_SCHEMA);
const validateAny = ajv.compile({ $ref: REPORT_SCHEMA.$id });

/** Which kind of report a parsed JSON document is, from the fields that tell them apart. */
export function reportKind(value: Record<string, unknown>): ReportKind {
    if ('explainVersion' in value) {
        return 'decision' in value ? 'pathExplanation' : 'skipsExplanation';
    }
    return 'mode' in value ? 'comparison' : 'analysis';
}

function resolve(node: SchemaNode): SchemaNode {
    return node.$ref ? (REPORT_SCHEMA.$defs[node.$ref.replace('#/$defs/', '')] ?? {}) : node;
}

/**
 * Fields the schema doesn't declare. The schema allows them, so a 3.x report
 * still validates against an older schema; the tests make sure none slip in.
 */
export function undeclared(value: unknown, node: SchemaNode, path = '$'): string[] {
    const target = resolve(node);
    if (value === null || typeof value !== 'object') return [];
    if (target.anyOf) {
        // Nullable objects: check against the branch that describes an object.
        const branch = target.anyOf.map(resolve).find((b) => b.properties);
        return branch ? undeclared(value, branch, path) : [];
    }
    if (Array.isArray(value)) {
        const items = target.items;
        return items ? value.flatMap((v, i) => undeclared(v, items, `${path}[${i}]`)) : [];
    }
    if (!target.properties) return [];
    return Object.entries(value).flatMap(([key, v]) => {
        const child = target.properties?.[key];
        return child ? undeclared(v, child, `${path}.${key}`) : [`${path}.${key}`];
    });
}

/** Throws unless the report matches report.schema.json and declares every field it has. */
export function assertValidReport(report: unknown): void {
    if (report === null || typeof report !== 'object' || Array.isArray(report)) {
        throw new Error(`a report is a JSON object, got ${JSON.stringify(report)}`);
    }
    const kind = reportKind(report as Record<string, unknown>);
    const validate = ajv.getSchema(`${REPORT_SCHEMA.$id}#/$defs/${kind}`);
    if (!validate || !validateAny(report)) {
        throw new Error(
            `report does not match report.schema.json: ${JSON.stringify(validateAny.errors)}`
        );
    }
    if (!validate(report)) {
        throw new Error(
            `report does not match $defs/${kind} in report.schema.json: ${JSON.stringify(validate.errors)}`
        );
    }
    const extra = undeclared(report, REPORT_SCHEMA.$defs[kind] ?? {});
    if (extra.length) {
        throw new Error(`fields missing from report.schema.json: ${extra.join(', ')}`);
    }
}
