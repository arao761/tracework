import { constants } from 'node:fs';
import { lstat, readdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, isAbsolute, basename } from 'node:path';
import type { Connection, ConnectionId, ConnectionsState } from '../shared/model';
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
    try {
      const root = await lstat(c.directory);
      if (!root.isDirectory() || root.isSymbolicLink())
        throw new Error('Session directory is unavailable. Reconnect to a real directory.');
      const files: { path: string; size: number; signature: string; mtime: number }[] = [];
      let visits = 0,
        limited = false;
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 8 || visits >= 20000) {
          limited = true;
          return;
        }
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (++visits > 20000) {
            limited = true;
            break;
          }
          if (entry.isSymbolicLink() || entry.name === 'subagents' || entry.name.startsWith('.'))
            continue;
          const path = join(dir, entry.name);
          if (entry.isDirectory()) await walk(path, depth + 1);
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            const stat = await lstat(path).catch(() => null);
            if (stat?.isFile() && !stat.isSymbolicLink() && stat.mtimeMs >= Date.parse(c.since))
              files.push({
                path,
                size: stat.size,
                signature: `${stat.ino}:${stat.size}:${stat.mtimeMs}`,
                mtime: stat.mtimeMs,
              });
          }
        }
      };
      await walk(c.directory, 0);
      const present = new Set(files.map((f) => f.path));
      for (const path of Object.keys(issues)) if (!present.has(path)) delete issues[path];
      files.sort((a, b) => b.mtime - a.mtime);
      const changed = files.filter((f) => this.store.fileSignature(c.id, f.path) !== f.signature);
      let processed = 0,
        bytes = 0;
      for (const file of changed) {
        if (processed >= 20 || bytes >= 64 * 1024 * 1024) break;
        processed++;
        if (file.size > LIMIT) {
          issues[file.path] = `${basename(file.path)}: exceeds the 20 MB per-session limit.`;
          this.store.rememberFile(c.id, file.path, file.signature);
          continue;
        }
        bytes += file.size;
        try {
          // O_NOFOLLOW prevents a file symlink from being substituted at the final path.
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
          // Agents append JSONL while running. Ignore only an incomplete final record.
          if (!content.endsWith('\n')) {
            const boundary = content.lastIndexOf('\n');
            const tail = content.slice(boundary + 1);
            try {
              JSON.parse(tail);
            } catch {
              content = boundary >= 0 ? content.slice(0, boundary + 1) : '';
            }
          }
          if (!content.trim()) {
            this.store.rememberFile(c.id, file.path, file.signature);
            continue;
          }
          const sessions = parseImport(content, basename(file.path), c.engineer);
          const expected = c.id === 'codex' ? 'Codex' : 'Claude Code';
          for (const s of sessions) {
            if (s.provider !== expected) throw new Error(`This file is not a ${expected} session.`);
            s.syncSource = c.id;
            s.syncedAt = new Date().toISOString();
            const result = this.store.syncSession(s);
            if (result === 'imported') c.imported++;
            if (result === 'updated') c.updated++;
          }
          this.store.rememberFile(c.id, file.path, file.signature);
          delete issues[file.path];
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not read session.';
          if (!message.includes('metadata but no supported'))
            issues[file.path] = `${basename(file.path)}: ${redact(message)}`;
          this.store.rememberFile(c.id, file.path, file.signature);
        }
      }
      c.pending = Math.max(0, changed.length - processed);
      const errors = Object.values(issues);
      if (limited)
        errors.unshift('Scan reached its directory limit. Choose a more specific session folder.');
      c.lastSync = new Date().toISOString();
      c.lastError = null;
      c.errors = errors.slice(0, 10);
    } catch (e) {
      c.lastError = (e as Error).message;
      c.errors = [];
    }
    this.store.setMeta(`connection-issues:${c.id}`, issues);
    this.persist(c);
  }
}
