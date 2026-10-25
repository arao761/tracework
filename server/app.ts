import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Store } from './store';
import { parseImport, redact } from './import';
import { findings } from '../shared/analysis';
import type { Connections } from './connections';
export function createApp(
  store: Store,
  connections?: Connections,
  security?: { token: string; mcpToken: string },
) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
      return res.status(403).json({ error: 'Only local connections are allowed.' });
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
      if (security) {
        const supplied = req.headers.authorization?.replace(/^Bearer /, '') || '';
        const matches = (expected: string) => {
          const a = Buffer.from(supplied);
          const b = Buffer.from(expected);
          return a.length === b.length && timingSafeEqual(a, b);
        };
        if (!matches(security.token)) {
          if (!matches(security.mcpToken))
            return res.status(401).json({ error: 'Desktop authorization required.' });
          if (req.method !== 'GET' || !['/api/workspace', '/api/health'].includes(req.path))
            return res.status(403).json({ error: 'The MCP connection is read only.' });
        }
      }

      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
        try {
          const u = new URL(req.headers.origin);
          if (
            !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
            u.host !== req.headers.host
          )
            return res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
        } catch {
          return res.status(403).json({ error: 'Invalid origin.' });
        }
      }
    }
    next();
  });
  app.use(express.json({ limit: '21mb' }));
  const demo = (req: express.Request) => req.query.mode !== 'live';
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/workspace', (req, res) => res.json(store.workspace(demo(req))));
  if (connections) {
    app.get('/api/connections', (_req, res) => res.json(connections.state()));
    app.post('/api/connections/sync', async (_req, res) => {
      await connections.sync();
      res.json(connections.state());
    });
    app.post('/api/connections/:id', async (req, res) => {
      if (!['codex', 'claude'].includes(req.params.id))
        return res.status(400).json({ error: 'Unknown connection.' });
      const b = req.body || {};
      if (
        typeof b.enabled !== 'boolean' ||
        ['directory', 'engineer', 'history'].some(
          (k) => b[k] !== undefined && typeof b[k] !== 'string',
        )
      )
        return res.status(400).json({ error: 'Invalid connection settings.' });
      try {
        res.json(
          b.enabled
            ? await connections.connect(req.params.id as 'codex' | 'claude', b)
            : await connections.disconnect(req.params.id as 'codex' | 'claude'),
        );
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });
  }
  app.post('/api/import', (req, res) => {
    const files = req.body?.files;
    const engineer =
      typeof req.body?.engineer === 'string' ? req.body.engineer.slice(0, 100) : 'Unassigned';
    if (!Array.isArray(files) || files.length === 0 || files.length > 30)
      return res.status(400).json({ error: 'Select between 1 and 30 files.' });
    let imported = 0,
      duplicates = 0;
    const errors: string[] = [];
    for (const f of files) {
      if (typeof f?.name !== 'string' || typeof f?.content !== 'string') {
        errors.push('Invalid file entry.');
        continue;
      }
      try {
        for (const s of parseImport(f.content, f.name, engineer)) {
          if (store.insert(s)) imported++;
          else duplicates++;
        }
      } catch (e) {
        errors.push(`${f.name}: ${e instanceof Error ? e.message : 'Import failed'}`);
      }
    }
    res.json({ imported, duplicates, errors });
  });
  app.patch('/api/sessions/:id', (req, res) => {
    const s = store.get(req.params.id, demo(req));
    if (!s) return res.status(404).json({ error: 'Session not found.' });
    const b = req.body || {};
    if (
      b.outcome !== undefined &&
      !['unreviewed', 'shipped', 'needs-work', 'abandoned'].includes(b.outcome)
    )
      return res.status(400).json({ error: 'Invalid outcome.' });
    for (const k of ['notes', 'engineer', 'prUrl'])
      if (b[k] !== undefined && typeof b[k] !== 'string')
        return res.status(400).json({ error: `Invalid ${k}.` });
    if (b.prUrl && !/^https?:\/\//i.test(b.prUrl))
      return res.status(400).json({ error: 'PR links must use http or https.' });
    s.outcome = b.outcome || s.outcome;
    s.notes = b.notes === undefined ? s.notes : redact(b.notes.slice(0, 10000));
    s.engineer =
      b.engineer === undefined
        ? s.engineer
        : redact(b.engineer.trim().slice(0, 100) || 'Unassigned');
    s.prUrl = b.prUrl === undefined ? s.prUrl : b.prUrl.slice(0, 2000);
    store.update(s);
    res.json(s);
  });
  app.delete('/api/sessions/:id', (req, res) => {
    if (!store.get(req.params.id, demo(req)))
      return res.status(404).json({ error: 'Session not found.' });
    store.delete(req.params.id, demo(req));
    res.json({ ok: true });
  });
  app.post('/api/decisions', (req, res) => {
    const { id, status } = req.body || {};
    if (
      typeof id !== 'string' ||
      !['accepted', 'dismissed'].includes(status) ||
      !store
        .workspace(demo(req))
        .sessions.flatMap(findings)
        .some((f) => f.id === id)
    )
      return res.status(400).json({ error: 'Invalid recommendation decision.' });
    store.decide(id, demo(req), status);
    res.json({ ok: true });
  });
  app.post('/api/work', (req, res) => {
    const b = req.body || {};
    if (
      typeof b.minutes !== 'number' ||
      !Number.isInteger(b.minutes) ||
      b.minutes < 1 ||
      b.minutes > 1440 ||
      typeof b.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
      !Number.isFinite(Date.parse(b.date)) ||
      new Date(b.date).toISOString().slice(0, 10) !== b.date ||
      !['Code review', 'Planning', 'Debugging', 'Implementation', 'Meetings', 'Other'].includes(
        b.category,
      ) ||
      typeof b.engineer !== 'string' ||
      !b.engineer.trim() ||
      typeof b.project !== 'string' ||
      !b.project.trim() ||
      typeof b.note !== 'string'
    )
      return res.status(400).json({
        error: 'Enter an engineer, project, valid date, category and 1–1440 whole minutes.',
      });
    const w = {
      id: randomUUID(),
      engineer: redact(b.engineer.slice(0, 100)),
      project: redact(b.project.slice(0, 100)),
      category: b.category,
      minutes: b.minutes,
      date: b.date,
      note: redact(b.note.slice(0, 2000)),
    };
    store.addWork(w, demo(req));
    res.status(201).json(w);
  });
  app.delete('/api/work/:id', (req, res) => {
    store.deleteWork(req.params.id, demo(req));
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status === 413 ? 413 : 400).json({
      error:
        err.status === 413
          ? 'Import is too large. Select fewer files (20 MB total).'
          : 'The request could not be processed.',
    });
  });
  return app;
}
