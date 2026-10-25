import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out = resolve('dist-server');
await mkdir(out, { recursive: true });
for (const [name, entry] of [
  ['desktop', 'server/desktop.ts'],
  ['mcp', 'server/mcp-cli.ts'],
  ['workspace', 'server/workspace-cli.ts'],
])
  await build({
    entryPoints: [entry],
    outfile: resolve(out, `${name}.cjs`),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });
const signed = !!(process.env.CSC_LINK || process.env.CSC_NAME);
const updateUrl = process.env.TRACEWORK_UPDATE_URL || null;
if (process.env.TRACEWORK_RELEASE === '1' && !updateUrl)
  throw new Error('Public releases require TRACEWORK_UPDATE_URL.');
if (updateUrl && new URL(updateUrl).protocol !== 'https:')
  throw new Error('Updates require an HTTPS feed.');
await mkdir('build', { recursive: true });
await writeFile('build/release-config.json', JSON.stringify({ signed, updateUrl }, null, 2));
