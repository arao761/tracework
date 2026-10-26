import { constants } from 'node:fs';
import { lstat, readdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, isAbsolute, basename, relative } from 'node:path';
import type {
  Connection,
  ConnectionId,
  ConnectionsState,
  SyncDiagnostics,
  SyncFileStatus,
} from '../shared/model';
import type { Store } from './store';
import { parseImport, redact } from './import';

const LIMIT = 20 * 1024 * 1024;
const shellQuote = (v: string) => `'${v.replaceAll("'", "'\\''")}'`;
export class Connections {
  private configs: Connection[];
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;
  constructor(
    private store: Store,
    defaults?: Partial<Record<ConnectionId, string>>,
    private desktop?: { mcpCommand: string[] },
  ) {
    const paths = {
      codex:
        defaults?.codex || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'),
      claude:
        defaults?.claude ||
        join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'),
    };
    this.configs = (['codex', 'claude'] as const).map(
      (id) =>
        store.getMeta<Connection>(`connection:${id}`) || {
          id,
          name: id === 'codex' ? 'Codex' : 'Claude Code',
          directory: paths[id],
          enabled: false,
          engineer: 'Unassigned',
          since: new Date().toISOString(),
          lastSync: null,
          lastError: null,
          imported: 0,
          updated: 0,
          pending: 0,
          errors: [],
        },
    );
  }
  state(): ConnectionsState {
    const quote =
      process.platform === 'win32' ? (v: string) => `"${v.replaceAll('"', '')}"` : shellQuote;
    const command = this.desktop?.mcpCommand || [
      process.execPath,
      resolve('node_modules/tsx/dist/cli.mjs'),
      resolve('server/mcp-cli.ts'),
    ];
    const launch = command.map(quote).join(' ');
    const port = process.env.PORT || '4317';
    const environment =
      this.desktop || port === '4317'
        ? ''
        : ` --env TRACEWORK_URL=http://127.0.0.1:${Number(port)}`;
    return {
      connections: this.configs.map((c) => ({ ...c, errors: [...c.errors] })),
      pollSeconds: 5,
      mcp: {
        codex: `codex mcp add tracework${environment} -- ${launch}`,
        claude: `claude mcp add --transport stdio --scope user tracework${environment} -- ${launch}`,
      },
    };
  }
  private persist(c: Connection) {
    this.store.setMeta(`connection:${c.id}`, c);
  }
  async connect(
    id: ConnectionId,
    input: { directory?: string; engineer?: string; history?: string },
  ) {
    const c = this.configs.find((c) => c.id === id);
    if (!c) throw new Error('Unknown connection.');
    const directory = input.directory?.trim() || c.directory;
    if (!isAbsolute(directory) || directory.length > 4096)
      throw new Error('Choose an absolute session-directory path.');
    const root = await lstat(directory).catch(() => null);
    if (!root?.isDirectory() || root.isSymbolicLink())
      throw new Error('Session directory not found. Choose a real folder, not a symbolic link.');
    if (!['new', '7', '30', 'all'].includes(input.history || '7'))
      throw new Error('Choose a valid history window.');
    await this.running;
    const history = input.history || '7';
    Object.assign(c, {
      directory: resolve(directory),
      enabled: true,
      engineer: redact(input.engineer?.trim().slice(0, 100) || 'Unassigned'),
      since:
        history === 'all'
          ? new Date(0).toISOString()
          : new Date(
              Date.now() - (history === 'new' ? 0 : Number(history) * 86400000),
            ).toISOString(),
      lastError: null,
      errors: [],
      diagnostics: undefined,
      pending: 0,
    });
    this.persist(c);
    await this.sync();
    return this.state();
  }
  async disconnect(id: ConnectionId) {
    await this.running;
    const c = this.configs.find((c) => c.id === id);
    if (!c) throw new Error('Unknown connection.');
    c.enabled = false;
    c.pending = 0;
    this.persist(c);
    return this.state();
  }
  start() {
    this.timer = setInterval(() => void this.sync(), 5000);
    this.timer.unref();
    void this.sync();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  sync(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped) return Promise.resolve();
    this.running = this.scanEnabled().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async scanEnabled() {
    for (const c of this.configs) if (c.enabled) await this.scan(c);
  }
  private async scan(c: Connection) {
    const issues = this.store.getMeta<Record<string, string>>(`connection-issues:${c.id}`) || {};
    const outcomes =
      this.store.getMeta<Record<string, SyncFileStatus>>(`connection-outcomes:${c.id}`) || {};
    const d: SyncDiagnostics = {
      attemptedAt: new Date().toISOString(),
      completedAt: null,
      discovered: 0,
      eligible: 0,
      processed: 0,
      unchanged: 0,
      skipped: 0,
      warnings: 0,
      limited: false,
      reasons: {},
      files: [],
    };
    const reason = (label: string) => {
      d.reasons[label] = (d.reasons[label] || 0) + 1;
    };
    const record = (path: string, status: SyncFileStatus['status'], message: string) => {
      const row = { path: relative(c.directory, path), status, reason: message };
      if (d.files.length < 100) d.files.push(row);
      else if (status === 'warning' || status === 'imported' || status === 'updated') {
        let index = d.files.length - 1;
        while (index >= 0 && !['skipped', 'unchanged'].includes(d.files[index].status)) index--;
        if (index >= 0) d.files[index] = row;
      }
      if (status === 'skipped') d.skipped++;
      reason(message);
      return row;
    };
    try {
      const root = await lstat(c.directory);
      if (!root.isDirectory() || root.isSymbolicLink())
        throw new Error('Session directory is unavailable. Reconnect to a real directory.');
      const files: { path: string; size: number; signature: string; mtime: number }[] = [];
      let visits = 0;
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 8 || visits >= 20000) {
          d.limited = true;
          return;
        }
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (++visits > 20000) {
            d.limited = true;
            break;
          }
          const path = join(dir, entry.name);
          if (entry.isSymbolicLink() || entry.name === 'subagents' || entry.name.startsWith('.')) {
            record(
              path,
              'skipped',
              entry.isSymbolicLink()
                ? 'Symbolic link excluded'
                : entry.name === 'subagents'
                  ? 'Nested subagent directory excluded'
                  : 'Hidden entry excluded',
            );
            continue;
          }
          if (entry.isDirectory()) await walk(path, depth + 1);
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            d.discovered++;
            const stat = await lstat(path).catch(() => null);
            if (!stat?.isFile() || stat.isSymbolicLink()) {
              record(path, 'skipped', 'File disappeared or changed type during scan');
            } else if (stat.mtimeMs < Date.parse(c.since)) {
              record(path, 'skipped', 'Outside selected history window');
            } else
              files.push({
                path,
                size: stat.size,
                signature: `${stat.ino}:${stat.size}:${stat.mtimeMs}`,
                mtime: stat.mtimeMs,
              });
          } else if (entry.isFile())
            record(path, 'skipped', 'Only .jsonl session files are collected');
        }
      };
      await walk(c.directory, 0);
      d.eligible = files.length;
      const present = new Set(files.map((f) => f.path));
      // A bounded scan cannot prove that unvisited files disappeared.
      if (!d.limited) {
        for (const path of Object.keys(issues)) if (!present.has(path)) delete issues[path];
        for (const path of Object.keys(outcomes)) if (!present.has(path)) delete outcomes[path];
      }
      files.sort((a, b) => b.mtime - a.mtime);
      const changed = files.filter((f) => this.store.fileSignature(c.id, f.path) !== f.signature);
      const changedPaths = new Set(changed.map((f) => f.path));
      let bytes = 0;
      for (const file of changed) {
        if (d.processed >= 20 || bytes >= 64 * 1024 * 1024) break;
        d.processed++;
        const remember = (status: SyncFileStatus['status'], message: string) => {
          outcomes[file.path] = record(file.path, status, message);
          this.store.rememberFile(c.id, file.path, file.signature);
        };
        if (file.size > LIMIT) {
          issues[file.path] =
            `${relative(c.directory, file.path)}: exceeds the 20 MB per-session limit.`;
          remember('warning', 'Exceeds the 20 MB per-session limit');
          continue;
        }
        bytes += file.size;
        try {
          const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
          let content: string;
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > LIMIT)
              throw new Error('Not a supported session file.');
            content = await handle.readFile('utf8');
          } finally {
            await handle.close();
          }
          let incomplete = false;
          if (!content.endsWith('\n')) {
            const boundary = content.lastIndexOf('\n');
            try {
              JSON.parse(content.slice(boundary + 1));
            } catch {
              content = boundary >= 0 ? content.slice(0, boundary + 1) : '';
              incomplete = true;
            }
          }
          delete issues[file.path];
          if (!content.trim()) {
            remember(
              'skipped',
              incomplete ? 'Waiting for a complete JSONL record' : 'Empty session file',
            );
            continue;
          }
          const sessions = parseImport(content, basename(file.path), c.engineer);
          const expected = c.id === 'codex' ? 'Codex' : 'Claude Code';
          if (sessions.some((s) => s.provider !== expected))
            throw new Error(`This file is not a ${expected} session.`);
          const results = sessions.map((s) => {
            s.syncSource = c.id;
            s.syncedAt = new Date().toISOString();
            const result = this.store.syncSession(s);
            if (result === 'imported') c.imported++;
            if (result === 'updated') c.updated++;
            return result;
          });
          const status = results.includes('imported')
            ? 'imported'
            : results.includes('updated')
              ? 'updated'
              : results.every((v) => v === 'deleted')
                ? 'skipped'
                : 'unchanged';
          remember(
            status,
            status === 'skipped'
              ? 'Previously deleted; automatic re-import suppressed'
              : incomplete
                ? 'Complete events collected; waiting for final JSONL record'
                : status === 'unchanged'
                  ? 'No new events; existing review preserved'
                  : 'Session events collected',
          );
        } catch (e) {
          const message = redact(e instanceof Error ? e.message : 'Could not read session.');
          if (message.includes('metadata but no supported')) {
            delete issues[file.path];
            remember('skipped', 'Session metadata only; waiting for supported events');
          } else {
            issues[file.path] = `${relative(c.directory, file.path)}: ${message}`;
            remember('warning', message);
          }
        }
      }
      // Surface cached exclusions/errors on every scan, not only when a file changes.
      for (const file of files) {
        if (changedPaths.has(file.path)) continue;
        d.unchanged++;
        const previous = outcomes[file.path];
        record(
          file.path,
          previous?.status === 'warning' || previous?.status === 'skipped'
            ? previous.status
            : 'unchanged',
          previous?.status === 'warning' || previous?.status === 'skipped'
            ? previous.reason
            : 'File unchanged since previous scan',
        );
      }
      c.pending = Math.max(0, changed.length - d.processed);
      const errors = Object.values(issues);
      if (d.limited)
        errors.unshift('Scan reached its directory limit. Choose a more specific session folder.');
      d.warnings = errors.length;
      d.completedAt = new Date().toISOString();
      c.lastSync = d.completedAt;
      c.lastError = null;
      c.errors = errors.slice(0, 10);
    } catch (e) {
      c.lastError = redact((e as Error).message);
      // Keep existing file warnings when a directory temporarily becomes unavailable.
      c.errors = Object.values(issues).slice(0, 10);
      d.warnings = Object.keys(issues).length;
      c.pending = 0;
    }
    d.files.sort((a, b) => Number(b.status === 'warning') - Number(a.status === 'warning'));
    c.diagnostics = d;
    this.store.setMeta(`connection-issues:${c.id}`, issues);
    this.store.setMeta(`connection-outcomes:${c.id}`, outcomes);
    this.persist(c);
  }
}
