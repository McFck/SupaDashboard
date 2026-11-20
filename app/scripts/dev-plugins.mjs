import { fork } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const app = path.resolve(import.meta.dirname, '..');
const roots =
  process.env.SUPADASHBOARD_PLUGIN_FOLDERS?.split(path.delimiter) ?? (await siblingPluginFolders());
const plugins = [];
for (const root of roots.filter(Boolean)) {
  const directory = path.resolve(app, root);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    if (
      entry.isDirectory() &&
      (await stat(path.join(source, 'plugin.json'), { throwIfNoEntry: false }))?.isFile()
    ) {
      plugins.push(source);
    }
  }
}
if (!plugins.length) {
  throw new Error('No plugin folders found');
}

const staging = await mkdtemp(path.join(tmpdir(), 'supadashboard-plugins-'));
const children = [];
let stop;
const stopped = new Promise((resolve) => {
  stop = resolve;
});
process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));

/** The `plugins` folder of every sibling `supadashboard-*` checkout. */
async function siblingPluginFolders() {
  const projects = path.resolve(app, '../..');
  const folders = (await readdir(projects))
    .filter((name) => name.startsWith('supadashboard-'))
    .map((name) => path.join(projects, name, 'plugins'));
  const found = await Promise.all(
    folders.map(async (folder) => (await stat(folder, { throwIfNoEntry: false }))?.isDirectory()),
  );
  return folders.filter((_, index) => found[index]);
}

async function run() {
  const staged = await Promise.all(
    plugins.map(
      (cwd, index) =>
        new Promise((resolve, reject) => {
          const target = path.join(staging, String(index));
          const worker = fork(path.join(import.meta.dirname, 'watch-plugin.mjs'), [target], {
            cwd,
          });
          children.push(worker);
          worker.once('message', () => resolve(path.join(target, 'plugin')));
          worker.once('error', reject);
          worker.once('exit', (code) => {
            reject(new Error(`Plugin build stopped: ${cwd} (${code})`));
            stop(1);
          });
        }),
    ),
  );
  const tauri = fork(
    path.join(app, 'node_modules/@tauri-apps/cli/tauri.js'),
    ['dev', ...process.argv.slice(2)],
    {
      cwd: app,
      env: { ...process.env, SUPADASHBOARD_DEV_PLUGINS: staged.join(path.delimiter) },
    },
  );
  children.push(tauri);
  return new Promise((resolve, reject) => {
    tauri.once('error', reject);
    tauri.once('exit', (code) => resolve(code ?? 1));
  });
}

try {
  process.exitCode = await Promise.race([run(), stopped]);
} finally {
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
            resolve();
            return;
          }
          child.once('exit', resolve);
          child.kill();
        }),
    ),
  );
  await rm(staging, { recursive: true, force: true, maxRetries: 3 });
}
