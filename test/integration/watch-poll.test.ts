import { describe, expect, it, vi } from 'vitest';
import type * as AnalyzeModule from '../../src/core/analyze.ts';
import { cli } from '../helpers/cli.ts';
import { fixture } from '../helpers/fixture.ts';

/** Start and end of every scan, from a wrapper that makes each scan slower than the interval. */
const scans: Array<{ start: number; end: number }> = [];
const SCAN_MS = 1500;

vi.mock('../../src/core/analyze.ts', async (importOriginal) => {
    const original = await importOriginal<typeof AnalyzeModule>();
    return {
        ...original,
        analyze: async (...args: Parameters<typeof original.analyze>) => {
            const start = performance.now();
            const result = await original.analyze(...args);
            await new Promise((resolve) => setTimeout(resolve, SCAN_MS));
            scans.push({ start, end: performance.now() });
            return result;
        },
    };
});

describe('dat watch --poll (#34)', () => {
    it('waits the whole interval after each scan, even when scans are slower than it', async () => {
        const root = await fixture({ 'a.txt': 'x' });
        const controller = new AbortController();
        const running = cli(['watch', root, '--poll', '1', '--json'], {
            signal: controller.signal,
        });
        await vi.waitFor(() => expect(scans.length).toBeGreaterThanOrEqual(3), {
            timeout: 15_000,
            interval: 50,
        });
        controller.abort();
        expect((await running).code).toBe(130);
        for (let i = 1; i < scans.length; i++) {
            // A timer never fires early; allow for its millisecond rounding.
            expect(scans[i]!.start - scans[i - 1]!.end).toBeGreaterThanOrEqual(990);
        }
    }, 20_000);
});
