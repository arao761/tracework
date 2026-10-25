import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Session, WorkEntry, Decision, Workspace } from '../shared/model';
import { demoSessions, demoWork } from './demo';
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    if (version > 1) {
      this.db.close();
      throw new Error('This database requires a newer version of Tracework.');
    }
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    this.db.exec('PRAGMA busy_timeout=5000;');
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, demo INTEGER NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS decisions (id TEXT NOT NULL, demo INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY(id,demo)); CREATE TABLE IF NOT EXISTS work (id TEXT PRIMARY KEY, demo INTEGER NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`,
    );
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sync_files (connection TEXT NOT NULL, path TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY(connection,path)); CREATE TABLE IF NOT EXISTS sync_deleted (id TEXT PRIMARY KEY);`,
    );
    this.db.exec('PRAGMA user_version=1;');
    if (!this.db.prepare('SELECT value FROM meta WHERE key=?').get('seeded')) {
      for (const s of demoSessions()) this.insert(s);
      for (const w of demoWork()) this.addWork(w, true);
      this.db.prepare('INSERT INTO meta VALUES (?,?)').run('seeded', '1');
    }
  }
  insert(s: Session) {
    this.db.prepare('DELETE FROM sync_deleted WHERE id=?').run(s.id);
    return (
      Number(
        this.db
          .prepare('INSERT OR IGNORE INTO sessions VALUES (?,?,?)')
          .run(s.id, s.demo ? 1 : 0, JSON.stringify(s)).changes,
      ) > 0
    );
  }
  get(id: string, demo: boolean): Session | undefined {
    const r = this.db
      .prepare('SELECT body FROM sessions WHERE id=? AND demo=?')
      .get(id, demo ? 1 : 0) as { body: string } | undefined;
    return r ? JSON.parse(r.body) : undefined;
  }
  update(s: Session) {
    this.db
      .prepare('UPDATE sessions SET body=? WHERE id=? AND demo=?')
      .run(JSON.stringify(s), s.id, s.demo ? 1 : 0);
  }
  delete(id: string, demo: boolean) {
    if (!demo) this.db.prepare('INSERT OR IGNORE INTO sync_deleted VALUES (?)').run(id);
    this.db.prepare('DELETE FROM sessions WHERE id=? AND demo=?').run(id, demo ? 1 : 0);
    this.db
      .prepare('DELETE FROM decisions WHERE id LIKE ? AND demo=?')
      .run(`${id}:%`, demo ? 1 : 0);
  }
  workspace(demo: boolean): Workspace {
    const sessions = (
      this.db.prepare('SELECT body FROM sessions WHERE demo=?').all(demo ? 1 : 0) as {
        body: string;
      }[]
    ).map((r) => JSON.parse(r.body));
    const work = (
      this.db.prepare('SELECT body FROM work WHERE demo=?').all(demo ? 1 : 0) as { body: string }[]
    ).map((r) => JSON.parse(r.body));
    const decisions = Object.fromEntries(
      (
        this.db.prepare('SELECT id,status FROM decisions WHERE demo=?').all(demo ? 1 : 0) as {
          id: string;
          status: Decision;
        }[]
      ).map((r) => [r.id, r.status]),
    );
    return { sessions, work, decisions };
  }
  decide(id: string, demo: boolean, status: Decision) {
    this.db
      .prepare('INSERT OR REPLACE INTO decisions VALUES (?,?,?)')
      .run(id, demo ? 1 : 0, status);
  }
  addWork(w: WorkEntry, demo: boolean) {
    this.db.prepare('INSERT INTO work VALUES (?,?,?)').run(w.id, demo ? 1 : 0, JSON.stringify(w));
  }
  deleteWork(id: string, demo: boolean) {
    this.db.prepare('DELETE FROM work WHERE id=? AND demo=?').run(id, demo ? 1 : 0);
  }
  getMeta<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as
      { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  setMeta(key: string, value: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, JSON.stringify(value));
  }
  fileSignature(connection: string, path: string): string | undefined {
    return (
      this.db
        .prepare('SELECT signature FROM sync_files WHERE connection=? AND path=?')
        .get(connection, path) as { signature: string } | undefined
    )?.signature;
  }
  rememberFile(connection: string, path: string, signature: string) {
    this.db
      .prepare('INSERT OR REPLACE INTO sync_files VALUES (?,?,?)')
      .run(connection, path, signature);
  }
  syncSession(s: Session): 'imported' | 'updated' | 'unchanged' | 'deleted' {
    if (this.db.prepare('SELECT id FROM sync_deleted WHERE id=?').get(s.id)) return 'deleted';
    const existing = this.get(s.id, false);
    if (!existing) {
      this.insert(s);
      return 'imported';
    }
    const merged = {
      ...s,
      engineer: existing.engineer,
      outcome: existing.outcome,
      notes: existing.notes,
      prUrl: existing.prUrl,
    };
    if (
      JSON.stringify({ ...existing, syncedAt: undefined }) ===
      JSON.stringify({ ...merged, syncedAt: undefined })
    )
      return 'unchanged';
    // A partially written export should never replace a more complete stored session.
    if (merged.events.length < existing.events.length) return 'unchanged';
    this.update(merged);
    return 'updated';
  }
  close() {
    this.db.close();
  }
}
