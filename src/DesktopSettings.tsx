import { useEffect, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, Monitor, ShieldCheck } from 'lucide-react';
export default function DesktopSettings() {
  const bridge = window.traceworkDesktop;
  const [status, setStatus] = useState<Awaited<
    ReturnType<NonNullable<typeof bridge>['getStatus']>
  > | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    bridge
      ?.getStatus()
      .then(setStatus)
      .catch((e) => setMessage(e.message));
  }, []);
  if (!bridge) return null;
  async function update(value: { keepRunningInBackground?: boolean; launchAtLogin?: boolean }) {
    setBusy(true);
    try {
      setStatus(await bridge!.updateSettings(value));
      setMessage('Desktop settings saved.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card desktop-settings">
      <div className="card-heading">
        <div>
          <h2>
            <Monitor size={17} />
            Tracework Desktop
          </h2>
          <p>Installed locally · {status ? `Version ${status.version}` : 'Loading settings…'}</p>
        </div>
        <span className="project-tag">
          {status?.packaged ? 'Installed build' : 'Development build'}
        </span>
      </div>
      <div className="desktop-settings-body">
        <label className="desktop-toggle">
          <div>
            <strong>Keep running when the window closes</strong>
            <p>Collection continues in the menu bar. Quit Tracework stops it.</p>
          </div>
          <input
            type="checkbox"
            aria-label="Keep running when the window closes"
            checked={status?.keepRunningInBackground || false}
            disabled={!status || busy}
            onChange={(e) => void update({ keepRunningInBackground: e.target.checked })}
          />
        </label>
        <label className="desktop-toggle">
          <div>
            <strong>Open at login</strong>
            <p>Start in the background when you sign in to this computer.</p>
          </div>
          <input
            type="checkbox"
            aria-label="Open at login"
            checked={status?.launchAtLogin || false}
            disabled={!status || busy || status.platform === 'linux'}
            onChange={(e) => void update({ launchAtLogin: e.target.checked })}
          />
        </label>
        <div className="desktop-storage">
          <ShieldCheck size={16} />
          <div>
            <strong>Private app storage</strong>
            <code>{status?.dataDirectory || 'Loading…'}</code>
            <p>Your data stays separate from the installed application and survives upgrades.</p>
          </div>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                const error = await bridge.openDataFolder();
                if (error) setMessage(error);
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            <FolderOpen size={14} />
            Open folder
          </button>
        </div>
        <div className="desktop-update">
          <div>
            <strong>Application updates</strong>
            <p>{status?.updateStatus || 'Loading…'}</p>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const value = await bridge.checkUpdates();
                setMessage(value.message);
                setStatus(await bridge.getStatus());
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={14} />
            Check for updates
          </button>
        </div>
        <div className="desktop-update">
          <div>
            <strong>Bring an existing workspace</strong>
            <p>
              Import sessions, reviews, and connections from an earlier local build. Your current
              data is backed up first.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setMessage((await bridge.importWorkspace()).message);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <FolderOpen size={14} />
            Import workspace
          </button>
        </div>
        {message && (
          <div className="desktop-message" role="status">
            <CheckCircle2 size={14} />
            {message}
          </div>
        )}
      </div>
    </section>
  );
}
