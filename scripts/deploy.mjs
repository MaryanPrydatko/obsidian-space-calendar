// Copies the built plugin into the personal vault. Files are copied, never symlinked: Syncthing would ship a dangling link.
import { copyFileSync, mkdirSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dest = process.env.SPACE_CAL_DEST || join(homedir(), 'Obsidian/salamind/.obsidian/plugins/space-calendar');
mkdirSync(dest, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  const to = join(dest, f);
  try { if (lstatSync(to).isSymbolicLink()) throw new Error(to + ' is a symlink; remove it first'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  copyFileSync(f, to);
}
console.log('deployed to ' + dest);
