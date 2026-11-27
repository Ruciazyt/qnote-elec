import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const OVERFLOW_DIR = 'github-overflow';

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'data';
}

export async function writeOverflowFile(label: string, content: string): Promise<string> {
  const dir = path.join(os.tmpdir(), OVERFLOW_DIR);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, Date.now() + '-' + sanitizeLabel(label) + '.txt');
  await fs.writeFile(file, content, 'utf8');
  return file;
}
