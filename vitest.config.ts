import { defineConfig, type ViteUserConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        testTimeout: 20_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // Only wires the real process into run(); the CLI tests cover run() itself.
            exclude: ['src/cli/main.ts'],
            reporter: ['text', 'lcov'],
            // A ratchet just under what the suite reaches today (CI measures it on
            // Linux, Node 24); raise it as coverage grows, never lower it.
            thresholds: { statements: 94, branches: 87, functions: 95, lines: 95 },
        },
    },
});

export default config;
