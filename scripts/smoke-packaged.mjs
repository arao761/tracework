import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const bundle = resolve(process.argv[2] || 'release-desktop/mac-arm64/Tracework.app');
const directory = await mkdtemp(join(tmpdir(), 'tracework-installed-'));
const executable = join(bundle, 'Contents/MacOS/Tracework');
const child = spawn(executable, ['--hidden'], {
  cwd: tmpdir(),
  env: { ...process.env, PATH: '/usr/bin:/bin', TRACEWORK_TEST_DATA: directory },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let errors = '';
child.stderr.on('data', (b) => (errors += b));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function discover(previousPid) {
  for (let i = 0; i < 100; i++) {
    try {
      const state = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
      if (state.pid !== previousPid) return state;
    } catch {}
    if (child.exitCode !== null) throw new Error(errors || 'Installed app exited before startup');
    await pause(100);
  }
  throw new Error(errors || 'Installed app did not become ready');
}
let client;
try {
  const first = await discover();
  assert.equal((await fetch(first.url + '/api/workspace')).status, 401);
  const authorized = { headers: { Authorization: `Bearer ${first.token}` } };
  const live = await (await fetch(first.url + '/api/workspace?mode=live', authorized)).json();
  assert.equal(live.sessions.length, 0);
  assert.equal((await fetch(first.url + '/api/connections', authorized)).status, 403);
  const launcher = join(directory, 'bin/tracework-mcp');
  const launcherText = await readFile(launcher, 'utf8');
  assert.ok(!launcherText.includes('node_modules'));
  assert.ok(!launcherText.includes('tsx'));
  assert.ok(launcherText.includes(bundle));
  client = new Client({ name: 'installed-app-smoke', version: '1.0' });
  const transport = new StdioClientTransport({
    command: launcher,
    args: [],
    cwd: tmpdir(),
    env: { PATH: '/usr/bin:/bin' },
    stderr: 'pipe',
  });
  await client.connect(transport);
  let summary = await client.callTool({ name: 'tracework_summary', arguments: {} });
  assert.equal(JSON.parse(summary.content[0].text).metrics.sessions, 0);
  process.kill(first.pid, 'SIGTERM');
  const second = await discover(first.pid);
  summary = await client.callTool({ name: 'tracework_summary', arguments: {} });
  assert.equal(JSON.parse(summary.content[0].text).metrics.sessions, 0);
  assert.notEqual(second.pid, first.pid);
  console.log(
    JSON.stringify(
      {
        installedBundle: bundle,
        systemNodeRequired: false,
        authentication: true,
        readOnlyMcp: true,
        stableLauncher: true,
        backendRecovery: true,
        passed: true,
      },
      null,
      2,
    ),
  );
} finally {
  await client?.close();
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, pause(5000).then(() => child.kill('SIGKILL'))]);
  // A parent termination closes the backend IPC channel; allow its graceful cleanup.
  await pause(250);
  await rm(directory, { recursive: true, force: true });
}
