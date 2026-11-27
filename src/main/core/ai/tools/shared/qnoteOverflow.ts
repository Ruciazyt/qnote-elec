import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'data';
}

export function createUserDataOverflowWriter(
  dirName: string
): (label: string, content: string) => Promise<string> {
  return async (label, content) => {
    const dir = path.join(app.getPath('userData'), dirName);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, Date.now() + '-' + sanitizeLabel(label) + '.txt');
    await fs.writeFile(file, content, 'utf8');
    return file;
  };
}
