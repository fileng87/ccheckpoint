import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

export class StorageManager {
  private readonly baseDir: string;

  constructor() {
    this.baseDir = path.join(os.homedir(), '.ccheckpoint');
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  getProjectsDir(): string {
    return path.join(this.baseDir, 'projects');
  }

  getConfigPath(): string {
    return path.join(this.baseDir, 'config.json');
  }

  getHooksDir(): string {
    return path.join(this.baseDir, 'hooks');
  }

  getCheckpointDir(projectId: string): string {
    return path.join(this.getProjectsDir(), projectId);
  }

  getSnapshotsDir(projectId: string): string {
    return path.join(this.getCheckpointDir(projectId), 'snapshots');
  }

  async ensureBaseDirectory(): Promise<void> {
    await fs.ensureDir(this.baseDir);
    await fs.ensureDir(this.getProjectsDir());
    await fs.ensureDir(this.getHooksDir());
  }

  async getStorageInfo(): Promise<{
    baseDir: string;
    totalProjects: number;
    totalSize: string;
    configExists: boolean;
  }> {
    await this.ensureBaseDirectory();

    const projectsDir = this.getProjectsDir();
    let totalProjects = 0;
    let totalSize = 0;

    if (await fs.pathExists(projectsDir)) {
      const projects = await fs.readdir(projectsDir);
      totalProjects = projects.length;

      for (const project of projects) {
        const projectPath = path.join(projectsDir, project);
        totalSize += await this.calculateDirectorySize(projectPath);
      }
    }

    const configExists = await fs.pathExists(this.getConfigPath());

    return {
      baseDir: this.baseDir,
      totalProjects,
      totalSize: this.formatBytes(totalSize),
      configExists,
    };
  }

  async cleanup(daysOld: number = 30): Promise<{
    removedProjects: number;
    freedSpace: string;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const projectsDir = this.getProjectsDir();
    if (!(await fs.pathExists(projectsDir))) {
      return { removedProjects: 0, freedSpace: '0 B' };
    }

    const projects = await fs.readdir(projectsDir);
    let removedProjects = 0;
    let freedSpace = 0;

    for (const project of projects) {
      const projectPath = path.join(projectsDir, project);
      const projectStat = await fs.stat(projectPath);

      if (projectStat.mtime < cutoffDate) {
        const size = await this.calculateDirectorySize(projectPath);
        await fs.remove(projectPath);
        removedProjects++;
        freedSpace += size;
      }
    }

    return {
      removedProjects,
      freedSpace: this.formatBytes(freedSpace),
    };
  }

  async validateStorage(): Promise<{
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  }> {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check base directory
    if (!(await fs.pathExists(this.baseDir))) {
      issues.push('Base directory does not exist');
      suggestions.push('Run ccheckpoint setup to initialize');
    }

    // Check permissions
    try {
      const testFile = path.join(this.baseDir, 'test-write');
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
    } catch {
      issues.push('No write permission to storage directory');
      suggestions.push(
        'Check directory permissions or run with appropriate privileges'
      );
    }

    // Check project directory
    const projectsDir = this.getProjectsDir();
    if (await fs.pathExists(projectsDir)) {
      const projects = await fs.readdir(projectsDir);
      let corruptedProjects = 0;

      // Check for basic directory structure issues
      for (const project of projects) {
        const projectPath = path.join(projectsDir, project);
        try {
          const projectStat = await fs.stat(projectPath);
          if (!projectStat.isDirectory()) {
            corruptedProjects++;
          }
        } catch {
          corruptedProjects++;
        }
      }

      if (corruptedProjects > 0) {
        issues.push(`Found ${corruptedProjects} invalid project directories`);
        suggestions.push('Run ccheckpoint clean to remove invalid projects');
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      suggestions,
    };
  }

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    if (!(await fs.pathExists(dirPath))) {
      return 0;
    }

    let size = 0;
    try {
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
    } catch {
      // Ignore inaccessible directories
    }

    return size;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
