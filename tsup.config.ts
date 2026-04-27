import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node18',
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
    define: {
        __VERSION__: JSON.stringify(version),
    },
});
