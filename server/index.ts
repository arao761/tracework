import { resolve } from 'node:path';
import express from 'express';
import { Store } from './store';
import { createApp } from './app';
import { Connections } from './connections';
const store = new Store(resolve(process.env.TRACEWORK_DATA_DIR || 'data', 'tracework.sqlite'));
const connections = new Connections(store);
connections.start();
const app = createApp(store, connections);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4317);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(
    `\n  Tracework is ready → http://127.0.0.1:${port}\n  Local data → ${resolve(process.env.TRACEWORK_DATA_DIR || 'data')}\n`,
  ),
);
server.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(async () => {
      await connections.stop();
      store.close();
      process.exit(0);
    }),
  );
