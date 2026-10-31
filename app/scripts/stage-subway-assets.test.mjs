import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cueAssetFiles,
  motionAssetFiles,
  resolveWithin,
  stageSubwayAssets,
  validateCatalogue,
} from './stage-subway-assets.mjs';

let root;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const put = async (relative, bytes = Buffer.from(relative)) => {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return bytes;
};

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'subway-stage-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Subway asset staging', () => {
  it('rejects paths outside the fixed asset and output roots', () => {
    expect(() => resolveWithin(root, '../outside.opus')).toThrow(/Unsafe path/);
    expect(() =>
      cueAssetFiles({ version: 1, inputs: {}, cues: [{ file: '../outside.opus' }] }),
    ).toThrow(/Unsafe path/);
    expect(() =>
      motionAssetFiles({
        version: 1,
        clips: { joint: { file: '../outside.opus', sha256: '0'.repeat(64) } },
      }),
    ).toThrow(/Unsafe path/);
  });

  it('fails when a referenced clip is missing', async () => {
    const catalogue = {
      version: 1,
      inputs: {},
      cues: [
        {
          file: 'lines/yamanote/clips/missing.opus',
          offset: 0,
          duration: 1,
          audible_end: 1,
          gainByRole: { voice: 1 },
          sha256: '0'.repeat(64),
        },
      ],
    };
    await expect(validateCatalogue(root, path.join(root, 'assets'), catalogue)).rejects.toThrow(
      /ENOENT|no such file/i,
    );
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
    await put('assets/motion/door-sequence.js');
    const motionClip = await put('assets/motion/clips/shared/joint-01.opus');
    const motion = {
      version: 1,
      clips: {
        'shared/joint-01': { file: 'motion/clips/shared/joint-01.opus', sha256: sha(motionClip) },
      },
    };
    await put('assets/motion/motion.json', Buffer.from(JSON.stringify(motion)));
    const clipBytes = await put('assets/lines/yamanote/clips/door.opus');
    const catalogue = {
      version: 1,
      inputs,
      cues: [
        {
          file: 'lines/yamanote/clips/door.opus',
          offset: 0,
          duration: 1,
          audible_end: 0.8,
          gainByRole: { mechanics: 1 },
          sha256: sha(clipBytes),
        },
      ],
    };
    await put('assets/motion/runtime-cues.json', Buffer.from(JSON.stringify(catalogue)));
    const result = await stageSubwayAssets({ repoRoot, assetRoot, appRoot });
    expect(result.files).toBe(11);
    expect(result.urls).toContain('/subway/lines/yamanote/clips/door.opus');
    expect(result.urls).toContain('/subway/motion/clips/shared/joint-01.opus');
    expect(result.urls).not.toContain('/subway/sources.json');
    for (const url of result.urls) {
      const staged = path.join(result.outputRoot, decodeURIComponent(url.slice('/subway/'.length)));
      await expect(readFile(staged)).resolves.toBeDefined();
    }
  });

  it('refuses to stage a motion clip whose bytes no longer match its hash', async () => {
    await put('assets/motion/clips/shared/joint-01.opus', Buffer.from('changed'));
    await expect(
      stageSubwayAssets({
        repoRoot: root,
        assetRoot: path.join(root, 'assets'),
        appRoot: path.join(root, 'app'),
      }),
    ).rejects.toThrow(/Motion clip hash mismatch/);
  });
});
