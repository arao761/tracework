const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  clipboard,
  dialog,
  shell,
  session,
} = require('electron');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const testMode = !!process.env.TRACEWORK_TEST_DATA;
if (testMode) app.setPath('userData', path.resolve(process.env.TRACEWORK_TEST_DATA));
else app.setPath('userData', path.join(app.getPath('appData'), 'Tracework'));
const dataDir = app.getPath('userData');
const assets = app.isPackaged
  ? path.join(process.resourcesPath, 'desktop-assets')
  : path.join(__dirname, 'assets');
const resourceRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const serverDir = app.isPackaged
  ? path.join(resourceRoot, 'server')
  : path.join(resourceRoot, 'dist-server');
const nodePath = app.isPackaged
  ? path.join(resourceRoot, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  : path.join(
      resourceRoot,
      'build',
      'runtime',
      `${process.platform}-${process.arch}`,
      process.platform === 'win32' ? 'node.exe' : 'node',
    );
const frontend = app.isPackaged
  ? path.join(resourceRoot, 'frontend')
  : path.join(resourceRoot, 'dist');
const discovery = path.join(dataDir, 'runtime.json');
const token = randomBytes(32).toString('hex'),
  mcpToken = randomBytes(32).toString('hex');
let window = null,
  tray = null,
  backend = null,
  origin = '',
  quitting = false,
  cleaned = false,
  restarts = 0;
const stopping = new WeakSet();
let settings = { keepRunningInBackground: true, launchAtLogin: false };
let updateStatus = 'Automatic updates aren’t configured for this beta.';
let updater = null,
  updaterAvailable = false;
const quote = (v) => `'${v.replaceAll("'", "'\\''")}'`;
async function log(message) {
  try {
    const file = path.join(dataDir, 'logs', 'desktop.log');
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.size > 1024 * 1024) await fs.rename(file, file + '.previous').catch(() => {});
    await fs.appendFile(file, `${new Date().toISOString()} ${String(message).slice(0, 4000)}\n`, {
      mode: 0o600,
    });
  } catch {}
}
async function saveSettings() {
  await fs.writeFile(path.join(dataDir, 'preferences.json'), JSON.stringify(settings, null, 2), {
    mode: 0o600,
  });
}
async function createLauncher() {
  const bin = path.join(dataDir, 'bin');
  await fs.mkdir(bin, { recursive: true, mode: 0o700 });
  const script = path.join(serverDir, 'mcp.cjs');
  if (process.platform === 'win32') {
    const launcher = path.join(bin, 'tracework-mcp.cmd');
    await fs.writeFile(
      launcher,
      `@echo off\r\n"${nodePath}" "${script}" --discovery "${discovery}"\r\n`,
      { mode: 0o700 },
    );
    return ['cmd.exe', '/d', '/c', launcher];
  }
  const launcher = path.join(bin, 'tracework-mcp');
  await fs.writeFile(
    launcher,
    `#!/bin/sh\nexec ${quote(nodePath)} ${quote(script)} --discovery ${quote(discovery)}\n`,
    { mode: 0o700 },
  );
  await fs.chmod(launcher, 0o700);
  return [launcher];
}
async function startBackend() {
  const command = await createLauncher();
  await fs.access(nodePath);
  await fs.access(path.join(serverDir, 'desktop.cjs'));
  const child = spawn(nodePath, [path.join(serverDir, 'desktop.cjs')], {
    cwd: dataDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: undefined,
      TRACEWORK_DESKTOP_DATA: dataDir,
      TRACEWORK_DESKTOP_ASSETS: frontend,
      TRACEWORK_AUTH_TOKEN: token,
      TRACEWORK_MCP_TOKEN: mcpToken,
      TRACEWORK_DISCOVERY_PATH: discovery,
      TRACEWORK_MCP_COMMAND: JSON.stringify(command),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  backend = child;
  child.stderr.on('data', (b) => void log(`backend: ${b.toString()}`));
  child.stdout.on('data', (b) => void log(`backend: ${b.toString()}`));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('The local service did not start in time.'));
    }, 20000);
    const fail = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Local service exited during startup (${code}).`)));
    child.on('message', (message) => {
      if (message?.type === 'ready') {
        clearTimeout(timeout);
        origin = new URL(message.url).origin;
        resolve();
      } else if (message?.type === 'error') fail(new Error(message.message));
    });
  });
  child.once('exit', () => {
    if (backend === child) backend = null;
    if (quitting || stopping.has(child)) return;
    void log('Local service exited unexpectedly.');
    if (restarts++ < 3)
      setTimeout(() => {
        if (!quitting)
          void startBackend()
            .then(() => window?.loadURL(origin))
            .catch(fatal);
      }, 750);
    else
      fatal(
        new Error(
          'The local service stopped repeatedly. Your data is preserved; reopen Tracework.',
        ),
      );
  });
}
async function stopBackend() {
  const child = backend;
  backend = null;
  if (child) stopping.add(child);
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish();
    }, 5000);
    child.once('exit', finish);
    child.kill('SIGTERM');
  });
}
async function fatal(error) {
  await log(error.stack || error.message);
  dialog.showErrorBox(
    'Tracework couldn’t start',
    `${error.message}\n\nYour data is stored in:\n${dataDir}`,
  );
  app.quit();
}
function openWindow() {
  if (!origin) return;
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 1370,
    height: 930,
    minWidth: 740,
    minHeight: 600,
    title: 'Tracework',
    backgroundColor: '#f8f9fb',
    icon: path.join(assets, 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: 'persist:tracework-desktop',
    },
  });
  const current = window;
  current.once('ready-to-show', () => current.show());
  current.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  current.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      if (url.startsWith('https://')) void shell.openExternal(url);
    }
  });
  current.on('close', (event) => {
    if (!quitting && settings.keepRunningInBackground && tray) {
      event.preventDefault();
      current.hide();
    }
  });
  current.on('closed', () => {
    if (window === current) window = null;
  });
  current.webContents.on('render-process-gone', (_event, details) => {
    void log(`Renderer stopped: ${details.reason}`);
    if (!quitting) void current.loadURL(origin);
  });
  void current.loadURL(origin);
}
function installMenu() {
  const show = () => openWindow();
  const menu = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Tracework',
            submenu: [
              {
                label: 'About Tracework',
                click: () =>
                  dialog.showMessageBox({
                    type: 'info',
                    title: 'Tracework',
                    message: `Tracework ${app.getVersion()}`,
                    detail: 'Local engineering intelligence for coding-agent sessions.',
                  }),
              },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  show();
                  void window.loadURL(origin + '/#connections');
                },
              },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Tracework', accelerator: 'CmdOrCtrl+Shift+O', click: show },
        {
          label: 'Connections',
          click: () => {
            show();
            void window.loadURL(origin + '/#connections');
          },
        },
        { type: 'separator' },
        { role: 'close' },
        ...(process.platform === 'darwin' ? [] : [{ role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
        { label: 'Check for updates…', click: () => void checkUpdates() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  let image = nativeImage.createFromPath(
    path.join(assets, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'),
  );
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Tracework — local agent insights');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Tracework', click: show },
      {
        label: 'Connections',
        click: () => {
          show();
          void window.loadURL(origin + '/#connections');
        },
      },
      { type: 'separator' },
      { label: 'Quit Tracework', click: () => app.quit() },
    ]),
  );
  tray.on('double-click', show);
  if (process.platform === 'darwin') tray.on('click', show);
}
function trusted(event) {
  return (
    !!window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    new URL(event.senderFrame.url).origin === origin
  );
}
function state() {
  return {
    ...settings,
    version: app.getVersion(),
    dataDirectory: dataDir,
    packaged: app.isPackaged,
    platform: process.platform,
    updateStatus,
  };
}
function installIpc() {
  const handle = (name, fn) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted desktop request.');
      return fn(...args);
    });
  handle('tracework:status', () => state());
  handle('tracework:copy', (value) => {
    if (typeof value !== 'string' || value.length > 100000)
      throw new Error('Invalid clipboard text.');
    clipboard.writeText(value);
    return true;
  });
  handle('tracework:settings', async (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).some((k) => !['keepRunningInBackground', 'launchAtLogin'].includes(k)) ||
      Object.values(value).some((v) => typeof v !== 'boolean')
    )
      throw new Error('Invalid settings.');
    if (value.launchAtLogin !== undefined) {
      if (testMode && value.launchAtLogin)
        throw new Error('Login changes are disabled during isolated tests.');
      if (process.platform === 'linux')
        throw new Error('Launch at login is not available in this build.');
      app.setLoginItemSettings({
        openAtLogin: value.launchAtLogin,
        path: process.execPath,
        args: ['--hidden'],
      });
    }
    settings = { ...settings, ...value };
    await saveSettings();
    return state();
  });
  handle('tracework:directory', async (value) => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a session directory',
      properties: ['openDirectory'],
      defaultPath: typeof value === 'string' && value.length < 4096 ? value : undefined,
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('tracework:open-data', () => shell.openPath(dataDir));
  handle('tracework:import-workspace', async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Choose an existing Tracework data folder',
      properties: ['openDirectory'],
    });
    if (picked.canceled) return { message: 'Import cancelled.' };
    const source = path.join(picked.filePaths[0], 'tracework.sqlite');
    if (path.resolve(source) === path.join(dataDir, 'tracework.sqlite'))
      return { message: 'You are already using this workspace.' };
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['Import workspace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Replace this workspace with the selected one?',
      detail:
        'Sessions, reviews, and enabled source settings will be copied. Your current database will be backed up first. The source workspace is kept unchanged.',
    });
    if (response !== 0) return { message: 'Import cancelled.' };
    const fresh = path.join(dataDir, `workspace-import-${Date.now()}.sqlite`);
    await execFileAsync(nodePath, [path.join(serverDir, 'workspace.cjs'), source, fresh], {
      timeout: 60000,
    });
    await stopBackend();
    try {
      const backups = path.join(dataDir, 'backups');
      await fs.mkdir(backups, { recursive: true, mode: 0o700 });
      await execFileAsync(
        nodePath,
        [
          path.join(serverDir, 'workspace.cjs'),
          path.join(dataDir, 'tracework.sqlite'),
          path.join(backups, `before-import-${Date.now()}.sqlite`),
        ],
        { timeout: 60000 },
      );
      await fs.rename(fresh, path.join(dataDir, 'tracework.sqlite'));
    } finally {
      await fs.rm(fresh, { force: true });
      await startBackend();
      await window?.loadURL(origin + '/#connections');
    }
    return { message: 'Workspace imported. The previous database is in the backups folder.' };
  });
  handle('tracework:updates', checkUpdates);
}
async function checkUpdates() {
  if (!updater) {
    return { message: updateStatus };
  }
  try {
    const result = await updater.checkForUpdates();
    if (!result?.isUpdateAvailable) updateStatus = 'You’re using the latest available release.';
    return { message: updateStatus };
  } catch (error) {
    await log(`Update check failed: ${error.message}`);
    updateStatus = 'Could not check for updates. Try again later.';
    return { message: updateStatus };
  }
}
async function configureUpdates() {
  let config = {};
  try {
    config = JSON.parse(
      await fs.readFile(
        app.isPackaged
          ? path.join(process.resourcesPath, 'release-config.json')
          : path.join(__dirname, 'release-config.json'),
        'utf8',
      ),
    );
  } catch {}
  if (!app.isPackaged || !config.updateUrl || !config.signed) return;
  const target = new URL(config.updateUrl);
  if (target.protocol !== 'https:') throw new Error('Update feed must use HTTPS.');
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.setFeedURL({ provider: 'generic', url: target.href });
  updateStatus = 'Updates are available through the configured release feed.';
  updater.on('error', (error) => void log(`Updater: ${error.message}`));
  updater.on('update-available', async (info) => {
    updateStatus = `Version ${info.version} is available.`;
    const { response } = await dialog.showMessageBox(window || undefined, {
      type: 'info',
      buttons: ['Download update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: updateStatus,
      detail: 'Your local data and connection settings will be kept.',
    });
    if (response === 0) {
      updateStatus = 'Downloading update…';
      void updater.downloadUpdate().catch((error) => log(error.message));
    }
  });
  updater.on('update-downloaded', async () => {
    updateStatus = 'Update downloaded. Restart to install.';
    const { response } = await dialog.showMessageBox(window || undefined, {
      type: 'info',
      buttons: ['Restart and install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: 'The Tracework update is ready.',
    });
    if (response === 0) {
      quitting = true;
      await stopBackend();
      cleaned = true;
      updater.quitAndInstall();
    }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => openWindow());
  app.on('activate', () => {
    if (origin) openWindow();
  });
  app.on('window-all-closed', () => {
    if (!settings.keepRunningInBackground || !tray) app.quit();
  });
  app.on('before-quit', (event) => {
    if (cleaned) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void stopBackend().finally(() => {
      cleaned = true;
      tray?.destroy();
      app.quit();
    });
  });
  app
    .whenReady()
    .then(async () => {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      app.setAppLogsPath(path.join(dataDir, 'logs'));
      try {
        const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'preferences.json'), 'utf8'));
        for (const key of Object.keys(settings))
          if (typeof saved[key] === 'boolean') settings[key] = saved[key];
      } catch {}
      const ses = session.fromPartition('persist:tracework-desktop');
      ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      ses.setPermissionCheckHandler(() => false);
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        if (origin && details.url.startsWith(origin + '/'))
          details.requestHeaders.Authorization = `Bearer ${token}`;
        callback({ requestHeaders: details.requestHeaders });
      });
      ses.on('will-download', (_event, item, contents) => {
        if (!window || contents !== window.webContents) {
          item.cancel();
          return;
        }
        item.setSaveDialogOptions({
          title: 'Export Tracework report',
          defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())),
        });
      });
      installIpc();
      await startBackend();
      installMenu();
      await configureUpdates();
      const hidden = process.argv.includes('--hidden');
      if (!hidden) openWindow();
      await log(`Tracework ${app.getVersion()} started (${process.platform}/${process.arch}).`);
    })
    .catch(fatal);
}
