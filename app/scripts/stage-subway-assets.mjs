import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const ASSET_ROOT = path.join(REPO_ROOT, 'assets');
const LINE_IDS = ['yamanote', 'hibiya', 'sakaisuji'];
const STATIC_ASSETS = [
  'assets/motion/runtime-cues.json',
  'assets/motion/data.js',
  'assets/motion/engine.js',
  'assets/motion/door-sequence.js',
  ...LINE_IDS.flatMap(id => [`assets/lines/${id}/line.json`, `assets/lines/${id}/pack.json`]),
];
const REBUILD = 'python ../tools/build_subway_catalog.py';

export function resolveWithin(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe path: ${relative}`);
  }
  const target = path.resolve(root, relative);
  const fromRoot = path.relative(path.resolve(root), target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error(`Path leaves its allowed directory: ${relative}`);
  }
  return target;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readSafe(root, relative) {
  const file = resolveWithin(root, relative);
  const realRoot = await realpath(root);
  const realFile = await realpath(file);
  const within = path.relative(realRoot, realFile);
  if (within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
    throw new Error(`Resolved file leaves its allowed directory: ${relative}`);
  }
  return { file: realFile, bytes: await readFile(realFile) };
}

export function cueAssetFiles(catalogue) {
  if (!catalogue || catalogue.version !== 1 || !Array.isArray(catalogue.cues) ||
      !catalogue.inputs || typeof catalogue.inputs !== 'object' || Array.isArray(catalogue.inputs)) {
    throw new Error('Invalid runtime-cues.json catalogue');
  }
  const files = new Set(STATIC_ASSETS);
  const seen = new Set();
  for (const cue of catalogue.cues) {
    if (!cue || typeof cue.file !== 'string') throw new Error('Catalogue cue is missing its file path');
    if (seen.has(cue.file)) throw new Error(`Duplicate catalogue cue: ${cue.file}`);
    seen.add(cue.file);
    resolveWithin(ASSET_ROOT, cue.file);
    if (!Number.isFinite(cue.offset) || cue.offset < 0 || !Number.isFinite(cue.duration) || cue.duration <= 0 ||
        !Number.isFinite(cue.audible_end) || cue.audible_end < 0 || cue.audible_end > cue.duration) {
      throw new Error(`Invalid cue bounds: ${cue.file}`);
    }
    if (!cue.gainByRole || Object.values(cue.gainByRole).some(gain => !Number.isFinite(gain) || gain < 0 || gain > 4)) {
      throw new Error(`Invalid cue role gains: ${cue.file}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(cue.sha256 || '')) throw new Error(`Missing cue hash: ${cue.file}`);
    files.add(`assets/${cue.file}`);
  }
  for (const [relative, hash] of Object.entries(catalogue.inputs || {})) {
    if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error(`Invalid input hash: ${relative}`);
  }
  return [...files].sort();
}

export async function validateCatalogue(repoRoot, assetRoot, catalogue) {
  const files = cueAssetFiles(catalogue);
  for (const [relative, expected] of Object.entries(catalogue.inputs || {})) {
    const { bytes } = await readSafe(repoRoot, relative);
    if (digest(bytes) !== expected) throw new Error(`Catalogue is stale for ${relative}`);
  }
  for (const cue of catalogue.cues) {
    const { bytes } = await readSafe(assetRoot, cue.file);
    if (digest(bytes) !== cue.sha256) throw new Error(`Catalogue hash mismatch: ${cue.file}`);
  }
  for (const file of files) {
    const relative = file.startsWith('assets/') ? file.slice('assets/'.length) : file;
    await readSafe(assetRoot, relative);
  }
  for (const id of LINE_IDS) {
    if (!catalogue.inputs?.[`assets/lines/${id}/line.json`] || !catalogue.inputs?.[`assets/lines/${id}/pack.json`]) {
      throw new Error(`Catalogue is missing ${id} input hashes`);
    }
  }
  return files;
}

export async function stageSubwayAssets({ repoRoot = REPO_ROOT, assetRoot = path.join(repoRoot, 'assets'), appRoot = path.join(repoRoot, 'app') } = {}) {
  const outputRoot = resolveWithin(appRoot, 'public/subway');
  const { bytes: catalogueBytes } = await readSafe(assetRoot, 'motion/runtime-cues.json');
  let catalogue;
  try {
    catalogue = JSON.parse(catalogueBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid runtime-cues.json: ${error.message}`);
  }
  const files = await validateCatalogue(repoRoot, assetRoot, catalogue);
  await mkdir(outputRoot, { recursive: true });
  const urls = [];
  for (const file of files) {
    const assetRelative = file.startsWith('assets/') ? file.slice('assets/'.length) : file;
    const source = resolveWithin(assetRoot, assetRelative);
    const destination = resolveWithin(outputRoot, assetRelative);
    await mkdir(path.dirname(destination), { recursive: true });
    const [sourceStat, destinationStat] = await Promise.all([
      stat(source), stat(destination).catch(() => null),
    ]);
    if (!destinationStat || destinationStat.size !== sourceStat.size || destinationStat.mtimeMs !== sourceStat.mtimeMs) {
      await copyFile(source, destination);
    }
    urls.push(`/subway/${assetRelative.split('/').map(encodeURIComponent).join('/')}`);
  }
  return { files: files.length, urls, outputRoot };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageSubwayAssets().then(result => {
    console.log(`Staged ${result.files} Subway files under app/public/subway`);
  }).catch(error => {
    console.error(`${error.message}\nRebuild the catalogue from app/: ${REBUILD}`);
    process.exitCode = 1;
  });
}
