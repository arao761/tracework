import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { findings } from '../shared/analysis';
test('API imports, annotates, persists, isolates demo, validates and deletes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracework-test-'));
  let store = new Store(join(dir, 'test.sqlite'));
  const app = createApp(store);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;
  async function req(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  }
  try {
    assert.equal((await req('/api/workspace?mode=live')).data.sessions.length, 0);
    assert.equal((await req('/api/workspace')).data.sessions.length, 18);
    const content = readFileSync(new URL('../samples/canonical.json', import.meta.url), 'utf8');
    const payload = {
      files: [
        { name: 'sample.json', content },
        { name: 'bad.json', content: '{bad' },
      ],
      engineer: 'Test Person',
    };
    let r = await req('/api/import', 'POST', payload);
    assert.equal(r.data.imported, 1);
    assert.equal(r.data.errors.length, 1);
    r = await req('/api/import', 'POST', payload);
    assert.equal(r.data.duplicates, 1);
    const s = (await req('/api/workspace?mode=live')).data.sessions[0];
    r = await req(`/api/sessions/${s.id}?mode=live`, 'PATCH', {
      outcome: 'shipped',
      notes: 'Verified in review',
      prUrl: 'https://example.com/pr/1',
    });
    assert.equal(r.data.outcome, 'shipped');
    assert.equal(
      (await req(`/api/sessions/${s.id}?mode=live`, 'PATCH', { prUrl: 'javascript:alert(1)' }))
        .status,
      400,
    );
    assert.equal(
      (await req(`/api/sessions/${s.id}`, 'PATCH', { outcome: 'abandoned' })).status,
      404,
    );
    const f = findings(s)[0];
    assert.equal(
      (
        await req('/api/decisions?mode=live', 'POST', {
          id: f.id,
          status: 'accepted',
          proposalContent: 'Reviewed repository instruction',
        })
      ).status,
      200,
    );
    let tracked = (await req('/api/workspace?mode=live')).data.improvements[f.id];
    assert.equal(tracked.proposal.content, 'Reviewed repository instruction');
    assert.ok(tracked.acceptedAt);
    assert.equal(tracked.appliedAt, null);
    assert.equal(
      (await req('/api/improvements/applied?mode=live', 'POST', { id: f.id })).status,
      400,
    );
    assert.equal(
      (await req('/api/improvements/applied', 'POST', { id: f.id, confirmed: true })).status,
      400,
    );
    assert.equal(
      (await req('/api/improvements/applied?mode=live', 'POST', { id: f.id, confirmed: true }))
        .status,
      200,
    );
    tracked = (await req('/api/workspace?mode=live')).data.improvements[f.id];
    assert.ok(tracked.appliedAt);
    const appliedAt = tracked.appliedAt;
    await req('/api/improvements/applied?mode=live', 'POST', { id: f.id, confirmed: true });
    assert.equal(
      (await req('/api/workspace?mode=live')).data.improvements[f.id].appliedAt,
      appliedAt,
    );
    await req('/api/decisions?mode=live', 'POST', { id: f.id, status: 'dismissed' });
    assert.equal(
      (await req('/api/improvements/applied?mode=live', 'POST', { id: f.id, confirmed: true }))
        .status,
      400,
    );
    await req('/api/decisions?mode=live', 'POST', { id: f.id, status: 'accepted' });
    assert.equal(
      (await req('/api/workspace?mode=live')).data.improvements[f.id].acceptedAt,
      tracked.acceptedAt,
    );
    const w = {
      engineer: 'Test Person',
      project: 'claims-service',
      category: 'Code review',
      minutes: 25,
      date: '2026-10-24',
      note: 'Reviewed edge cases',
    };
    r = await req('/api/work?mode=live', 'POST', w);
    assert.equal(r.status, 201);
    const wid = r.data.id;
    assert.equal((await req('/api/work?mode=live', 'POST', { ...w, minutes: -1 })).status, 400);
    assert.equal(
      (await req('/api/work?mode=live', 'POST', { ...w, date: '2026-02-31' })).status,
      400,
    );
    assert.equal(
      (await req('/api/import', 'POST', payload, { Origin: 'https://evil.example' })).status,
      403,
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    store = new Store(join(dir, 'test.sqlite'));
    const persisted = store.workspace(false);
    assert.equal(persisted.sessions[0].notes, 'Verified in review');
    assert.equal(persisted.decisions[f.id], 'accepted');
    assert.equal(persisted.improvements![f.id].appliedAt, appliedAt);
    assert.equal(persisted.improvements![f.id].proposal.content, 'Reviewed repository instruction');
    assert.equal(persisted.work.length, 1);
    store.deleteWork(wid, false);
    store.delete(s.id, false);
    assert.equal(store.workspace(false).sessions.length, 0);
    assert.equal(store.workspace(false).work.length, 0);
    assert.equal(Object.keys(store.workspace(false).decisions).length, 0);
    assert.equal(Object.keys(store.workspace(false).improvements!).length, 0);
    assert.equal(store.workspace(true).sessions.length, 18);
  } finally {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
