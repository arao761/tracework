import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  Code2,
  Copy,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Unplug,
  X,
} from 'lucide-react';
import DesktopSettings from './DesktopSettings';
import type { Connection, ConnectionId, ConnectionsState } from '../shared/model';
async function request(path = '', body?: unknown): Promise<ConnectionsState> {
  const r = await fetch(`/api/connections${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'Connection failed.');
  return value;
}
export default function ConnectionsPage({ onLive }: { onLive: () => void }) {
  const [state, setState] = useState<ConnectionsState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');
  async function reload() {
    try {
      setState(await request());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, []);
  async function change(id: ConnectionId, body: unknown) {
    setBusy(id);
    setError('');
    try {
      setState(await request(`/${id}`, body));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy('');
    }
  }
  async function copy(id: string, text: string) {
    try {
      if (window.traceworkDesktop) await window.traceworkDesktop.copyText(text);
      else await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(''), 2500);
    } catch {
      setError('Clipboard unavailable. Select and copy the command below.');
    }
  }
  return (
    <div className="connections-page">
      <DesktopSettings />
      <div className="connection-intro">
        <span className="connection-intro-icon">
          <Link2 size={24} />
        </span>
        <div>
          <h2>One connection. No more file imports.</h2>
          <p>
            Read local session files as your agents work. Tracework checks enabled directories every
            5 seconds while the app is running.
          </p>
        </div>
        <span className="connection-local">
          <ShieldCheck size={14} />
          Local only
        </span>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss connection error"
            onClick={() => setError('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!state && !error && (
        <div className="empty-state">
          <Loader2 className="spin" />
          Loading connections…
        </div>
      )}
      <div className="connection-grid">
        {state?.connections.map((c) => (
          <ConnectionCard
            key={c.id}
            connection={c}
            busy={busy === c.id}
            onChange={(b) => change(c.id, b)}
          />
        ))}
      </div>
      {state && (
        <div className="connection-actions">
          <span>
            <Clock3 size={13} />
            Refreshes automatically · Your reviews and notes are preserved
          </span>
          <div>
            <button
              className="button secondary"
              disabled={!!busy || !state.connections.some((c) => c.enabled)}
              onClick={async () => {
                setBusy('sync');
                try {
                  setState(await request('/sync', {}));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              <RefreshCw size={14} className={busy === 'sync' ? 'spin' : ''} />
              Sync now
            </button>
            <button className="text-button" onClick={onLive}>
              View my sessions <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}
      <section className="card mcp-card">
        <div className="card-heading">
          <div>
            <h2>
              <Terminal size={17} />
              Use Tracework inside your coding agent
            </h2>
            <p>Optional MCP tools let Claude Code or Codex read your workflow insights directly.</p>
          </div>
          <span className="project-tag">MCP · Read only</span>
        </div>
        <div className="mcp-body">
          <p>
            Enable local sync above, keep Tracework running, then run the matching command in your
            terminal. Reopen your coding agent if it doesn’t pick up the new MCP server.
          </p>
          {state &&
            (['codex', 'claude'] as const).map((id) => (
              <div className="install-command" key={id}>
                <div>
                  <strong>{id === 'codex' ? 'Codex' : 'Claude Code'}</strong>
                  <button className="text-button" onClick={() => copy(id, state.mcp[id])}>
                    {copied === id ? <Check size={13} /> : <Copy size={13} />}{' '}
                    {copied === id ? 'Copied' : 'Copy command'}
                  </button>
                </div>
                <pre>{state.mcp[id]}</pre>
              </div>
            ))}
          <div className="agent-prompt">
            <span>
              <Activity size={16} />
            </span>
            <div>
              <strong>Then ask your agent</strong>
              <p>
                “Use Tracework to review my recent sessions for this project. Show the evidence
                behind recurring failures and suggest one repository improvement.”
              </p>
            </div>
          </div>
          <div className="mcp-tools">
            {['tracework_summary', 'tracework_sessions', 'tracework_session'].map((n) => (
              <code key={n}>{n}</code>
            ))}
          </div>
          <p className="mcp-note">
            The MCP server reads only sessions already in Tracework. It does not connect providers,
            modify your repository, or change your coding-tool settings. Calling these tools shares
            the returned session excerpts with the model in that coding tool.
          </p>
          <div className="connection-docs">
            <a
              href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli"
              target="_blank"
              rel="noreferrer"
            >
              Codex MCP setup <ArrowUpRight size={12} />
            </a>
            <a href="https://code.claude.com/docs/en/mcp" target="_blank" rel="noreferrer">
              Claude Code MCP setup <ArrowUpRight size={12} />
            </a>
          </div>
        </div>
      </section>
      <div className="connection-footnote">
        <ShieldCheck size={16} />
        <p>
          Connections start disabled. Only JSONL session files inside the directory you enable are
          read. Existing tool settings stay untouched. Disconnecting stops collection and keeps
          already synced records. Deleting a synced session prevents it from returning
          automatically.
        </p>
      </div>
    </div>
  );
}
function ConnectionCard({
  connection: c,
  busy,
  onChange,
}: {
  connection: Connection;
  busy: boolean;
  onChange: (v: unknown) => Promise<void>;
}) {
  const [directory, setDirectory] = useState(c.directory);
  const [engineer, setEngineer] = useState(c.engineer === 'Unassigned' ? '' : c.engineer);
  const [history, setHistory] = useState('7');
  const [error, setError] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const d = c.diagnostics;
  const last = c.lastSync ? new Date(c.lastSync).toLocaleString() : 'Not synced yet';
  return (
    <section className="card connection-card">
      <div className="connection-card-heading">
        <span className={`connection-provider ${c.id}`}>
          <Code2 size={24} />
        </span>
        <div>
          <h2>{c.name}</h2>
          <p>
            {c.id === 'codex'
              ? 'Local CLI & desktop session files'
              : 'Local Claude Code conversations'}
          </p>
        </div>
        <span className={`connection-status ${c.enabled ? 'connected' : ''}`}>
          <i />
          {c.enabled
            ? c.lastError
              ? 'Needs attention'
              : c.pending
                ? 'Indexing'
                : 'Connected'
            : 'Not connected'}
        </span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await onChange({ enabled: true, directory, engineer, history });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="connection-card-body">
          <label>
            Session directory
            <input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              disabled={c.enabled || busy}
              required
              placeholder="Absolute path to session directory"
            />
            {window.traceworkDesktop && (
              <button
                type="button"
                className="text-button directory-picker"
                disabled={c.enabled || busy}
                onClick={async () => {
                  try {
                    const value = await window.traceworkDesktop!.chooseDirectory(directory);
                    if (value) setDirectory(value);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Choose folder…
              </button>
            )}
            <small>
              {c.id === 'codex'
                ? 'Default: ~/.codex/sessions (or CODEX_HOME/sessions)'
                : 'Default: ~/.claude/projects (or CLAUDE_CONFIG_DIR/projects)'}
            </small>
          </label>
          <div className="form-grid">
            <label>
              Assign engineer
              <input
                placeholder="Your name"
                value={engineer}
                onChange={(e) => setEngineer(e.target.value)}
                disabled={c.enabled || busy}
                maxLength={100}
              />
            </label>
            <label>
              Include sessions modified
              <select
                value={history}
                onChange={(e) => setHistory(e.target.value)}
                disabled={c.enabled || busy}
              >
                <option value="new">From now on</option>
                <option value="7">In the last 7 days</option>
                <option value="30">In the last 30 days</option>
                <option value="all">Any time</option>
              </select>
            </label>
          </div>
          {c.enabled ? (
            <div className="sync-summary">
              <div>
                <span>Synced sessions</span>
                <strong>{c.imported}</strong>
              </div>
              <div>
                <span>Session refreshes</span>
                <strong>{c.updated}</strong>
              </div>
              <div>
                <span>Waiting to index</span>
                <strong>{c.pending}</strong>
              </div>
            </div>
          ) : (
            <p className="connection-consent">
              Connecting permits Tracework to read matching session files in this folder and store
              redacted copies locally. No hooks, extensions, or API keys required.
            </p>
          )}
          {c.lastError && <p className="form-error">{c.lastError}</p>}
          {d && (
            <section className="sync-diagnostics" aria-label={`${c.name} collection diagnostics`}>
              <h3>Collection health</h3>
              <p>
                Last successful scan:{' '}
                {c.lastSync ? new Date(c.lastSync).toLocaleString() : 'Not yet completed'}
              </p>
              <p>
                Latest attempt: {new Date(d.attemptedAt).toLocaleString()} ·{' '}
                {d.completedAt ? 'Completed' : 'Failed; counts may be partial'}
              </p>
              <div className="diagnostic-grid">
                {[
                  ['JSONL files found', d.discovered],
                  ['In history window', d.eligible],
                  ['Files processed this scan', d.processed],
                  ['Files unchanged', d.unchanged],
                  ['Entries skipped', d.skipped],
                  ['Outstanding warnings', d.warnings],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p>
                History: files modified{' '}
                {Date.parse(c.since) === 0
                  ? 'at any time'
                  : `since ${new Date(c.since).toLocaleString()}`}
                . {c.pending} changed files waiting for a later batch.
              </p>
              {d.limited && (
                <p className="form-error">
                  Directory scan limit reached; choose a narrower session folder. Counts cover only
                  the visited entries.
                </p>
              )}
              <details>
                <summary>Why a session may be missing</summary>
                <p>
                  Only .jsonl files from this directory and history window are collected. Hidden
                  entries, symlinks, and nested subagents are excluded. Files over 20 MB are
                  skipped; incomplete records wait for more content. Previously deleted sessions
                  stay deleted.
                </p>
                <p>
                  Processed counts are files attempted in the latest scan; synced session totals
                  above accumulate across scans. Skipped entries can be whole directories.
                </p>
                <ul>
                  {Object.entries(d.reasons).map(([label, count]) => (
                    <li key={label}>
                      {label}: {count}
                    </li>
                  ))}
                </ul>
                <p>
                  Up to 100 sampled file and directory results; warnings are prioritized. Unvisited
                  files will not appear in this sample.
                </p>
                <label>
                  Filter sampled paths
                  <input
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                    placeholder="Session filename or folder"
                  />
                </label>
                <div className="diagnostic-files">
                  {d.files
                    .filter((f) => f.path.toLowerCase().includes(fileSearch.toLowerCase()))
                    .map((f, i) => (
                      <div key={`${f.path}-${i}`}>
                        <code>{f.path}</code>
                        <span>
                          {f.status} · {f.reason}
                        </span>
                      </div>
                    ))}
                </div>
                <p>
                  If the file is outside this sample, narrow the connected folder, broaden the
                  history window, or import that session manually.
                </p>
              </details>
            </section>
          )}
          {c.errors.length > 0 && (
            <details className="sync-errors">
              <summary>{d?.warnings || c.errors.length} warnings · showing up to 10</summary>
              {c.errors.map((v, i) => (
                <p key={i}>{v}</p>
              ))}
            </details>
          )}
          {error && !c.lastError && <p className="form-error">{error}</p>}
        </div>
        <div className="connection-card-footer">
          <span>
            {c.enabled ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}{' '}
            {c.lastSync ? `Last successful scan ${last}` : last}
          </span>
          {c.enabled ? (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setError('');
                try {
                  await onChange({ enabled: false });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {busy ? <Loader2 size={14} className="spin" /> : <Unplug size={14} />}Disconnect
            </button>
          ) : (
            <button className="button primary" disabled={busy}>
              {busy ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}{' '}
              {busy ? 'Connecting…' : 'Connect locally'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
