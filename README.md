# CCheckpoint

> Cursor-like checkpoint system for Claude Code - Git-powered project snapshots

CCheckpoint brings Cursor's checkpoint functionality to Claude Code, enabling safe AI-assisted development with instant rollback capabilities and automatic project snapshots.

## ✨ Features

- 🔄 **Auto checkpoints**: Created automatically before each Claude Code prompt
- 💾 **Git-powered storage**: Efficient diff-based storage with full commit history
- 🌍 **Project isolation**: Each project's checkpoints stored separately
- ⚡ **Interactive restore**: Visual checkpoint selection with one-click rollback
- 🎯 **Zero dependencies**: Pure JavaScript, no system Git required
- 🔍 **Current state indicator**: Clear visual indication of active checkpoint

## 🚀 Installation

```bash
npm install -g ccheckpoint
```

## 📖 Quick Start

### 1. Setup
```bash
# One-time setup
ccheckpoint setup
```

**✨ Fully automatic!** This command:
- Auto-detects your Claude Code configuration file
- Adds hook to UserPromptSubmit event
- Preserves all existing Claude Code settings
- No manual configuration needed!

### 2. Usage

```bash
# View project status
ccheckpoint status

# Create manual checkpoint
ccheckpoint create "Before major changes"

# List checkpoints (● indicates current)
ccheckpoint list
● a1b2c3d4 Major release v2.0
  e5f6g7h8 Bug fix release v1.1
  i9j0k1l2 Initial release v1.0

# Interactive restore (no ID needed!)
ccheckpoint restore

# Restore to specific checkpoint
ccheckpoint restore a1b2c3d4 --force

# Cancel last restore
ccheckpoint restore --cancel

# View differences
ccheckpoint diff <checkpoint-id>

# Clean old checkpoints
ccheckpoint clean --days 7 --force
```

## 🛠️ Commands

### `ccheckpoint setup`
Auto-configure Claude Code hook (run once).

### `ccheckpoint unsetup`  
Remove Claude Code hook configuration.

### `ccheckpoint create [message]`
Create checkpoint manually.

### `ccheckpoint list [options]`
List checkpoints with current state indicator (● = current).
- `-a, --all`: Show all projects
- `-s, --session <id>`: Filter by session
- `-n, --limit <number>`: Limit results (default: 20)

### `ccheckpoint restore [id]`
Interactive restore with visual checkpoint selection.
- No ID: Shows interactive menu
- `--cancel`: Undo last restore operation
- `--force`: Skip confirmation prompt

⚠️ **Warning**: This overwrites current files. Use `--cancel` to undo.

### `ccheckpoint diff <id>`
Show differences from checkpoint.

### `ccheckpoint clean [options]`
Clean old checkpoints.
- `-d, --days <number>`: Remove older than N days (default: 7)
- `-f, --force`: Skip confirmation

### `ccheckpoint status`
Show current project status.

### `ccheckpoint statusline`
Output current checkpoint for Claude Code statusline integration.

## 📁 Storage

Data stored in `~/.ccheckpoint/`:

```
~/.ccheckpoint/
├── config.json              # Global config
└── projects/
    └── project-abc123/       # Project hash (MD5 of path)
        ├── .git/            # Git repository for version control
        └── snapshots/       # Current project files snapshot
```

**How it works**: Each checkpoint is a Git commit containing project snapshots. All metadata is stored directly in Git commit messages, eliminating sync issues.

## 🔧 Configuration

### Claude Code Hook
Setup automatically adds this to your Claude Code settings:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "ccheckpoint hook"
      }]
    }]
  }
}
```

### Custom Ignore Patterns
Edit `~/.ccheckpoint/config.json`:

```json
{
  "ignore": {
    "customPatterns": [
      "*.cache",
      "tmp/**",
      "secret-files/"
    ]
  }
}
```

### Claude Code Statusline Integration
Configure Claude Code statusline to display current checkpoint in Claude Code's status bar:
```json
{
  "statusLine": {
    "type": "command", 
    "command": "ccheckpoint statusline",
    "padding": 0
  }
}
```

**Setup with Claude Code:**
1. Run `/statusline` in Claude Code
2. Select "Create custom status line"
3. Use one of the commands above

**Output format:** `📍 a1b2c3d4 • checkpoint message`

## 📄 License

MIT License

---

## 🚀 What's New

- **Git-powered architecture**: All data stored in Git commits for maximum reliability
- **Interactive restore menu**: Visual checkpoint selection - no more copying IDs!
- **Current state indicator**: Green ● shows exactly where you are
- **Smart restore/cancel**: Full undo capability with `restore --cancel`
- **Zero metadata files**: No more sync issues between metadata.json and Git

**Enjoy safe AI-assisted development with Cursor-like checkpoint power!** 🎉
