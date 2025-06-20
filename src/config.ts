import * as fs from 'fs';
import * as path from 'path';
import { ConfigOptions } from './types';

const CONFIG_FILE_NAMES = ['.dir-analyzer.json', 'dir-analyzer.config.json'];

export class ConfigManager {
    private config: ConfigOptions = {};

    async loadConfig(searchPath: string = process.cwd()): Promise<ConfigOptions> {
        const configPath = await this.findConfigFile(searchPath);
        if (configPath) {
            try {
                const configContent = await fs.promises.readFile(configPath, 'utf-8');
                this.config = JSON.parse(configContent);
                console.log(`Loaded configuration from: ${configPath}`);
            } catch (error) {
                console.warn(`Warning: Failed to load config file '${configPath}': ${error}`);
            }
        }
        return this.config;
    }

    private async findConfigFile(searchPath: string): Promise<string | null> {
        let currentPath = searchPath;

        while (currentPath !== path.dirname(currentPath)) {
            for (const configName of CONFIG_FILE_NAMES) {
                const configPath = path.join(currentPath, configName);
                try {
                    await fs.promises.access(configPath, fs.constants.F_OK);
                    return configPath;
                } catch {
                    // File doesn't exist, continue searching
                }
            }
            currentPath = path.dirname(currentPath);
        }

        return null;
    }

    getConfig(): ConfigOptions {
        return this.config;
    }

    mergeWithCliOptions(cliOptions: any): ConfigOptions {
        return {
            ...this.config,
            ...Object.fromEntries(
                Object.entries(cliOptions).filter(([_, value]) => value !== undefined)
            )
        };
    }

    static getDefaultConfig(): ConfigOptions {
        return {
            excludePatterns: [],
            largeSizeThreshold: 100 * 1024 * 1024, // 100MB
            enableDuplicateDetection: false,
            enableProgressBar: true,
            outputFormat: 'table',
            maxDepth: -1 // No limit
        };
    }
}
