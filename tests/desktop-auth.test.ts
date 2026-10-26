import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Store } from '../server/store';
import { createApp } from '../server/app';
test('desktop APIs require credentials and MCP can only read its permitted endpoints', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracework-auth-'));
  const store = new Store(join(dir, 'db.sqlite'));
  const app = createApp(store, undefined, { token: 'renderer-secret', mcpToken: 'reader-secret' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(base + '/api/workspace')).status, 401);
    assert.equal(
      (await fetch(base + '/api/workspace', { headers: { Authorization: 'Bearer wrong' } })).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + '/api/workspace', {
          headers: { Authorization: 'Bearer renderer-secret' },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + '/api/workspace?mode=live', {
          headers: { Authorization: 'Bearer reader-secret' },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + '/api/connections', {
          headers: { Authorization: 'Bearer reader-secret' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + '/api/import', {
          method: 'POST',
          headers: { Authorization: 'Bearer reader-secret', 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [] }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + '/api/import', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer renderer-secret',
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
      403,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('database schema version is explicit and future schemas are protected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracework-schema-'));
  const file = join(dir, 'db.sqlite');
  try {
    const store = new Store(file);
    assert.equal(
      (store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      2,
    );
    store.db.exec('PRAGMA user_version=99');
    store.close();
    assert.throws(() => new Store(file), /newer version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('version 1 workspaces migrate without losing sessions or accepted decisions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracework-migrate-'));
  const file = join(dir, 'db.sqlite');
  try {
    let store = new Store(file);
    const source = store.workspace(true).sessions[0];
    store.decide(`${source.id}:environment`, true, 'accepted');
    store.db.exec('DROP TABLE improvements; PRAGMA user_version=1;');
    store.close();
    store = new Store(file);
    assert.equal(store.workspace(true).sessions.length, 18);
    assert.equal(store.workspace(true).decisions[`${source.id}:environment`], 'accepted');
    assert.deepEqual(store.workspace(true).improvements, {});
    assert.equal(
      (store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      2,
    );
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
