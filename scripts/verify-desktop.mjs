import { access, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(
  process.argv[2] || process.env.TRACEWORK_APP_PATH || `release/mac-${process.arch}/Tracework.app`,
);
const resources =
  process.platform === 'darwin' ? join(root, 'Contents/Resources') : join(root, 'resources');
const binary = join(resources, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
for (const file of [
  'server/desktop.cjs',
  'server/mcp.cjs',
  'server/workspace.cjs',
  'frontend/index.html',
  'runtime/manifest.json',
  'release-config.json',
])
  await access(join(resources, file));
const manifest = JSON.parse(await readFile(join(resources, 'runtime/manifest.json'), 'utf8'));
const version = execFileSync(binary, ['--version'], { encoding: 'utf8', cwd: '/tmp' }).trim();
if (version !== `v${manifest.version}`) throw new Error('Packaged runtime version mismatch');
if (process.platform === 'darwin') {
  const links = execFileSync('otool', ['-L', binary], { encoding: 'utf8' });
  if (links.includes('/opt/homebrew') || links.includes('/usr/local'))
    throw new Error('Packaged runtime depends on a developer installation');
  execFileSync('codesign', ['--verify', '--deep', '--strict', root], { stdio: 'pipe' });
}
const config = JSON.parse(await readFile(join(resources, 'release-config.json'), 'utf8'));
console.log(
  JSON.stringify(
    {
      application: root,
      runtime: version,
      architecture: manifest.arch,
      signedForDistribution: config.signed,
      updateFeedConfigured: !!config.updateUrl,
      verified: true,
    },
    null,
    2,
  ),
);
