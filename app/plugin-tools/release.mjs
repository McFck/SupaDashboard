// Signs plugin releases for SupaDashboard (CI and local builds).
//   node release.mjs <plugin folder>          writes release.json (SHA-256 of every plugin file) and release.sig
//   node release.mjs --catalogue <file.json>  writes catalogue.sig next to the catalogue
// The key is the P-256 private key PEM in env PLUGIN_SIGNING_KEY. Without it a plugin folder is left unsigned (no
// release.json, so the app installs it only as unverified); a catalogue is never left unsigned.
// Signatures are base64 of the 64-byte r || s form the app verifies (`plugin_host/trust.rs`).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// `valid_file_name` in plugin_host/manifest.rs: a plugin folder holds bare files and files in ui/, nothing else.
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const SIGNATURE = ['release.json', 'release.sig'];
const key = process.env.PLUGIN_SIGNING_KEY;

function sign(bytes) {
  return crypto.sign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

function files(folder, dir = '') {
  const found = [];
  for (const entry of fs.readdirSync(path.join(folder, dir), { withFileTypes: true })) {
    const name = dir ? `${dir}/${entry.name}` : entry.name;
    if (!dir && entry.isDirectory() && entry.name === 'ui') {
      found.push(...files(folder, 'ui'));
    } else if (entry.isFile() && NAME.test(entry.name)) {
      found.push(name);
    } else {
      throw new Error(`${name} cannot be part of a plugin`);
    }
  }
  return found;
}

function release(folder) {
  for (const name of SIGNATURE) {
    fs.rmSync(path.join(folder, name), { force: true });
  }
  if (!key) {
    console.log(`${folder}: unsigned`);
    return;
  }
  const { id, version, api } = JSON.parse(
    fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'),
  );
  const hashes = Object.fromEntries(
    files(folder)
      .sort()
      .map((name) => [
        name,
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(folder, name)))
          .digest('hex'),
      ]),
  );
  const bytes = Buffer.from(JSON.stringify({ format: 1, id, version, api, files: hashes }));
  fs.writeFileSync(path.join(folder, 'release.json'), bytes);
  fs.writeFileSync(path.join(folder, 'release.sig'), sign(bytes));
  console.log(`${folder}: signed ${id} ${version}`);
}

function catalogue(file) {
  if (!key) {
    throw new Error('PLUGIN_SIGNING_KEY is required to sign a catalogue');
  }
  fs.writeFileSync(path.join(path.dirname(file), 'catalogue.sig'), sign(fs.readFileSync(file)));
}

const [first, second] = process.argv.slice(2);
if (first === '--catalogue' && second) {
  catalogue(second);
} else if (first && !second) {
  release(first);
} else {
  throw new Error('Usage: node release.mjs <plugin folder> | --catalogue <catalogue.json>');
}
