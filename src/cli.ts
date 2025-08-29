#!/usr/bin/env node
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';

import { version } from '../package.json';
import { CheckpointManager } from './checkpoint';
import { Logger } from './logger';
import {
  handleClaudeCodeHook,
  removeClaudeCodeHook,
  setupClaudeCodeHook,
} from './setup';

// Helper function to format relative time
function getTimeAgo(timestamp: string): string {
  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now.getTime() - past.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes === 1) return '1 minute ago';
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;

  return past.toLocaleDateString();
}

const program = new Command();

program
  .name('ccheckpoint')
  .description(
    'Checkpoint CLI tool for Claude Code - provides Cursor-like checkpoint functionality'
  )
  .version(version);

program
  .command('setup')
  .description('Setup Claude Code hook for automatic checkpoints')
  .action(async () => {
    try {
      Logger.start('Setting up Claude Code hook...');
      await setupClaudeCodeHook();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Setup failed', errorMessage);
      process.exit(1);
    }
  });

program
  .command('unsetup')
  .description('Remove Claude Code hook configuration')
  .action(async () => {
    try {
      Logger.start('Removing Claude Code hook...');
      await removeClaudeCodeHook();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Unsetup failed', errorMessage);
      process.exit(1);
    }
  });

program
  .command('hook')
  .description('Hook entry point for Claude Code (internal use)')
  .argument('[hookData]', 'Hook data from Claude Code')
  .action(async (hookData: string) => {
    try {
      await handleClaudeCodeHook(hookData);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Hook error: ${errorMessage}`);
      // Even if there's an error, output JSON to allow continuation, avoiding blocking Claude Code
      console.log(JSON.stringify({ allow: true }));
      process.exit(0);
    }
  });

program
  .command('create')
  .description('Create a checkpoint manually')
  .argument('[message]', 'Checkpoint description', 'Manual checkpoint')
  .action(async (message: string) => {
    try {
      const checkpoint = new CheckpointManager();
      const result = await checkpoint.create(message);
      Logger.success(
        `Checkpoint created: ${result.id.slice(0, 8)}`,
        result.message
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Failed to create checkpoint', errorMessage);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all checkpoints for current project')
  .option('-a, --all', 'Show checkpoints for all projects')
  .option('-s, --session <id>', 'Show checkpoints for specific session')
  .option('-n, --limit <number>', 'Limit number of results', '20')
  .action(async (options) => {
    try {
      const checkpoint = new CheckpointManager();
      const results = await checkpoint.list({
        all: options.all,
        sessionId: options.session,
        limit: parseInt(options.limit),
      });

      if (results.length === 0) {
        Logger.empty('No checkpoints found');
        return;
      }

      // Get current checkpoint
      const currentRef = await checkpoint.getCurrentCheckpoint();

      Logger.section('📋 Checkpoints');

      // Show summary
      console.log(
        `  Found ${chalk.cyan(results.length)} checkpoints${currentRef ? ' (● indicates current)' : ''}\n`
      );

      results.forEach((cp, index) => {
        const isCurrentCheckpoint = currentRef && currentRef === cp.id;
        const timeAgo = getTimeAgo(cp.timestamp);
        const indicator = isCurrentCheckpoint
          ? chalk.green('● ')
          : `${chalk.gray((index + 1).toString().padStart(2, ' '))}. `;
        const idColor = isCurrentCheckpoint ? chalk.green : chalk.cyan;

        // Clean up session message
        let displayMessage = cp.message;
        const sessionMatch = displayMessage.match(
          /^Session: [a-f0-9-]+ - (.+)/
        );
        if (sessionMatch && sessionMatch[1]) {
          displayMessage = sessionMatch[1];
        }

        console.log(
          `${indicator}${idColor(cp.id.slice(0, 8))} ${displayMessage}`
        );
        console.log(
          `    ${chalk.gray(timeAgo)} ${chalk.gray('•')} ${chalk.gray('session:')} ${chalk.gray(cp.sessionId.slice(0, 8))}`
        );

        if (index < results.length - 1) {
          console.log(); // Add spacing between entries
        }
      });

      // Show usage tip
      console.log(
        `\n${chalk.gray('💡 Tip: Use')} ${chalk.cyan('ccheckpoint restore')} ${chalk.gray('to interactively restore a checkpoint')}`
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      Logger.error('Failed to list checkpoints', errorMessage);
      process.exit(1);
    }
  });

program
  .command('restore [id]')
  .description('Restore to a specific checkpoint')
  .option('-f, --force', 'Force restore without confirmation')
  .option('--cancel', 'Cancel the last restore operation')
  .action(
    async (
      id: string | undefined,
      options: { force?: boolean; cancel?: boolean }
    ) => {
      try {
        if (options.cancel) {
          const checkpoint = new CheckpointManager();
          await checkpoint.cancelRestore();
          console.log(
            chalk.green('✅ Restore cancelled, previous state restored')
          );
          return;
        }

        const checkpoint = new CheckpointManager();
        let selectedId = id;

        // If no ID is provided, show interactive menu
        if (!selectedId) {
          const checkpoints = await checkpoint.list();

          if (checkpoints.length === 0) {
            Logger.empty('No checkpoints found');
            return;
          }

          // Get current checkpoint for better context
          const currentRef = await checkpoint.getCurrentCheckpoint();

          Logger.section('🔄 Restore Checkpoint');
          console.log(
            `  Select a checkpoint to restore (${chalk.gray('Press ESC or select Cancel to exit')})\n`
          );

          const choices = checkpoints.map((cp) => {
            const isCurrentCheckpoint = currentRef && currentRef === cp.id;
            const timeAgo = getTimeAgo(cp.timestamp);

            // Clean up session message
            let displayMessage = cp.message;
            const sessionMatch = displayMessage.match(
              /^Session: [a-f0-9-]+ - (.+)/
            );
            if (sessionMatch && sessionMatch[1]) {
              displayMessage = sessionMatch[1];
            }

            // Truncate long messages
            if (displayMessage.length > 80) {
              displayMessage = displayMessage.substring(0, 77) + '...';
            }

            const currentIndicator = isCurrentCheckpoint
              ? chalk.green(' (current)')
              : '';
            const name = `${chalk.cyan(cp.id.slice(0, 8))} ${displayMessage}${currentIndicator}`;
            const suffix = chalk.gray(` - ${timeAgo}`);

            return {
              name: name + suffix,
              value: cp.id,
              short: `${cp.id.slice(0, 8)} - ${displayMessage}`,
            };
          });

          // Add separator and cancel option
          const allChoices = [
            ...choices,
            new inquirer.Separator(),
            {
              name: chalk.red('✖ Cancel (ESC)'),
              value: null,
              short: 'Cancelled',
            },
          ];

          let answer;
          try {
            answer = await inquirer.prompt([
              {
                type: 'list',
                name: 'checkpointId',
                message: 'Choose checkpoint:',
                choices: allChoices,
                pageSize: Math.min(checkpoints.length + 2, 12), // +2 for separator and cancel
                loop: false,
              },
            ]);
          } catch (error) {
            // Handle Ctrl+C or ESC gracefully
            if (
              error instanceof Error &&
              (error.message.includes('force closed') ||
                error.message.includes('User force closed'))
            ) {
              console.log('\n'); // Add newline after ^C
              Logger.cancelled();
              return;
            }
            throw error;
          }

          if (!answer.checkpointId) {
            Logger.cancelled();
            return;
          }

          selectedId = answer.checkpointId;
        }

        // Show checkpoint info before confirmation
        const checkpointData = await checkpoint.list();
        const selectedCheckpoint = checkpointData.find(
          (cp) => cp.id === selectedId
        );

        if (selectedCheckpoint) {
          console.log(`\n📍 Selected checkpoint:`);
          console.log(
            `   ${chalk.cyan(selectedCheckpoint.id.slice(0, 8))} - ${selectedCheckpoint.message}`
          );
          console.log(
            `   ${chalk.gray(getTimeAgo(selectedCheckpoint.timestamp))}\n`
          );
        }

        // Confirm operation (unless using --force)
        if (!options.force) {
          let confirm;
          try {
            confirm = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'confirmed',
                message: `⚠️  This will overwrite your current changes and restore to the selected checkpoint. Continue?`,
                default: false,
              },
            ]);
          } catch (error) {
            // Handle Ctrl+C gracefully
            if (
              error instanceof Error &&
              (error.message.includes('force closed') ||
                error.message.includes('User force closed'))
            ) {
              console.log('\n');
              Logger.cancelled();
              return;
            }
            throw error;
          }

          if (!confirm.confirmed) {
            Logger.cancelled();
            return;
          }
        }

        await checkpoint.restore(selectedId!);
        Logger.success('Checkpoint restored successfully');
        console.log(`   Restored to: ${chalk.cyan(selectedId!.slice(0, 8))}`);
        Logger.info('Current state backed up automatically');
        console.log(
          `\n${chalk.gray('💡 To undo this restore, run:')} ${chalk.cyan('ccheckpoint restore --cancel')}`
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        Logger.error('Failed to restore checkpoint', errorMessage);
        process.exit(1);
      }
    }
  );

program
  .command('diff')
  .description('Show differences between current state and checkpoint')
  .argument('<id>', 'Checkpoint ID to compare with')
  .action(async (id: string) => {
    try {
      const checkpoint = new CheckpointManager();
      const diff = await checkpoint.diff(id);

      if (diff.length === 0) {
        Logger.success('No differences found');
        return;
      }

      Logger.info(`Differences from checkpoint ${id.slice(0, 8)}`);
      Logger.diff(diff);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      Logger.error('Failed to show diff', errorMessage);
      process.exit(1);
    }
  });

program
  .command('clean')
  .description('Clean old checkpoints')
  .option('-d, --days <number>', 'Remove checkpoints older than N days', '7')
  .option('-f, --force', 'Force clean without confirmation')
  .action(async (options) => {
    try {
      if (!options.force) {
        console.log(
          chalk.yellow(
            `⚠️  This will remove checkpoints older than ${options.days} days. Use --force to proceed.`
          )
        );
        return;
      }

      const checkpoint = new CheckpointManager();
      const removed = await checkpoint.clean(parseInt(options.days));
      console.log(chalk.green(`✅ Cleaned ${removed} old checkpoints`));
    } catch (error: unknown) {
      console.error(
        chalk.red(
          `❌ Failed to clean checkpoints: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current project checkpoint status')
  .action(async () => {
    try {
      const checkpoint = new CheckpointManager();
      const status = await checkpoint.status();

      Logger.section('Checkpoint Status');
      Logger.status({
        project: status.projectPath,
        'total checkpoints': status.totalCheckpoints,
        latest: status.latest ? status.latest.message : 'None',
        'storage used': status.storageSize,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      Logger.error('Failed to get status', errorMessage);
      process.exit(1);
    }
  });

program
  .command('statusline')
  .description('Output statusline information for Claude Code integration')
  .action(async () => {
    try {
      const checkpoint = new CheckpointManager();
      const currentRef = await checkpoint.getCurrentCheckpoint();

      if (currentRef) {
        // Get checkpoint details
        const checkpoints = await checkpoint.list({ limit: 1 });
        const current = checkpoints.find((cp) => cp.id === currentRef);

        if (current) {
          // Extract session info and clean up message
          let displayMessage = current.message;

          // Remove session prefix if present
          const sessionMatch = displayMessage.match(
            /^Session: [a-f0-9-]+ - (.+)/
          );
          if (sessionMatch && sessionMatch[1]) {
            displayMessage = sessionMatch[1];
          }

          // Truncate long messages for statusline
          if (displayMessage.length > 40) {
            displayMessage = displayMessage.substring(0, 37) + '...';
          }

          // Output format: checkpoint ID + short message
          Logger.raw(`📍 ${currentRef.slice(0, 8)} • ${displayMessage}`);
        } else {
          Logger.raw(`📍 ${currentRef.slice(0, 8)}`);
        }
      } else {
        Logger.raw('📍 No checkpoint');
      }
    } catch {
      // On error, output minimal info to avoid breaking statusline
      Logger.raw('📍 ccheckpoint');
    }
  });

program.parse(process.argv);
