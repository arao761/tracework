import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  appendFile,
  rm,
  symlink,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { Connections } from '../server/connections';
import { parseImport } from '../server/import';
const sample = () => readFile(new URL('../samples/codex.jsonl', import.meta.url), 'utf8');
const extra = (text: string) =>
  JSON.stringify({
    timestamp: '2026-10-24T14:04:00Z',
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  }) + '\n';
test('sync is opt-in, imports native files, refreshes appended data and preserves reviews', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracework-sync-'));
  const root = join(dir, 'sessions');
  await mkdir(root);
  const path = join(root, 'session.jsonl');
  await writeFile(path, await sample());
  const store = new Store(join(dir, 'data.sqlite'));
  let sync = new Connections(store, { codex: root, claude: join(dir, 'absent') });
  try {
    await sync.sync();
    assert.equal(store.workspace(false).sessions.length, 0);
    assert.ok(sync.state().connections.every((c) => !c.enabled));
    await sync.connect('codex', { history: 'all', engineer: 'Engineer' });
    let s = store.workspace(false).sessions[0];
    assert.equal(s.syncSource, 'codex');
    assert.equal(s.engineer, 'Engineer');
    assert.equal(sync.state().connections[0].imported, 1);
    s.notes = 'Keep this review';
    s.outcome = 'shipped';
    s.engineer = 'Renamed Engineer';
    store.update(s);
    await appendFile(path, extra('New response'));
    await sync.sync();
    s = store.get(s.id, false)!;
    assert.equal(s.events.length, 3);
    assert.equal(s.notes, 'Keep this review');
    assert.equal(s.outcome, 'shipped');
    assert.equal(s.engineer, 'Renamed Engineer');
    assert.equal(sync.state().connections[0].updated, 1);
    await sync.stop();
    sync = new Connections(store, { codex: root });
    assert.equal(sync.state().connections[0].enabled, true);
    await sync.sync();
    assert.equal(sync.state().connections[0].updated, 1);
    await sync.disconnect('codex');
    await appendFile(path, extra('After disconnect'));
    await sync.sync();
    assert.equal(store.get(s.id, false)!.events.length, 3);
  } finally {
    await sync.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('partial final JSONL records are tolerated; deleted sessions do not return', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracework-partial-'));
  const root = join(dir, 'sessions');
  await mkdir(root);
  const path = join(root, 'session.jsonl');
  const content = await sample();
  await writeFile(path, content + '{"type":');
  const store = new Store(join(dir, 'data.sqlite'));
  const sync = new Connections(store, { codex: root });
  try {
    await sync.connect('codex', { history: 'all' });
    const s = store.workspace(false).sessions[0];
    assert.ok(s);
    assert.equal(sync.state().connections[0].errors.length, 0);
    await writeFile(path, content + extra('Complete record'));
    await sync.sync();
    assert.equal(store.get(s.id, false)!.events.length, 3);
    store.delete(s.id, false);
    await appendFile(path, extra('Must stay deleted'));
    await sync.sync();
    assert.equal(store.workspace(false).sessions.length, 0);
  } finally {
    await sync.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('history filters, skipped symlinks and missing folders are explicit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracework-scope-'));
  const root = join(dir, 'sessions');
  await mkdir(root);
  const old = join(root, 'old.jsonl');
  await writeFile(old, await sample());
  await utimes(old, new Date(0), new Date(0));
  await symlink(old, join(root, 'linked.jsonl'));
  const store = new Store(join(dir, 'data.sqlite'));
  const sync = new Connections(store, { codex: root });
  try {
    await sync.connect('codex', { history: '7' });
    assert.equal(store.workspace(false).sessions.length, 0);
    await assert.rejects(sync.connect('claude', { directory: join(dir, 'missing') }), /not found/);
    await assert.rejects(sync.connect('codex', { directory: 'relative' }), /absolute/);
    await sync.connect('codex', { history: 'all' });
    assert.equal(store.workspace(false).sessions.length, 1);
    assert.equal(sync.state().connections[0].imported, 1);
  } finally {
    await sync.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('Claude files synchronize while nested subagent logs are excluded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracework-claude-'));
  const root = join(dir, 'projects');
  await mkdir(join(root, 'project', 'subagents'), { recursive: true });
  const content = await readFile(new URL('../samples/claude-code.jsonl', import.meta.url), 'utf8');
  await writeFile(join(root, 'project', 'main.jsonl'), content);
  await writeFile(
    join(root, 'project', 'subagents', 'agent.jsonl'),
    content.replaceAll('example-claude-001', 'subagent-001'),
  );
  const store = new Store(join(dir, 'data.sqlite'));
  const sync = new Connections(store, { claude: root });
  try {
    await sync.connect('claude', { history: 'all' });
    assert.equal(store.workspace(false).sessions.length, 1);
    assert.equal(store.workspace(false).sessions[0].provider, 'Claude Code');
    assert.equal(store.workspace(false).sessions[0].sourceId, 'example-claude-001');
  } finally {
    await sync.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('malformed files do not block later batches and warnings persist until corrected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracework-batch-'));
  const root = join(dir, 'sessions');
  await mkdir(root);
  for (let i = 0; i < 21; i++) await writeFile(join(root, `bad-${i}.jsonl`), 'not json\n');
  const valid = join(root, 'valid.jsonl');
  await writeFile(valid, await sample());
  await utimes(valid, new Date(1), new Date(1));
  const store = new Store(join(dir, 'data.sqlite'));
  const sync = new Connections(store, { codex: root });
  try {
    await sync.connect('codex', { history: 'all' });
    assert.equal(store.workspace(false).sessions.length, 0);
    assert.ok(sync.state().connections[0].pending > 0);
    await sync.sync();
    assert.equal(store.workspace(false).sessions.length, 1);
    assert.ok(sync.state().connections[0].errors.length > 0);
    await sync.sync();
    assert.ok(sync.state().connections[0].errors.length > 0);
  } finally {
    await sync.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
