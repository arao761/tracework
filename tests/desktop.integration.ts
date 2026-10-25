import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
test('bundled backend and MCP run outside the repository, authenticate, and survive restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracework-bundle-'));
  const binary = resolve(
    `build/runtime/${process.platform}-${process.arch}/${process.platform === 'win32' ? 'node.exe' : 'node'}`,
  );
  const script = resolve('dist-server/desktop.cjs');
  const mcp = resolve('dist-server/mcp.cjs');
  const discovery = join(dir, 'runtime.json');
  let child: ChildProcess | undefined;
  let client: Client | undefined;
  let errors = '';
  let renderer = '';
  async function start() {
    renderer = randomBytes(32).toString('hex');
    child = spawn(binary, [script], {
      cwd: dir,
      env: {
        ...process.env,
        TRACEWORK_DESKTOP_DATA: dir,
        TRACEWORK_DESKTOP_ASSETS: resolve('dist'),
        TRACEWORK_AUTH_TOKEN: renderer,
        TRACEWORK_MCP_TOKEN: randomBytes(32).toString('hex'),
        TRACEWORK_DISCOVERY_PATH: discovery,
        TRACEWORK_MCP_COMMAND: JSON.stringify([binary, mcp, '--discovery', discovery]),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.stderr!.on('data', (b) => (errors += b));
    return await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => {
        child?.kill();
        reject(new Error(errors || 'Bundled service timed out'));
      }, 15000);
      child!.once('error', reject);
      child!.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Bundled service exited ${code}: ${errors}`));
      });
      child!.on('message', (msg: any) => {
        if (msg.type === 'ready') {
          clearTimeout(timer);
          done(msg.url);
        } else if (msg.type === 'error') {
          clearTimeout(timer);
          reject(new Error(msg.message));
        }
      });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    child = undefined;
  }
  try {
    const origin = await start();
    const config = JSON.parse(await readFile(discovery, 'utf8'));
    assert.equal((await fetch(origin + '/api/workspace')).status, 401);
    assert.notEqual(config.token, renderer);
    assert.equal((await stat(discovery)).mode & 0o777, 0o600);
    const headers = { Authorization: `Bearer ${renderer}`, 'Content-Type': 'application/json' };
    const content = await readFile(new URL('../samples/codex.jsonl', import.meta.url), 'utf8');
    const imported = await fetch(origin + '/api/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        engineer: 'Bundled Engineer',
        files: [{ name: 'codex.jsonl', content }],
      }),
    });
    assert.equal((await imported.json()).imported, 1);
    const sessions = await (await fetch(origin + '/api/workspace?mode=live', { headers })).json();
    const id = sessions.sessions[0].id;
    await fetch(origin + `/api/sessions/${id}?mode=live`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notes: 'Survive app upgrade', outcome: 'shipped' }),
    });
    client = new Client({ name: 'packaged-mcp-client', version: '1.0' });
    const transport = new StdioClientTransport({
      command: binary,
      args: [mcp, '--discovery', discovery],
      cwd: dir,
      stderr: 'pipe',
    });
    await client.connect(transport);
    const before = await client.callTool({ name: 'tracework_summary', arguments: {} });
    assert.equal(JSON.parse((before.content as { text: string }[])[0].text).metrics.sessions, 1);
    await stop();
    const restarted = await start();
    const current = JSON.parse(await readFile(discovery, 'utf8'));
    assert.notEqual(current.token, config.token);
    assert.equal(
      (
        await fetch(restarted + '/api/workspace', {
          headers: { Authorization: `Bearer ${config.token}` },
        })
      ).status,
      401,
    );
    const after = await client.callTool({ name: 'tracework_session', arguments: { id } });
    const value = JSON.parse((after.content as { text: string }[])[0].text);
    assert.equal(value.notes, 'Survive app upgrade');
    assert.equal(value.outcome, 'shipped');
    assert.match(await (await fetch(restarted)).text(), /Tracework/);
  } finally {
    await client?.close();
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace migration snapshots a live database without modifying its source', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { Store } = await import('../server/store');
  const dir = await mkdtemp(join(tmpdir(), 'tracework-migrate-'));
  const source = join(dir, 'source.sqlite'),
    target = join(dir, 'snapshot.sqlite');
  const binary = resolve(
    `build/runtime/${process.platform}-${process.arch}/${process.platform === 'win32' ? 'node.exe' : 'node'}`,
  );
  const store = new Store(source);
  store.setMeta('test-preserved', { note: 'snapshot' });
  try {
    await run(binary, [resolve('dist-server/workspace.cjs'), source, target], { cwd: dir });
    const copied = new Store(target);
    assert.deepEqual(copied.getMeta('test-preserved'), { note: 'snapshot' });
    assert.equal(copied.workspace(true).sessions.length, 18);
    copied.close();
    assert.deepEqual(store.getMeta('test-preserved'), { note: 'snapshot' });
    await assert.rejects(
      run(binary, [resolve('dist-server/workspace.cjs'), source, source]),
      /different existing workspace/,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
