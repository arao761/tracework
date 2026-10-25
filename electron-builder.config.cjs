const path = require('node:path');
const arch = process.env.TRACEWORK_TARGET_ARCH || process.arch;
const target = process.env.TRACEWORK_TARGET_PLATFORM || process.platform;
const signed = !!(process.env.CSC_LINK || process.env.CSC_NAME);
if (
  process.env.TRACEWORK_RELEASE === '1' &&
  target === 'darwin' &&
  !(process.env.APPLE_ID || process.env.APPLE_API_KEY)
)
  throw new Error('Public macOS releases require notarization credentials.');
if (process.env.TRACEWORK_RELEASE === '1' && !signed)
  throw new Error(
    'Public releases require a signing identity. Configure CSC_LINK/CSC_KEY_PASSWORD and notarization credentials.',
  );
module.exports = {
  appId: 'dev.tracework.desktop',
  productName: 'Tracework',
  copyright: 'Copyright © 2026 Tracework',
  directories: {
    output: process.env.TRACEWORK_OUTPUT_DIR || 'release',
    buildResources: 'desktop/assets',
  },
  asar: true,
  npmRebuild: false,
  files: ['desktop/main.cjs', 'desktop/preload.cjs', 'package.json'],
  extraResources: [
    { from: 'dist', to: 'frontend' },
    { from: 'dist-server', to: 'server' },
    { from: `build/runtime/${target}-${arch}`, to: 'runtime' },
    { from: 'desktop/assets', to: 'desktop-assets' },
    { from: 'build/release-config.json', to: 'release-config.json' },
  ],
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    icon: 'desktop/assets/icon.icns',
    identity: signed ? undefined : '-',
    hardenedRuntime: signed,
    gatekeeperAssess: false,
    entitlements: 'desktop/entitlements.mac.plist',
    entitlementsInherit: 'desktop/entitlements.mac.plist',
    notarize: signed && !!(process.env.APPLE_ID || process.env.APPLE_API_KEY),
    binaries: ['Contents/Resources/runtime/node'],
    minimumSystemVersion: require('./desktop/runtime.json').minimumMacOS,
  },
  dmg: {
    title: 'Tracework',
    contents: [
      { x: 150, y: 180, type: 'file' },
      { x: 430, y: 180, type: 'link', path: '/Applications' },
    ],
    window: { width: 580, height: 380 },
  },
  win: { target: 'nsis', icon: 'desktop/assets/icon.png' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: { target: 'AppImage', category: 'Development', icon: 'desktop/assets/icon.png' },
  artifactName: 'Tracework-${version}-${os}-${arch}.${ext}',
  publish: process.env.TRACEWORK_UPDATE_URL
    ? { provider: 'generic', url: process.env.TRACEWORK_UPDATE_URL }
    : null,
};
