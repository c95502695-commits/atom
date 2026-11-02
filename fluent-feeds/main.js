'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store } = require('./src/store');
const { FeedService } = require('./src/service');
const { parseOpml, buildOpml } = require('./src/opml');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let store = null;
let service = null;
let refreshTimer = null;

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

function isWebUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function updateBadge() {
  if (!win || win.isDestroyed()) return;
  const { unread } = store.counts();
  app.setBadgeCount(unread);
  win.setTitle(unread ? `Fluent Feeds (${unread})` : 'Fluent Feeds');
}

async function refreshAll() {
  send('refresh-state', { refreshing: true });
  try {
    return await service.refreshAll();
  } finally {
    send('refresh-state', { refreshing: false });
    send('data-changed');
    updateBadge();
  }
}

/** Wrap a handler so renderer always receives {ok, data|error}. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

function registerIpc() {
  handle('feeds:list', () => store.listFeeds());
  handle('feeds:add', async url => {
    const feed = await service.addFeed(url);
    updateBadge();
    return feed;
  });
  handle('feeds:remove', id => {
    store.removeFeed(id);
    updateBadge();
  });
  handle('feeds:rename', (id, title) => {
    const t = String(title || '').trim();
    if (!t) throw new Error('Name cannot be empty');
    return store.updateFeed(id, { title: t });
  });
  handle('feeds:refresh', () => refreshAll());
  handle('items:list', opts => store.listItems(opts || {}));
  handle('items:get', id => store.getItem(id));
  handle('items:state', (id, patch) => {
    const r = store.setItemState(id, patch || {});
    updateBadge();
    return r;
  });
  handle('items:markAllRead', opts => {
    const n = store.markAllRead(opts || {});
    updateBadge();
    return n;
  });
  handle('counts', () => store.counts());
  handle('open-external', url => {
    if (!isWebUrl(url)) throw new Error('Blocked non-web link');
    return shell.openExternal(url);
  });
  handle('theme:get', () => nativeTheme.shouldUseDarkColors);

  handle('opml:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Import subscriptions',
      filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    const subs = parseOpml(fs.readFileSync(res.filePaths[0], 'utf8'));
    const result = service.importSubscriptions(subs);
    refreshAll().catch(() => {});
    return result;
  });
  handle('opml:export', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: 'Export subscriptions',
      defaultPath: 'fluent-feeds.opml',
      filters: [{ name: 'OPML', extensions: ['opml'] }]
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, buildOpml(store.listFeeds()));
    return res.filePath;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 480,
    title: 'Fluent Feeds',
    show: false,
    // Windows 11: Mica backdrop + native caption buttons drawn over our own title bar.
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  const syncTheme = () => {
    if (process.platform === 'win32' && win && !win.isDestroyed()) {
      win.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
        height: 40
      });
    }
    send('theme-changed', nativeTheme.shouldUseDarkColors);
  };
  nativeTheme.on('updated', syncTheme);

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    nativeTheme.removeListener('updated', syncTheme);
    win = null;
  });

  // Never let the app window navigate away or spawn windows; open links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', event => event.preventDefault());

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Add feed…', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'add-feed') },
        { label: 'Refresh all', accelerator: 'F5', click: () => refreshAll().catch(() => {}) },
        { type: 'separator' },
        { label: 'Import OPML…', click: () => send('menu', 'import') },
        { label: 'Export OPML…', click: () => send('menu', 'export') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }, { type: 'separator' }, { label: 'Search', accelerator: 'CmdOrCtrl+F', click: () => send('menu', 'search') }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'library.json'));
  service = new FeedService(store);
  registerIpc();
  buildMenu();
  createWindow();
  updateBadge();
  refreshAll().catch(() => {});
  refreshTimer = setInterval(() => refreshAll().catch(() => {}), REFRESH_INTERVAL_MS);
});

app.on('window-all-closed', () => {
  clearInterval(refreshTimer);
  app.quit();
});
