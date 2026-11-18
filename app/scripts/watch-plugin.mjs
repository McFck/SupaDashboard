import { cpSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { pluginConfig } from '../plugin-tools/vite-plugin.mjs';

const [target] = process.argv.slice(2);
const buildDir = path.join(target, 'build');
const stage = path.join(target, 'plugin');
const ui = path.join(stage, 'ui');
const manifest = path.resolve('plugin.json');
let ready = false;

mkdirSync(ui, { recursive: true });
if (existsSync('assets')) {
  cpSync('assets', path.join(stage, 'assets'), { recursive: true });
}

const config = pluginConfig({ entry: 'ui/src/index.ts', outDir: buildDir });
const watcher = await build({
  ...config,
  configFile: false,
  logLevel: 'warn',
  resolve: {
    alias: [
      {
        find: /^.*\/supadashboard\/app\/plugin-tools\/plugin\.css$/,
        replacement: path.resolve(import.meta.dirname, '../plugin-tools/plugin.css'),
      },
    ],
  },
  plugins: [
    ...config.plugins,
    {
      name: 'watch-plugin-manifest',
      buildStart() {
        this.addWatchFile(manifest);
      },
    },
  ],
  build: { ...config.build, watch: {} },
});
watcher.on('event', async (event) => {
  if (event.code === 'ERROR' && !ready) {
    await watcher.close();
    process.exitCode = 1;
    process.disconnect();
  }
  if (event.code === 'BUNDLE_END') {
    await event.result.close();
    cpSync(manifest, path.join(stage, 'plugin.json'));
    // Publish JS last so the native watcher only sees completed builds.
    for (const file of ['index.css', 'index.js']) {
      renameSync(path.join(buildDir, file), path.join(ui, file));
    }
    if (!ready) {
      ready = true;
      process.send('ready');
    }
  }
});
