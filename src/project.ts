import * as crypto from 'crypto';
import * as path from 'path';

import { StorageManager } from './storage';

export class ProjectManager {
  private storageManager: StorageManager;

  constructor() {
    this.storageManager = new StorageManager();
  }

  getProjectId(projectPath: string): string {
    const absolutePath = path.resolve(projectPath);
    return crypto
      .createHash('md5')
      .update(absolutePath)
      .digest('hex')
      .slice(0, 12);
  }

  async getProjectInfo(
    projectPath: string
  ): Promise<{ id: string; name: string; path: string }> {
    const projectId = this.getProjectId(projectPath);
    const projectName = path.basename(projectPath);

    return {
      id: projectId,
      name: projectName,
      path: path.resolve(projectPath),
    };
  }

  async getPromptIndexFromTranscript(
    transcriptPath: string | undefined
  ): Promise<number> {
    if (!transcriptPath) {
      return Date.now();
    }

    try {
      const fs = await import('fs-extra');
      if (await fs.pathExists(transcriptPath)) {
        const transcript = await fs.readJSON(transcriptPath);
        if (transcript.messages && Array.isArray(transcript.messages)) {
          return transcript.messages.filter(
            (m: { role: string }) => m.role === 'user'
          ).length;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to parse transcript: ${message}`);
    }

    return Date.now();
  }
}
