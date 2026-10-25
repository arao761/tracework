import { readFile, mkdir, writeFile, copyFile, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'desktop/runtime.json'), 'utf8'));
const platform = process.env.TRACEWORK_TARGET_PLATFORM || process.platform;
const arch = process.env.TRACEWORK_TARGET_ARCH || process.arch;
if (!['darwin', 'win32', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch))
  throw new Error('Unsupported desktop runtime target');
const target = platform === 'win32' ? 'win' : platform;
const ext = platform === 'win32' ? 'zip' : 'tar.gz';
const stem = `node-v${version}-${target}-${arch}`;
const filename = `${stem}.${ext}`;
const directory = join(root, 'build', 'runtime', `${platform}-${arch}`);
const binary = join(directory, platform === 'win32' ? 'node.exe' : 'node');
try {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version === version && manifest.platform === platform && manifest.arch === arch) {
    const bytes = await readFile(binary);
    if (createHash('sha256').update(bytes).digest('hex') === manifest.binarySha256) {
      console.log(`Verified bundled Node ${version} (${platform}/${arch})`);
      process.exit(0);
    }
  }
} catch {}
const base = `https://nodejs.org/dist/v${version}/`;
async function get(name) {
  const r = await fetch(base + name, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Node download failed: ${r.status} ${name}`);
  return Buffer.from(await r.arrayBuffer());
}
console.log(`Downloading official Node ${version} for ${platform}/${arch}…`);
const sums = (await get('SHASUMS256.txt')).toString();
const expected = sums
  .split('\n')
  .map((l) => l.trim().split(/\s+/))
  .find((r) => r[1] === filename)?.[0];
if (!expected) throw new Error('Runtime archive is not present in official checksums');
const bytes = await get(filename);
const archiveSha256 = createHash('sha256').update(bytes).digest('hex');
if (archiveSha256 !== expected) throw new Error('Runtime SHA-256 mismatch');
const temp = join(root, 'build', `node-extract-${platform}-${arch}`);
await mkdir(temp, { recursive: true });
await mkdir(directory, { recursive: true });
const archive = join(temp, filename);
await writeFile(archive, bytes);
execFileSync('tar', ['-xf', archive, '-C', temp]);
await copyFile(join(temp, stem, platform === 'win32' ? 'node.exe' : 'bin/node'), binary);
await chmod(binary, 0o755);
await copyFile(join(temp, stem, 'LICENSE'), join(directory, 'NODE-LICENSE.txt'));
const binarySha256 = createHash('sha256')
  .update(await readFile(binary))
  .digest('hex');
await writeFile(
  join(directory, 'manifest.json'),
  JSON.stringify(
    { version, platform, arch, archive: filename, archiveSha256, binarySha256 },
    null,
    2,
  ),
);
await rm(temp, { recursive: true, force: true });
console.log(`Prepared checksum-verified runtime at ${binary}`);
