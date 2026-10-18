import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
    entry: {
        index: 'src/index.ts',
        cli: 'src/cli/main.ts',
    },
    format: 'esm',
    platform: 'node',
    target: 'node22.12',
    dts: { entry: 'src/index.ts' },
    sourcemap: false,
    clean: true,
    treeshake: true,
    publint: false,
    fixedExtension: false,
    outputOptions: { chunkFileNames: 'shared-[hash].js' },
});

export default config;
