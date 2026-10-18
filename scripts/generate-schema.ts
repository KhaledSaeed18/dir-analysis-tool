/**
 * Regenerates schema.json from the config field definitions.
 * Run with `pnpm schema`; CI fails when the committed file is out of date.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildJsonSchema } from '../src/config/schema.ts';

const target = join(import.meta.dirname, '..', 'schema.json');
await writeFile(target, `${JSON.stringify(buildJsonSchema(), null, 4)}\n`);
process.stdout.write(`Wrote ${target}\n`);
