import { defineConfig, type ViteUserConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        testTimeout: 20_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/cli/main.ts'],
            reporter: ['text', 'lcov'],
            thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
        },
    },
});

export default config;
