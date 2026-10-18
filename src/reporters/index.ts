import type { ByteUnits } from '../format/bytes.ts';
import type { Style } from '../format/style.ts';
import type { AnalysisResult, ComparisonResult } from '../types.ts';
import { renderAnalysisCsv, renderComparisonCsv } from './csv.ts';
import { renderAnalysisHtml } from './html.ts';
import { renderAnalysisMarkdown, renderComparisonMarkdown } from './markdown.ts';
import { renderAnalysis, renderComparison } from './pretty.ts';

export const FORMATS = ['pretty', 'json', 'markdown', 'csv', 'html'] as const;
export type Format = (typeof FORMATS)[number];

export interface RenderOptions {
    style: Style;
    units: ByteUnits;
    width: number;
    limit: number;
    types: boolean;
    extensions: boolean;
}

export function renderAnalysisAs(
    format: Format,
    result: AnalysisResult,
    options: RenderOptions
): string {
    switch (format) {
        case 'pretty':
            return renderAnalysis(result, options);
        case 'json':
            return `${JSON.stringify(result, null, 2)}\n`;
        case 'markdown':
            return renderAnalysisMarkdown(result, options);
        case 'csv':
            return renderAnalysisCsv(result);
        case 'html':
            return renderAnalysisHtml(result, { units: options.units });
    }
}

export function renderComparisonAs(
    format: Format,
    result: ComparisonResult,
    options: RenderOptions
): string {
    switch (format) {
        case 'pretty':
            return renderComparison(result, options);
        case 'json':
            return `${JSON.stringify(result, null, 2)}\n`;
        case 'markdown':
            return renderComparisonMarkdown(result, options);
        case 'csv':
            return renderComparisonCsv(result);
        case 'html':
            throw new RangeError(
                'HTML output is not available for compare; use pretty, json, markdown, or csv.'
            );
    }
}

/** File extension conventionally used for each format. */
export const FORMAT_EXTENSIONS: Record<Format, string> = {
    pretty: '.txt',
    json: '.json',
    markdown: '.md',
    csv: '.csv',
    html: '.html',
};
