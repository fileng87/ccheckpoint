import chalk from 'chalk';
import { consola } from 'consola';

// Configure consola for CLI output
const logger = consola.create({
  level: 4, // Show all levels
});

// Specialized logger utilities for checkpoint CLI
export class Logger {
  // Basic logging methods using consola
  static success(message: string, details?: string): void {
    logger.success(message);
    if (details) {
      console.log(`    ${chalk.gray(details)}`);
    }
  }

  static error(message: string, details?: string): void {
    logger.error(message);
    if (details) {
      console.log(`    ${chalk.gray(details)}`);
    }
  }

  static warn(message: string, details?: string): void {
    logger.warn(message);
    if (details) {
      console.log(`    ${chalk.gray(details)}`);
    }
  }

  static info(message: string, details?: string): void {
    logger.info(message);
    if (details) {
      console.log(`    ${chalk.gray(details)}`);
    }
  }

  static start(message: string): void {
    logger.start(message);
  }

  // Special formatters for checkpoint data
  static section(title: string): void {
    console.log(chalk.bold.blue(`\n${title}`));
  }

  static checkpoint(
    id: string,
    message: string,
    timestamp?: string,
    sessionId?: string,
    isCurrent?: boolean
  ): void {
    const indicator = isCurrent ? chalk.green('● ') : '  ';
    const idColor = isCurrent ? chalk.green : chalk.cyan;
    const shortId = id.slice(0, 8);

    console.log(`${indicator}${idColor(shortId)} ${message}`);

    if (timestamp || sessionId) {
      const details = [];
      if (timestamp) details.push(timestamp);
      if (sessionId) details.push(`session: ${sessionId.slice(0, 8)}`);
      console.log(`    ${chalk.gray(details.join(' • '))}`);
    }
  }

  static diff(changes: Array<{ type: string; path: string }>): void {
    if (changes.length === 0) {
      this.success('No differences found');
      return;
    }

    changes.forEach((change) => {
      const status =
        change.type === 'added'
          ? chalk.green('+')
          : change.type === 'deleted'
            ? chalk.red('-')
            : chalk.yellow('~');

      console.log(`  ${status} ${change.path}`);
    });
  }

  static status(data: Record<string, string | number>): void {
    Object.entries(data).forEach(([key, value]) => {
      const formattedKey = key.charAt(0).toUpperCase() + key.slice(1);
      console.log(`  ${formattedKey}: ${chalk.cyan(value)}`);
    });
  }

  static empty(message: string, suggestion?: string): void {
    logger.warn(message);
    if (suggestion) {
      console.log(`    ${chalk.gray(suggestion)}`);
    }
  }

  static cancelled(): void {
    logger.info('Operation cancelled');
  }

  // Raw output for special cases
  static raw(text: string): void {
    process.stdout.write(text);
  }

  // Progress helpers
  static progress(message: string): void {
    logger.start(message);
  }

  // List helpers
  static listHeader(message: string, count?: number): void {
    const countText = count !== undefined ? ` (${count})` : '';
    this.info(`${message}${countText}`);
  }

  // Spacing utilities
  static separator(): void {
    console.log();
  }
}

// Export default instance for convenience
export const log = Logger;
