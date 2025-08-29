import * as fs from 'fs-extra';
import git from 'isomorphic-git';
import * as path from 'path';

import { ProjectManager } from './project';
import { StorageManager } from './storage';

export interface CheckpointData {
  id: string;
  sessionId: string;
  promptIndex: number;
  message: string;
  timestamp: string;
  projectPath: string;
}

export interface ListOptions {
  all?: boolean;
  sessionId?: string;
  limit?: number;
}

export interface StatusInfo {
  projectPath: string;
  totalCheckpoints: number;
  latest: CheckpointData | undefined;
  storageSize: string;
}

export class CheckpointManager {
  private projectManager: ProjectManager;
  private storageManager: StorageManager;

  constructor() {
    this.projectManager = new ProjectManager();
    this.storageManager = new StorageManager();
  }

  private async safeGitOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git operation '${operationName}' failed: ${message}`);
    }
  }

  private parseCommitMessage(
    message: string,
    oid: string,
    projectPath: string
  ): CheckpointData | null {
    // Parse format: "Session: <sessionId> - <message>" or directly "<message>"
    const sessionMatch = message.match(/^Session: ([a-f0-9-]+) - (.+)$/);

    if (sessionMatch) {
      // Format with session information
      return {
        id: oid,
        sessionId: sessionMatch[1]!,
        promptIndex: Date.now(), // Temporary value, not actually needed
        message: sessionMatch[2]!,
        timestamp: new Date().toISOString(), // Will get actual time from Git commit
        projectPath,
      };
    } else {
      // Simple format, assume manual session
      return {
        id: oid,
        sessionId: 'manual',
        promptIndex: Date.now(),
        message: message,
        timestamp: new Date().toISOString(),
        projectPath,
      };
    }
  }

  async create(
    message: string,
    sessionId?: string,
    promptIndex?: number
  ): Promise<CheckpointData> {
    const projectPath = process.cwd();
    const projectId = this.projectManager.getProjectId(projectPath);
    const checkpointDir = this.storageManager.getCheckpointDir(projectId);

    // Get Claude Code hook data from environment variables
    const hookSessionId = process.env.CCHECKPOINT_SESSION_ID;
    const transcriptPath = process.env.CCHECKPOINT_TRANSCRIPT_PATH;

    // Use hook provided data or fallback to parameters
    const finalSessionId = hookSessionId || sessionId || 'manual';
    const finalPromptIndex =
      promptIndex ||
      (await this.projectManager.getPromptIndexFromTranscript(transcriptPath));

    // Ensure checkpoint directory exists
    await fs.ensureDir(checkpointDir);

    // Initialize Git repository (if it doesn't exist)
    const gitDir = path.join(checkpointDir, '.git');
    if (!(await fs.pathExists(gitDir))) {
      await git.init({ fs, dir: checkpointDir, defaultBranch: 'main' });
    }

    // Sync project files to snapshots directory
    const snapshotsDir = path.join(checkpointDir, 'snapshots');
    await this.syncProjectToSnapshots(projectPath, snapshotsDir);

    // Create Git commit
    await this.safeGitOperation(
      () => git.add({ fs, dir: checkpointDir, filepath: '.' }),
      'add files to staging'
    );

    const sha = await this.safeGitOperation(
      () =>
        git.commit({
          fs,
          dir: checkpointDir,
          message,
          author: {
            name: 'CCheckpoint',
            email: 'checkpoint@ccheckpoint.local',
          },
        }),
      'create commit'
    );

    // Ensure HEAD points to the newly created commit
    await this.safeGitOperation(
      () =>
        git.writeRef({
          fs,
          dir: checkpointDir,
          ref: 'HEAD',
          value: sha,
          force: true,
        }),
      'update HEAD reference'
    );

    const checkpointData: CheckpointData = {
      id: sha,
      sessionId: finalSessionId,
      promptIndex: finalPromptIndex,
      message,
      timestamp: new Date().toISOString(),
      projectPath,
    };

    return checkpointData;
  }

  async list(options: ListOptions = {}): Promise<CheckpointData[]> {
    if (options.all) {
      return this.listAllProjects(options);
    }

    const projectPath = process.cwd();
    const projectId = this.projectManager.getProjectId(projectPath);
    const checkpointDir = this.storageManager.getCheckpointDir(projectId);

    // Read all reachable commits from Git history
    const checkpoints: CheckpointData[] = [];

    try {
      const commits = await this.safeGitOperation(
        () => git.log({ fs, dir: checkpointDir, depth: options.limit || 100 }),
        'read git history'
      );

      for (const commit of commits) {
        // Parse commit message to get checkpoint information
        const checkpointData = this.parseCommitMessage(
          commit.commit.message,
          commit.oid,
          projectPath
        );
        if (checkpointData) {
          // Use actual commit timestamp
          checkpointData.timestamp = new Date(
            commit.commit.committer.timestamp * 1000
          ).toISOString();
          checkpoints.push(checkpointData);
        }
      }
    } catch {
      // If no Git history, return empty array
      return [];
    }

    // Sort by timestamp (newest first)
    checkpoints.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Apply filters
    let filteredCheckpoints = checkpoints;

    if (options.sessionId) {
      filteredCheckpoints = filteredCheckpoints.filter((cp) =>
        cp.sessionId.startsWith(options.sessionId!)
      );
    }

    if (options.limit) {
      filteredCheckpoints = filteredCheckpoints.slice(0, options.limit);
    }

    return filteredCheckpoints;
  }

  async getCurrentCheckpoint(): Promise<string | null> {
    const projectPath = process.cwd();
    const projectId = this.projectManager.getProjectId(projectPath);
    const checkpointDir = this.storageManager.getCheckpointDir(projectId);

    try {
      const currentRef = await git.resolveRef({
        fs,
        dir: checkpointDir,
        ref: 'HEAD',
      });
      return currentRef;
    } catch {
      return null;
    }
  }

  async restore(id: string): Promise<void> {
    const projectPath = process.cwd();
    const projectId = this.projectManager.getProjectId(projectPath);
    const checkpointDir = this.storageManager.getCheckpointDir(projectId);

    // If it's a short ID, try to expand to full commit hash
    let fullId = id;
    try {
      fullId = await this.safeGitOperation(
        () => git.expandOid({ fs, dir: checkpointDir, oid: id }),
        'expand commit ID'
      );
    } catch {
      throw new Error(`Checkpoint ${id} not found`);
    }

    // Check if checkpoint exists
    try {
      await this.safeGitOperation(
        () => git.readCommit({ fs, dir: checkpointDir, oid: fullId }),
        'read commit'
      );
    } catch {
      throw new Error(`Checkpoint ${id} not found`);
    }

    // Save current HEAD to ORIG_HEAD (similar to git reset behavior)
    const currentHead = await this.safeGitOperation(
      () => git.resolveRef({ fs, dir: checkpointDir, ref: 'HEAD' }),
      'resolve current HEAD'
    );

    await this.safeGitOperation(
      () =>
        git.writeRef({
          fs,
          dir: checkpointDir,
          ref: 'ORIG_HEAD',
          value: currentHead,
          force: true,
        }),
      'save ORIG_HEAD'
    );

    // Execute reset --hard to specified checkpoint
    await this.safeGitOperation(
      () =>
        git.writeRef({
          fs,
          dir: checkpointDir,
          ref: 'HEAD',
          value: fullId,
          force: true,
        }),
      'reset HEAD to checkpoint'
    );

    // Restore snapshots directory to specified commit state
    await this.safeGitOperation(
      () =>
        git.checkout({
          fs,
          dir: checkpointDir,
          ref: fullId,
          filepaths: ['snapshots'],
          force: true,
        }),
      'checkout snapshots from checkpoint'
    );

    // Sync from snapshots back to project
    const snapshotsDir = path.join(checkpointDir, 'snapshots');
    await this.syncSnapshotsToProject(snapshotsDir, projectPath);
  }

  async diff(id: string): Promise<Array<{ type: string; path: string }>> {
    const projectPath = process.cwd();
    const projectId = this.projectManager.getProjectId(projectPath);
    const checkpointDir = this.storageManager.getCheckpointDir(projectId);

    // Get current HEAD
    const currentRef = await git.resolveRef({
      fs,
      dir: checkpointDir,
      ref: 'HEAD',
    });

    // Compare differences between two commits
    const changes: Array<{ type: string; path: string }> = [];
    try {
      const walker = git.walk({
        fs,
        dir: checkpointDir,
        trees: [git.TREE({ ref: id }), git.TREE({ ref: currentRef })],
      });

      await (
        await walker
      ).walk(async (filepath: string, [A, B]: unknown[]) => {
        if (filepath === '.') return;

        if (A && !B) {
          changes.push({ type: 'deleted', path: filepath });
        } else if (!A && B) {
          changes.push({ type: 'added', path: filepath });
        } else if (
          A &&
          B &&
          (A as { oid: string }).oid !== (B as { oid: string }).oid
        ) {
          changes.push({ type: 'modified', path: filepath });
        }
      });
    } catch (error: unknown) {
      console.error('Diff error:', error);
    }

    return changes;
  }

  async clean(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const projectPath = process.cwd();
    const projectId = this.projectManager.getProjectId(projectPath);
    const checkpointDir = this.storageManager.getCheckpointDir(projectId);

    let removedCount = 0;

    try {
      const commits = await this.safeGitOperation(
        () => git.log({ fs, dir: checkpointDir }),
        'read git history'
      );

      for (const commit of commits) {
        const commitDate = new Date(commit.commit.committer.timestamp * 1000);
        if (commitDate < cutoffDate) {
          removedCount++;
        }
      }
    } catch {
      // If no Git history, return 0
      return 0;
    }

    return removedCount;
  }

  async status(): Promise<StatusInfo> {
    const projectPath = process.cwd();
    const projectId = this.projectManager.getProjectId(projectPath);
    const checkpointDir = this.storageManager.getCheckpointDir(projectId);

    const allCheckpoints: CheckpointData[] = [];

    try {
      const commits = await this.safeGitOperation(
        () => git.log({ fs, dir: checkpointDir }),
        'read git history'
      );

      for (const commit of commits) {
        const checkpointData = this.parseCommitMessage(
          commit.commit.message,
          commit.oid,
          projectPath
        );
        if (checkpointData) {
          checkpointData.timestamp = new Date(
            commit.commit.committer.timestamp * 1000
          ).toISOString();
          allCheckpoints.push(checkpointData);
        }
      }
    } catch {
      // If no Git history, use empty array
    }

    allCheckpoints.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const storageSize = await this.calculateDirectorySize(checkpointDir);

    return {
      projectPath,
      totalCheckpoints: allCheckpoints.length,
      latest: allCheckpoints.length > 0 ? allCheckpoints[0] : undefined,
      storageSize: this.formatBytes(storageSize),
    };
  }

  private async listAllProjects(
    options: ListOptions
  ): Promise<CheckpointData[]> {
    const allCheckpoints: CheckpointData[] = [];
    const projectsDir = this.storageManager.getProjectsDir();

    if (!(await fs.pathExists(projectsDir))) {
      return allCheckpoints;
    }

    const projectDirs = await fs.readdir(projectsDir);

    for (const projectDir of projectDirs) {
      try {
        const projectId = projectDir;
        const checkpointDir = this.storageManager.getCheckpointDir(projectId);

        try {
          const commits = await this.safeGitOperation(
            () => git.log({ fs, dir: checkpointDir, depth: 50 }),
            'read git history'
          );

          for (const commit of commits) {
            const checkpointData = this.parseCommitMessage(
              commit.commit.message,
              commit.oid,
              'unknown' // We don't have project path info here
            );
            if (checkpointData) {
              checkpointData.timestamp = new Date(
                commit.commit.committer.timestamp * 1000
              ).toISOString();
              allCheckpoints.push(checkpointData);
            }
          }
        } catch {
          // Ignore projects without git history
          continue;
        }
      } catch {
        // Ignore invalid project directories
        continue;
      }
    }

    return allCheckpoints
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, options.limit || 50);
  }

  private async syncProjectToSnapshots(
    projectPath: string,
    snapshotsDir: string
  ): Promise<void> {
    await fs.ensureDir(snapshotsDir);

    const ignorePatterns = [
      'node_modules',
      '.git',
      '.ccheckpoint',
      'dist',
      'build',
      '.env*',
      '*.log',
      '.DS_Store',
    ];

    await this.copyWithIgnore(projectPath, snapshotsDir, ignorePatterns);
  }

  private async syncSnapshotsToProject(
    snapshotsDir: string,
    projectPath: string
  ): Promise<void> {
    // Clean project directory (except ignored files)
    const items = await fs.readdir(projectPath);
    const ignorePatterns = ['node_modules', '.git', '.ccheckpoint'];

    for (const item of items) {
      if (!ignorePatterns.some((pattern) => item.includes(pattern))) {
        await fs.remove(path.join(projectPath, item));
      }
    }

    // Copy from snapshots to project
    await fs.copy(snapshotsDir, projectPath);
  }

  private async copyWithIgnore(
    source: string,
    dest: string,
    ignorePatterns: string[]
  ): Promise<void> {
    const filter = (src: string): boolean => {
      const relativePath = path.relative(source, src);
      return !ignorePatterns.some(
        (pattern) =>
          relativePath.includes(pattern) || path.basename(src).includes(pattern)
      );
    };

    await fs.copy(source, dest, { filter });
  }

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    if (!(await fs.pathExists(dirPath))) {
      return 0;
    }

    let size = 0;
    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      if (item.isFile()) {
        const stats = await fs.stat(itemPath);
        size += stats.size;
      } else if (item.isDirectory()) {
        size += await this.calculateDirectorySize(itemPath);
      }
    }

    return size;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async cancelRestore(): Promise<void> {
    const projectPath = process.cwd();
    const projectId = this.projectManager.getProjectId(projectPath);
    const checkpointDir = this.storageManager.getCheckpointDir(projectId);

    try {
      // Check if ORIG_HEAD exists (similar to git reset behavior)
      const origHead = await this.safeGitOperation(
        () => git.resolveRef({ fs, dir: checkpointDir, ref: 'ORIG_HEAD' }),
        'resolve ORIG_HEAD'
      );

      // Reset back to ORIG_HEAD
      await this.safeGitOperation(
        () =>
          git.writeRef({
            fs,
            dir: checkpointDir,
            ref: 'HEAD',
            value: origHead,
            force: true,
          }),
        'reset to ORIG_HEAD'
      );

      // Restore snapshots to ORIG_HEAD state
      await this.safeGitOperation(
        () =>
          git.checkout({
            fs,
            dir: checkpointDir,
            ref: origHead,
            filepaths: ['snapshots'],
            force: true,
          }),
        'checkout snapshots from ORIG_HEAD'
      );

      // Sync from snapshots back to project
      const snapshotsDir = path.join(checkpointDir, 'snapshots');
      await this.syncSnapshotsToProject(snapshotsDir, projectPath);
    } catch {
      throw new Error('No restore to cancel - ORIG_HEAD not found');
    }
  }
}
