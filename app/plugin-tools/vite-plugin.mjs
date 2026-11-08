// Vite config for an external plugin's UI: `export default pluginConfig({ entry: 'ui/src/index.ts', outDir })`.
// Writes `<outDir>/index.js` (IIFE) and `<outDir>/index.css`. Svelte and the kit come from the app's module table
// (`features/plugins/external/load.ts`), so the plugin runs on the app's Svelte instance; bundling any other part of
// Svelte would start a second runtime and fails the build, as does compiling with a different Svelte version.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const SHARED = [
  'svelte',
  'svelte/internal/client',
  'svelte/easing',
  'svelte/motion',
  'svelte/reactivity',
  'svelte/store',
  'svelte/transition',
  '@supadashboard/kit',
];

function checkSvelteVersion(root) {
  const app = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const own = createRequire(path.join(root, 'package.json'))('svelte/package.json').version;
  if (own !== app.devDependencies.svelte) {
    throw new Error(`Plugins must build with svelte ${app.devDependencies.svelte}, found ${own}`);
  }
}

const sharedSvelteOnly = {
  name: 'supadashboard-shared-svelte',
  load(id) {
    if (/[\\/]node_modules[\\/]svelte[\\/]/.test(id)) {
      this.error(`Svelte is bundled through ${id}; import only ${SHARED.join(', ')}`);
    }
  },
};

/** The app always loads both files, so a UI without styles still gets an empty stylesheet. */
const alwaysStyle = (outDir) => ({
  name: 'supadashboard-always-style',
  writeBundle() {
    const style = path.join(outDir, 'index.css');
    if (!fs.existsSync(style)) {
      fs.writeFileSync(style, '');
    }
  },
});

export function pluginConfig({ entry, outDir }) {
  const root = process.cwd();
  checkSvelteVersion(root);
  const out = path.resolve(root, outDir);
  return {
    plugins: [
      tailwindcss(),
      svelte({ compilerOptions: { runes: true, discloseVersion: false } }),
      sharedSvelteOnly,
      alwaysStyle(out),
    ],
    build: {
      outDir: out,
      emptyOutDir: true,
      lib: {
        entry: path.resolve(root, entry),
        formats: ['iife'],
        name: '__supadashboard.plugin',
        fileName: () => 'index.js',
        cssFileName: 'index',
      },
      rollupOptions: {
        external: SHARED,
        output: {
          exports: 'default',
          extend: true,
          globals: Object.fromEntries(
            SHARED.map((id) => [id, `__supadashboard[${JSON.stringify(id)}]`]),
          ),
        },
      },
    },
  };
}
