import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

import { CheckpointManager } from './checkpoint';
import { ConfigManager } from './config';
import { StorageManager } from './storage';

interface ClaudeCodeSettings {
  hooks?: {
    UserPromptSubmit?: Array<{
      hooks?: Array<{ command?: string; type?: string }>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function setupClaudeCodeHook(): Promise<void> {
  const configManager = new ConfigManager();
  const storageManager = new StorageManager();

  // Ensure base directory exists
  await storageManager.ensureBaseDirectory();

  // Update configuration
  await configManager.setClaudeCodeIntegration(true, 'ccheckpoint hook');

  // Try to auto-configure Claude Code
  const autoConfigResult = await tryAutoConfigureClaudeCode();

  if (autoConfigResult.success) {
    console.log(`✅ Claude Code automatically configured!
📍 Configuration file location: ${autoConfigResult.configPath}
🎯 Hook added to UserPromptSubmit event

🚀 You can now use Claude Code directly in any project,
   checkpoints will be created automatically before each prompt!`);
  } else {
    console.log(`⚠️ Unable to automatically configure Claude Code (${autoConfigResult.reason})
   
📋 Please manually add the following configuration to Claude Code settings:`);
    await showSimpleClaudeCodeConfigInstructions();
  }
}

export async function handleClaudeCodeHook(
  hookDataString?: string
): Promise<void> {
  try {
    // Read hook data from command line arguments or stdin
    let hookData: Record<string, unknown> = {};

    if (hookDataString) {
      try {
        hookData = JSON.parse(hookDataString);
      } catch {
        // If parameter is not JSON, try reading from stdin
        const stdinData = await readStdin();
        if (stdinData) {
          hookData = JSON.parse(stdinData);
        }
      }
    } else {
      // No parameters, read from stdin
      const stdinData = await readStdin();
      if (stdinData) {
        hookData = JSON.parse(stdinData);
      }
    }

    const session_id =
      typeof hookData === 'object' && hookData && 'session_id' in hookData
        ? String((hookData as Record<string, unknown>).session_id)
        : '';
    const transcript_path =
      typeof hookData === 'object' && hookData && 'transcript_path' in hookData
        ? (hookData as Record<string, unknown>).transcript_path
        : undefined;
    const prompt =
      typeof hookData === 'object' && hookData && 'prompt' in hookData
        ? String((hookData as Record<string, unknown>).prompt || '')
        : '';
    const hook_event_name =
      typeof hookData === 'object' && hookData && 'hook_event_name' in hookData
        ? String((hookData as Record<string, unknown>).hook_event_name)
        : '';

    // Verify this is indeed a UserPromptSubmit event
    if (hook_event_name !== 'UserPromptSubmit') {
      console.log(JSON.stringify({ allow: true }));
      return;
    }

    // Validate required parameters
    if (!session_id) {
      console.log(JSON.stringify({ allow: true }));
      return;
    }

    // Use CLAUDE_PROJECT_DIR or current directory
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Create checkpoint description
    const promptSummary = prompt
      ? prompt.slice(0, 100).replace(/\n/g, ' ')
      : 'Claude prompt';
    const message = `Session: ${session_id.slice(0, 8)} - ${promptSummary}`;

    // Use CheckpointManager directly to create checkpoint, avoiding circular calls
    try {
      // Switch to project directory
      const originalCwd = process.cwd();
      process.chdir(projectDir);

      // Set environment variables
      process.env.CCHECKPOINT_SESSION_ID = session_id;
      process.env.CCHECKPOINT_TRANSCRIPT_PATH =
        typeof transcript_path === 'string' ? transcript_path : undefined;

      const checkpointManager = new CheckpointManager();
      const result = await checkpointManager.create(message);

      // Restore original directory
      process.chdir(originalCwd);

      console.log(
        JSON.stringify({
          allow: true,
          context: `📝 Checkpoint created: ${result.id.slice(0, 8)}`,
        })
      );
    } catch (error: unknown) {
      console.log(
        JSON.stringify({
          allow: true,
          context: `⚠️ Checkpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  } catch (error: unknown) {
    // Allow prompt to continue even on error, don't block user
    console.log(
      JSON.stringify({
        allow: true,
        context: `❌ Hook error: ${error instanceof Error ? error.message : String(error)}`,
      })
    );
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');

    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      resolve(data.trim());
    });

    // Set timeout to avoid infinite waiting
    setTimeout(() => {
      resolve('');
    }, 1000);
  });
}

async function tryAutoConfigureClaudeCode(): Promise<{
  success: boolean;
  configPath?: string;
  reason?: string;
}> {
  // Define possible Claude Code settings file locations
  const possibleConfigPaths = [
    path.join(os.homedir(), '.claude', 'settings.json'), // Global user settings
    path.join(process.cwd(), '.claude', 'settings.json'), // Project settings
    path.join(process.cwd(), '.claude', 'settings.local.json'), // Local project settings
  ];

  // Try to find the best configuration file location, default to global config
  let targetConfigPath: string = possibleConfigPaths[0]!; // ~/.claude/settings.json

  for (const configPath of possibleConfigPaths) {
    if (await fs.pathExists(configPath)) {
      targetConfigPath = configPath;
      break;
    }
  }

  try {
    // Ensure config directory exists
    await fs.ensureDir(path.dirname(targetConfigPath));

    // Read existing config or create empty config
    let settings: ClaudeCodeSettings = {};
    if (await fs.pathExists(targetConfigPath)) {
      try {
        settings = await fs.readJSON(targetConfigPath);
      } catch {
        // If JSON format is wrong, backup original file and create new one
        await fs.copy(targetConfigPath, `${targetConfigPath}.backup`);
        settings = {};
      }
    }

    // Ensure hooks structure exists
    if (!settings.hooks) {
      settings.hooks = {};
    }
    if (!settings.hooks.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = [];
    }

    // Check if ccheckpoint hook is already configured
    const existingHook = settings.hooks?.UserPromptSubmit?.find(
      (hook) =>
        hook.hooks &&
        hook.hooks.some(
          (h) => h.command && h.command.includes('ccheckpoint hook')
        )
    );

    if (existingHook) {
      return { success: true, configPath: targetConfigPath };
    }

    // Add new hook configuration
    settings.hooks!.UserPromptSubmit!.push({
      hooks: [
        {
          type: 'command',
          command: 'ccheckpoint hook',
        },
      ],
    });

    // Write configuration file
    await fs.writeJSON(targetConfigPath, settings, { spaces: 2 });

    return { success: true, configPath: targetConfigPath };
  } catch (error: unknown) {
    return {
      success: false,
      reason: `Configuration file operation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function showSimpleClaudeCodeConfigInstructions(): Promise<void> {
  const claudeConfigExample = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: 'ccheckpoint hook',
            },
          ],
        },
      ],
    },
  };

  console.log(`
📋 Claude Code Hook Setup Instructions:

1. Add the following simple configuration to your Claude Code settings:

${JSON.stringify(claudeConfigExample, null, 2)}

2. ✅ That's it! No absolute paths needed!

💡 The hook will:
   - Automatically create checkpoints before each Claude prompt
   - Work in any project directory
   - Never block your prompts (fail-safe design)
   - Use the globally installed ccheckpoint command

📖 For more information about Claude Code hooks, visit:
   https://docs.anthropic.com/claude-code/hooks
`);
}

export async function validateClaudeCodeSetup(): Promise<{
  isSetup: boolean;
  issues: string[];
  hookPath: string | undefined;
}> {
  const issues: string[] = [];
  const configManager = new ConfigManager();

  try {
    const config = await configManager.getConfig();

    if (!config.claudeCodeIntegration.enabled) {
      issues.push('Claude Code integration is disabled');
      return { isSetup: false, issues, hookPath: undefined };
    }

    const hookPath = config.claudeCodeIntegration.hookPath;

    if (!hookPath) {
      issues.push('Hook path not configured');
      return { isSetup: false, issues, hookPath: undefined };
    }

    if (!(await fs.pathExists(hookPath))) {
      issues.push('Hook script does not exist');
      return { isSetup: false, issues, hookPath };
    }

    // Check hook script permissions
    try {
      await fs.access(hookPath, fs.constants.X_OK);
    } catch {
      issues.push('Hook script is not executable');
    }

    // Check if ccheckpoint command is available
    const { spawn } = await import('child_process');
    const testCommand = new Promise((resolve) => {
      const child = spawn('ccheckpoint', ['--version'], { stdio: 'pipe' });
      child.on('close', (code: number | null) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });

    if (!(await testCommand)) {
      issues.push('ccheckpoint command not available in PATH');
    }

    return {
      isSetup: issues.length === 0,
      issues,
      hookPath,
    };
  } catch (error: unknown) {
    issues.push(
      `Setup validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return { isSetup: false, issues, hookPath: undefined };
  }
}

export async function removeClaudeCodeHook(): Promise<void> {
  const configManager = new ConfigManager();

  // Try to automatically remove Claude Code configuration
  const removeResult = await tryRemoveClaudeCodeConfig();

  // Update local configuration
  await configManager.setClaudeCodeIntegration(false);

  if (removeResult.success) {
    console.log(`✅ Claude Code hook automatically removed!
📍 Removed from configuration file: ${removeResult.configPath}

💡 You can re-enable it anytime by running: ccheckpoint setup`);
  } else {
    console.log(`⚠️ Unable to automatically remove Claude Code configuration (${removeResult.reason})

📋 Please manually remove the following configuration from Claude Code settings:
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ccheckpoint hook"
          }
        ]
      }
    ]
  }
}

💡 You can re-enable it anytime by running: ccheckpoint setup`);
  }
}

async function tryRemoveClaudeCodeConfig(): Promise<{
  success: boolean;
  configPath?: string;
  reason?: string;
}> {
  const possibleConfigPaths = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json'),
  ];

  for (const configPath of possibleConfigPaths) {
    if (await fs.pathExists(configPath)) {
      try {
        const settings: ClaudeCodeSettings = await fs.readJSON(configPath);

        if (settings.hooks?.UserPromptSubmit) {
          // Remove ccheckpoint related hooks
          settings.hooks.UserPromptSubmit =
            settings.hooks.UserPromptSubmit.filter(
              (hook: { hooks?: Array<{ command?: string }> }) => {
                return !(
                  hook.hooks &&
                  hook.hooks.some(
                    (h: { command?: string }) =>
                      h.command && h.command.includes('ccheckpoint hook')
                  )
                );
              }
            );

          // If UserPromptSubmit array is empty, remove the entire property
          if (settings.hooks!.UserPromptSubmit!.length === 0) {
            delete settings.hooks!.UserPromptSubmit;
          }

          // If hooks object is empty, remove the entire hooks property
          if (Object.keys(settings.hooks!).length === 0) {
            delete settings.hooks;
          }

          await fs.writeJSON(configPath, settings, { spaces: 2 });
          return { success: true, configPath };
        }
      } catch (error: unknown) {
        return {
          success: false,
          reason: `Configuration file operation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  }

  return { success: false, reason: 'Claude Code configuration file not found' };
}

export function getClaudeCodeConfigTemplate(hookPath: string): string {
  return JSON.stringify(
    {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: hookPath,
              },
            ],
          },
        ],
      },
    },
    null,
    2
  );
}
