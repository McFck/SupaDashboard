// Packs and signs plugin releases for SupaDashboard (CI and local builds).
//   node release.mjs <plugin folder> <out.sdplugin>  packs plugin.json, ui/* and assets/** into one .sdplugin, with
//                                                    release.json (SHA-256 of every entry) and release.sig
//   node release.mjs --catalogue <file.json>         writes catalogue.sig next to the catalogue
// The key is the P-256 private key PEM in env PLUGIN_SIGNING_KEY. Without it a plugin is packed unsigned (no
// release.json, so the app installs it only as unverified); a catalogue is never left unsigned.
// Signatures are base64 of the 64-byte r || s form the app verifies (`plugin_host/trust.rs`).
// A .sdplugin is a deterministic uncompressed ustar archive (`plugin_host/archive.rs`): sorted regular files, mode
// 0644, uid/gid 0, mtime 0, no directory entries, names of at most 99 bytes, two zero blocks at the end.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// `valid_entry_name` in plugin_host/archive.rs. ponytail: names over 99 bytes need the ustar prefix field.
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const key = process.env.PLUGIN_SIGNING_KEY;

function sign(bytes) {
  return crypto.sign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

/** Entry names under `dir`, `/`-separated. */
function walk(folder, dir) {
  return fs.readdirSync(path.join(folder, dir), { withFileTypes: true }).flatMap((entry) => {
    const name = `${dir}/${entry.name}`;
    if (!SEGMENT.test(entry.name)) {
      throw new Error(`${name} cannot be part of a plugin`);
    }
    if (entry.isDirectory()) {
      return walk(folder, name);
    }
    if (!entry.isFile()) {
      throw new Error(`${name} is not a plain file`);
    }
    return [name];
  });
}

/** plugin.json, ui/* and assets/**; anything else in the folder is an error, never silently left out. */
function entries(folder) {
  const names = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'plugin.json' && entry.isFile()) {
      names.push(entry.name);
    } else if (entry.name === 'assets' && entry.isDirectory()) {
      names.push(...walk(folder, 'assets'));
    } else if (entry.name === 'ui' && entry.isDirectory()) {
      const ui = walk(folder, 'ui');
      const nested = ui.find((name) => name.split('/').length > 2);
      if (nested) {
        throw new Error(`${nested}: ui/ holds files only`);
      }
      names.push(...ui);
    } else {
      throw new Error(`${entry.name} cannot be part of a plugin`);
    }
  }
  for (const required of ['plugin.json', 'ui/index.js', 'ui/index.css']) {
    if (!names.includes(required)) {
      throw new Error(`${required} is missing`);
    }
  }
  return names;
}

function octal(value, width) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name, size) {
  const block = Buffer.alloc(512);
  if (Buffer.byteLength(name) > 99) {
    throw new Error(`${name} is longer than 99 bytes`);
  }
  block.write(name, 0);
  block.write(octal(0o644, 8), 100);
  block.write(octal(0, 8), 108);
  block.write(octal(0, 8), 116);
  block.write(octal(size, 12), 124);
  block.write(octal(0, 12), 136);
  block.write('0', 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  // The checksum is computed with its own field read as spaces.
  block.fill(' ', 148, 156);
  const sum = block.reduce((total, byte) => total + byte, 0);
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return block;
}

function tar(files) {
  const parts = [];
  for (const [name, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    parts.push(header(name, bytes.length), bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function pack(folder, out) {
  const files = new Map(
    entries(folder).map((name) => [name, fs.readFileSync(path.join(folder, name))]),
  );
  const { id, version, api } = JSON.parse(files.get('plugin.json').toString('utf8'));
  if (key) {
    const hashes = Object.fromEntries(
      [...files.keys()]
        .sort()
        .map((name) => [name, crypto.createHash('sha256').update(files.get(name)).digest('hex')]),
    );
    const release = Buffer.from(JSON.stringify({ format: 2, id, version, api, files: hashes }));
    files.set('release.json', release);
    files.set('release.sig', Buffer.from(sign(release)));
  }
  fs.writeFileSync(out, tar(files));
  console.log(`${out}: ${key ? 'signed' : 'unsigned'} ${id} ${version}`);
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
} else if (first && second?.endsWith('.sdplugin')) {
  pack(first, second);
} else {
  throw new Error(
    'Usage: node release.mjs <plugin folder> <out.sdplugin> | --catalogue <catalogue.json>',
  );
}
