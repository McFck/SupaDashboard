// Builds every plugin host process and stages each plugin folder (manifest + executable) in
// src-tauri/plugins-dist, which the app bundles as its `plugins` resource folder.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const release = process.argv[2] === 'release';
const app = path.resolve(import.meta.dirname, '..');
const staged = path.join(app, 'src-tauri/plugins-dist');

execFileSync(
  'cargo',
  ['build', '--workspace', '--exclude', 'supadashboard', ...(release ? ['--release'] : [])],
  { cwd: app, stdio: 'inherit' },
);
for (const entry of fs.readdirSync(staged, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    fs.rmSync(path.join(staged, entry.name), { recursive: true });
  }
}
for (const id of fs.readdirSync(path.join(app, 'plugins'))) {
  const manifest = path.join(app, 'plugins', id, 'plugin.json');
  if (!fs.existsSync(manifest)) {
    continue;
  }
  const { exe } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const folder = path.join(staged, id);
  fs.mkdirSync(folder);
  fs.copyFileSync(manifest, path.join(folder, 'plugin.json'));
  fs.copyFileSync(
    path.join(app, 'target', release ? 'release' : 'debug', exe),
    path.join(folder, exe),
  );
}
