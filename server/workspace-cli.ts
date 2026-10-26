import { DatabaseSync, backup } from 'node:sqlite';
import { chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
async function main() {
  const [source, target] = process.argv.slice(2);
  if (!source || !target || resolve(source) === resolve(target))
    throw new Error('Choose a different existing workspace.');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    if (version > 2) throw new Error('This workspace needs a newer Tracework version.');
    db.prepare('SELECT COUNT(*) FROM sessions').get();
    await backup(db, target);
    if (process.platform !== 'win32') await chmod(target, 0o600);
    console.log(JSON.stringify({ ok: true }));
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  } finally {
    db.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
