import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { createMcpServer } from '../server/mcp';
import { parseImport } from '../server/import';
test('MCP handshake lists tools and returns real imported analysis, not demo data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracework-mcp-'));
  const store = new Store(join(dir, 'data.sqlite'));
  const [session] = parseImport(
    readFileSync(new URL('../samples/canonical.json', import.meta.url), 'utf8'),
  );
  store.insert(session);
  const web = createApp(store).listen(0, '127.0.0.1');
  await once(web, 'listening');
  const port = (web.address() as { port: number }).port;
  const server = createMcpServer(`http://127.0.0.1:${port}`);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 3);
    assert.ok(tools.tools.every((t) => t.annotations?.readOnlyHint));
    const summary = await client.callTool({ name: 'tracework_summary', arguments: {} });
    const value = JSON.parse((summary.content as { text: string }[])[0].text);
    assert.equal(value.metrics.sessions, 1);
    assert.equal(value.openFindings, 3);
    const details = await client.callTool({
      name: 'tracework_session',
      arguments: { id: session.id, eventId: 'e2' },
    });
    const detail = JSON.parse((details.content as { text: string }[])[0].text);
    assert.equal(detail.events.length, 1);
    assert.equal(detail.events[0].id, 'e2');
    const missing = await client.callTool({
      name: 'tracework_session',
      arguments: { id: 'demo-1' },
    });
    assert.equal(missing.isError, true);
    assert.throws(() => createMcpServer('https://example.com'), /local http/);
  } finally {
    await client.close();
    await server.close();
    await new Promise<void>((r) => web.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('the actual stdio entrypoint starts and answers a client tool call', async () => {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { resolve } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'tracework-stdio-'));
  const store = new Store(join(dir, 'data.sqlite'));
  const web = createApp(store).listen(0, '127.0.0.1');
  await once(web, 'listening');
  const port = (web.address() as { port: number }).port;
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('server/mcp-cli.ts')],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ),
      TRACEWORK_URL: `http://127.0.0.1:${port}`,
    },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const r = await client.callTool({ name: 'tracework_sessions', arguments: { limit: 5 } });
    assert.deepEqual(JSON.parse((r.content as { text: string }[])[0].text), []);
  } finally {
    await client.close();
    await transport.close();
    await new Promise<void>((r) => web.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
