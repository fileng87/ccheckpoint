import * as fs from 'fs-extra';

import { StorageManager } from './storage';

export interface CCheckpointConfig {
  version: string;
  claudeCodeIntegration: {
    enabled: boolean;
    hookPath: string | undefined;
    autoCheckpoint: boolean;
  };
  storage: {
    maxCheckpoints: number;
    cleanupDays: number;
    compressionEnabled: boolean;
  };
  ignore: {
    patterns: string[];
    customPatterns: string[];
  };
  ui: {
    colorOutput: boolean;
    verboseMode: boolean;
  };
}

export class ConfigManager {
  private storageManager: StorageManager;
  private config?: CCheckpointConfig;

  constructor() {
    this.storageManager = new StorageManager();
  }

  async getConfig(): Promise<CCheckpointConfig> {
    if (this.config) {
      return this.config;
    }

    const configPath = this.storageManager.getConfigPath();

    if (!(await fs.pathExists(configPath))) {
      this.config = this.getDefaultConfig();
      await this.saveConfig();
      return this.config;
    }

    try {
      this.config = await fs.readJSON(configPath);
      // Merge missing default values
      this.config = { ...this.getDefaultConfig(), ...this.config };
      return this.config;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to read config, using defaults: ${message}`);
      this.config = this.getDefaultConfig();
      return this.config;
    }
  }

  async saveConfig(): Promise<void> {
    if (!this.config) {
      throw new Error('No config to save');
    }

    const configPath = this.storageManager.getConfigPath();
    await this.storageManager.ensureBaseDirectory();
    await fs.writeJSON(configPath, this.config, { spaces: 2 });
  }

  async updateConfig(updates: Partial<CCheckpointConfig>): Promise<void> {
    const currentConfig = await this.getConfig();
    this.config = this.mergeDeep(
      currentConfig as unknown as Record<string, unknown>,
      updates as unknown as Record<string, unknown>
    ) as unknown as CCheckpointConfig;
    await this.saveConfig();
  }

  async setClaudeCodeIntegration(
    enabled: boolean,
    hookPath?: string
  ): Promise<void> {
    await this.updateConfig({
      claudeCodeIntegration: {
        enabled,
        hookPath: hookPath === undefined ? undefined : hookPath,
        autoCheckpoint: enabled,
      },
    });
  }

  async addIgnorePattern(pattern: string): Promise<void> {
    const config = await this.getConfig();
    if (!config.ignore.customPatterns.includes(pattern)) {
      config.ignore.customPatterns.push(pattern);
      await this.saveConfig();
    }
  }

  async removeIgnorePattern(pattern: string): Promise<void> {
    const config = await this.getConfig();
    config.ignore.customPatterns = config.ignore.customPatterns.filter(
      (p) => p !== pattern
    );
    await this.saveConfig();
  }

  async getIgnorePatterns(): Promise<string[]> {
    const config = await this.getConfig();
    return [...config.ignore.patterns, ...config.ignore.customPatterns];
  }

  async resetConfig(): Promise<void> {
    this.config = this.getDefaultConfig();
    await this.saveConfig();
  }

  async validateConfig(): Promise<{ isValid: boolean; issues: string[] }> {
    const issues: string[] = [];

    try {
      const config = await this.getConfig();

      // Validate basic structure
      if (!config.version) {
        issues.push('Missing version field');
      }

      if (!config.claudeCodeIntegration) {
        issues.push('Missing claudeCodeIntegration configuration');
      }

      if (!config.storage) {
        issues.push('Missing storage configuration');
      } else {
        if (config.storage.maxCheckpoints < 1) {
          issues.push('maxCheckpoints must be at least 1');
        }
        if (config.storage.cleanupDays < 1) {
          issues.push('cleanupDays must be at least 1');
        }
      }

      if (!Array.isArray(config.ignore?.patterns)) {
        issues.push('ignore.patterns must be an array');
      }

      if (!Array.isArray(config.ignore?.customPatterns)) {
        issues.push('ignore.customPatterns must be an array');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Failed to validate config: ${message}`);
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }

  async exportConfig(): Promise<string> {
    const config = await this.getConfig();
    return JSON.stringify(config, null, 2);
  }

  async importConfig(configJson: string): Promise<void> {
    try {
      const importedConfig = JSON.parse(configJson);
      const validation = await this.validateImportedConfig(importedConfig);

      if (!validation.isValid) {
        throw new Error(`Invalid config: ${validation.issues.join(', ')}`);
      }

      this.config = importedConfig;
      await this.saveConfig();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to import config: ${message}`);
    }
  }

  private getDefaultConfig(): CCheckpointConfig {
    return {
      version: '1.0.0',
      claudeCodeIntegration: {
        enabled: false,
        hookPath: undefined,
        autoCheckpoint: true,
      },
      storage: {
        maxCheckpoints: 100,
        cleanupDays: 30,
        compressionEnabled: true,
      },
      ignore: {
        patterns: [
          'node_modules',
          '.git',
          '.ccheckpoint',
          'dist',
          'build',
          'out',
          '.next',
          '.nuxt',
          'target',
          'bin',
          'obj',
          '.env*',
          '*.log',
          '.DS_Store',
          'Thumbs.db',
          '*.tmp',
          '*.temp',
        ],
        customPatterns: [],
      },
      ui: {
        colorOutput: true,
        verboseMode: false,
      },
    };
  }

  private async validateImportedConfig(
    config: unknown
  ): Promise<{ isValid: boolean; issues: string[] }> {
    const issues: string[] = [];

    if (typeof config !== 'object' || config === null) {
      issues.push('Config must be an object');
      return { isValid: false, issues };
    }

    // Basic structure check
    const requiredFields = ['claudeCodeIntegration', 'storage', 'ignore', 'ui'];
    for (const field of requiredFields) {
      if (!(config as Record<string, unknown>)[field]) {
        issues.push(`Missing required field: ${field}`);
      }
    }

    // Specific field validation
    const configObj = config as Record<string, unknown>;
    if (configObj.storage && typeof configObj.storage === 'object') {
      const storage = configObj.storage as Record<string, unknown>;
      if (
        typeof storage.maxCheckpoints !== 'number' ||
        storage.maxCheckpoints < 1
      ) {
        issues.push('storage.maxCheckpoints must be a positive number');
      }
      if (typeof storage.cleanupDays !== 'number' || storage.cleanupDays < 1) {
        issues.push('storage.cleanupDays must be a positive number');
      }
    }

    if (configObj.ignore && typeof configObj.ignore === 'object') {
      const ignore = configObj.ignore as Record<string, unknown>;
      if (!Array.isArray(ignore.patterns)) {
        issues.push('ignore.patterns must be an array');
      }
      if (!Array.isArray(ignore.customPatterns)) {
        issues.push('ignore.customPatterns must be an array');
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }

  private mergeDeep(
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...target };

    for (const key in source) {
      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.mergeDeep(
          (target[key] as Record<string, unknown>) || {},
          source[key] as Record<string, unknown>
        );
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}
