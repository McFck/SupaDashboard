import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cueAssetFiles, resolveWithin, stageSubwayAssets, validateCatalogue } from './stage-subway-assets.mjs';

let root;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const put = async (relative, bytes = Buffer.from(relative)) => {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return bytes;
};

beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'subway-stage-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('Subway asset staging', () => {
  it('rejects paths outside the fixed asset and output roots', () => {
    expect(() => resolveWithin(root, '../outside.opus')).toThrow(/leaves its allowed directory/);
    expect(() => cueAssetFiles({ version: 1, cues: [{ file: '../outside.opus' }] })).toThrow(/leaves its allowed directory/);
  });

  it('fails when a referenced clip is missing', async () => {
    const catalogue = { version: 1, inputs: {}, cues: [{ file: 'lines/yamanote/clips/missing.opus', offset: 0, duration: 1, audible_end: 1, gainByRole: { voice: 1 }, sha256: '0'.repeat(64) }] };
    await expect(validateCatalogue(root, path.join(root, 'assets'), catalogue)).rejects.toThrow(/ENOENT|no such file/i);
  });

  it('stages only manifest clips and returns URLs that exist', async () => {
    const repoRoot = root;
    const assetRoot = path.join(root, 'assets');
    const appRoot = path.join(root, 'app');
    const inputFiles = [];
    for (const id of ['yamanote', 'hibiya', 'sakaisuji']) {
      for (const name of ['line.json', 'pack.json']) inputFiles.push(`assets/lines/${id}/${name}`);
    }
    inputFiles.push('assets/sources.json');
    const inputs = {};
    for (const relative of inputFiles) inputs[relative] = sha(await put(relative));
    const staticFiles = [
      'assets/motion/data.js', 'assets/motion/engine.js', 'assets/motion/door-sequence.js',
    ];
    for (const relative of staticFiles) await put(relative);
    const clipBytes = await put('assets/lines/yamanote/clips/door.opus');
    const catalogue = {
      version: 1,
      inputs,
      cues: [{ file: 'lines/yamanote/clips/door.opus', offset: 0, duration: 1, audible_end: 0.8, gainByRole: { mechanics: 1 }, sha256: sha(clipBytes) }],
    };
    await put('assets/motion/runtime-cues.json', Buffer.from(JSON.stringify(catalogue)));
    const result = await stageSubwayAssets({ repoRoot, assetRoot, appRoot });
    expect(result.files).toBe(12);
    expect(result.urls).toContain('/subway/lines/yamanote/clips/door.opus');
    for (const url of result.urls) {
      const staged = path.join(result.outputRoot, decodeURIComponent(url.slice('/subway/'.length)));
      await expect(readFile(staged)).resolves.toBeDefined();
    }
  });
});
