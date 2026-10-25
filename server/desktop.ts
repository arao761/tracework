import express from 'express';
import { mkdir, writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Store } from './store';
import { Connections } from './connections';
import { createApp } from './app';
async function main() {
  const dataDir = process.env.TRACEWORK_DESKTOP_DATA;
  const assets = process.env.TRACEWORK_DESKTOP_ASSETS;
  const token = process.env.TRACEWORK_AUTH_TOKEN;
  const mcpToken = process.env.TRACEWORK_MCP_TOKEN;
  const discovery = process.env.TRACEWORK_DISCOVERY_PATH;
  const mcpCommand = JSON.parse(process.env.TRACEWORK_MCP_COMMAND || '[]');
  if (
    !dataDir ||
    !isAbsolute(dataDir) ||
    !assets ||
    !isAbsolute(assets) ||
    !token ||
    token.length < 32 ||
    !mcpToken ||
    mcpToken.length < 32 ||
    !discovery ||
    !isAbsolute(discovery) ||
    !Array.isArray(mcpCommand) ||
    !mcpCommand.length ||
    mcpCommand.some((v: unknown) => typeof v !== 'string')
  )
    throw new Error('Invalid desktop backend configuration.');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = new Store(join(dataDir, 'tracework.sqlite'));
  const connections = new Connections(store, undefined, { mcpCommand });
  const app = createApp(store, connections, { token, mcpToken });
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.use(express.static(assets));
  app.get('/{*path}', (_req, res) => res.sendFile(join(assets, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const temp = discovery + '.tmp';
  await writeFile(temp, JSON.stringify({ version: 1, url, token: mcpToken, pid: process.pid }), {
    mode: 0o600,
  });
  await rename(temp, discovery);
  connections.start();
  process.send?.({ type: 'ready', url });
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await connections.stop();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    try {
      const state = JSON.parse(await readFile(discovery!, 'utf8'));
      if (state.pid === process.pid) await unlink(discovery!);
    } catch {}
    process.exit(0);
  }
  process.on('SIGTERM', () => void close());
  process.on('SIGINT', () => void close());
  process.on('disconnect', () => void close());
}
main().catch((error) => {
  console.error(error.message);
  process.send?.({ type: 'error', message: error.message });
  process.exit(1);
});
