const { app, BrowserWindow, BrowserView, ipcMain, dialog, session, shell } = require('electron');
const path = require('path');
const os = require('os');

// Performance / privacy hardening
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,CanvasOopRasterization');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disk-cache-size', '1');
app.commandLine.appendSwitch('media-cache-size', '1');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let mainWindow;
let splashWindow;
let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let selectedEngine = null;
let homeVisible = true;
let menuOffset = 0;

const UI = {
  topInset: 12,
  horizontalPadding: 12,
  titlebarHeight: 46,
  tabsHeight: 40,
  toolbarHeight: 58,
  gap: 8
};

const GEO_NEW_YORK = {
  latitude: 40.7128,
  longitude: -74.0060,
  accuracy: 25
};

const ENGINE_MAP = {
  google: {
    key: 'google',
    name: 'Google',
    label: 'Google Session',
    home: 'https://www.google.com/',
    search: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`
  },
  bing: {
    key: 'bing',
    name: 'Microsoft Bing',
    label: 'Bing Session',
    home: 'https://www.bing.com/',
    search: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`
  },
  duckduckgo: {
    key: 'duckduckgo',
    name: 'DuckDuckGo',
    label: 'DuckDuckGo Session',
    home: 'https://duckduckgo.com/',
    search: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
  }
};

const BLOCKED_HOST_PATTERNS = [
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'adservice.google.com',
  'adservice.google.',
  'ads.youtube.com',
  'pagead2.googlesyndication.com',
  'partner.googleadservices.com',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'googletagmanager.com/gtag',
  'google-analytics.com',
  'stats.g.doubleclick.net'
];

function nextTabId() {
  tabCounter += 1;
  return `tab_${tabCounter}`;
}

function toolbarBlockHeight() {
  return UI.topInset + UI.titlebarHeight + UI.gap + UI.tabsHeight + UI.gap + UI.toolbarHeight + UI.gap;
}

function boundsForView() {
  if (!mainWindow) return { x: 0, y: 0, width: 800, height: 600 };
  const [width, height] = mainWindow.getContentSize();
  return {
    x: UI.horizontalPadding,
    y: toolbarBlockHeight() + menuOffset,
    width: Math.max(100, width - UI.horizontalPadding * 2),
    height: Math.max(100, height - toolbarBlockHeight() - UI.horizontalPadding - menuOffset)
  };
}

function getActiveEngine() {
  return selectedEngine ? ENGINE_MAP[selectedEngine] : null;
}

function defaultUrlForCurrentSession() {
  return getActiveEngine()?.home || 'about:blank';
}

function normalizeUrl(input) {
  const raw = (input || '').trim();
  const engine = getActiveEngine();
  if (!raw) return engine?.home || 'about:blank';
  if (/^(https?:|file:|about:)/i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
  return engine ? engine.search(raw) : `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

function sendState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const payload = tabs.map(tab => ({
    id: tab.id,
    title: tab.title || 'New Tab',
    url: tab.url || '',
    isLoading: tab.isLoading,
    canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
    canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
    zoomFactor: tab.zoomFactor,
    isActive: tab.id === activeTabId,
    favicon: tab.favicon || null
  }));

  mainWindow.webContents.send('browser-state', {
    tabs: payload,
    activeTabId,
    selectedEngine,
    activeEngineLabel: getActiveEngine()?.label || null,
    isHomeScreen: homeVisible,
    canShowBrowser: !!selectedEngine && !homeVisible,
    isWindowFullscreen: mainWindow.isFullScreen(),
    availableEngines: Object.values(ENGINE_MAP).map(engine => ({
      key: engine.key,
      name: engine.name,
      label: engine.label
    }))
  });
}

async function clearTabData(tab) {
  try {
    await tab.session.clearStorageData({
      storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'serviceworkers', 'cachestorage']
    });
    await tab.session.clearCache();
    await tab.session.clearHostResolverCache();
  } catch (error) {
    console.error('Error clearing tab data:', error);
  }
}

async function clearAndDestroyTab(tab) {
  await clearTabData(tab);
  try {
    if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach();
  } catch {}
  try {
    tab.view.webContents.close({ waitForBeforeUnload: false });
  } catch {}
}

async function destroyAllTabs() {
  if (mainWindow) {
    const currentView = mainWindow.getBrowserView();
    if (currentView) mainWindow.removeBrowserView(currentView);
  }
  for (const tab of tabs) {
    await clearAndDestroyTab(tab);
  }
  tabs = [];
  activeTabId = null;
}

function attachDownloadHandler(ses) {
  ses.on('will-download', async (_event, item) => {
    const defaultDir = path.join(os.homedir(), 'Downloads');
    const chosen = await dialog.showSaveDialog({
      title: 'Save download',
      defaultPath: path.join(defaultDir, item.getFilename())
    });
    if (chosen.canceled || !chosen.filePath) {
      item.cancel();
      return;
    }
    item.setSavePath(chosen.filePath);
    item.once('done', (_e, state) => {
      if (state === 'completed') shell.showItemInFolder(chosen.filePath);
    });
  });
}

function looksLikeAdUrl(url) {
  const lower = (url || '').toLowerCase();
  return BLOCKED_HOST_PATTERNS.some(pattern => lower.includes(pattern));
}

function configurePrivacyAndSecurity(ses) {
  attachDownloadHandler(ses);
  ses.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'geolocation') return callback(true);
    if (permission === 'fullscreen') return callback(true);
    return callback(false);
  });

  ses.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'geolocation') return true;
    if (permission === 'fullscreen') return true;
    return false;
  });

  ses.webRequest.onBeforeRequest((details, callback) => {
    if (looksLikeAdUrl(details.url)) {
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    headers['DNT'] = '1';
    headers['Sec-GPC'] = '1';
    headers['Accept-Language'] = 'en-US,en;q=0.9';
    delete headers['X-Client-Data'];
    delete headers['Via'];
    delete headers['X-Forwarded-For'];
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === 'set-cookie');
    if (headerKey) {
      const mainFrame = details.resourceType === 'mainFrame';
      const sameOrigin = (details.referrer || '').includes(new URL(details.url).hostname);
      if (!mainFrame && !sameOrigin) {
        delete headers[headerKey];
      }
    }
    callback({ responseHeaders: headers });
  });
}

async function attachGeoSpoof(view) {
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach('1.3');
    }
    await view.webContents.debugger.sendCommand('Emulation.setGeolocationOverride', GEO_NEW_YORK);
    await view.webContents.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
    try {
      await view.webContents.debugger.sendCommand('Emulation.setLocaleOverride', { locale: 'en-US' });
    } catch {}
  } catch (error) {
    console.error('Geo/timezone emulation failed:', error.message);
  }
}

async function injectSecurityAndSiteEnhancements(view) {
  const url = view.webContents.getURL() || '';

  try {
    await view.webContents.executeJavaScript(`
      (() => {
        try {
          const fixedPosition = { latitude: 40.7128, longitude: -74.0060, accuracy: 25 };
          const successPosition = {
            coords: {
              latitude: fixedPosition.latitude,
              longitude: fixedPosition.longitude,
              accuracy: fixedPosition.accuracy,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null
            },
            timestamp: Date.now()
          };
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition = (success) => success && success(successPosition);
            navigator.geolocation.watchPosition = (success) => {
              success && success(successPosition);
              return 1;
            };
          }
        } catch {}

        try {
          const OriginalRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
          if (OriginalRTCPeerConnection && !window.__verseRTCWrapped) {
            window.__verseRTCWrapped = true;
            class VerseRTCPeerConnection extends OriginalRTCPeerConnection {
              constructor(config = {}, ...rest) {
                const nextConfig = { ...config, iceServers: [] };
                super(nextConfig, ...rest);
              }
            }
            window.RTCPeerConnection = VerseRTCPeerConnection;
            window.webkitRTCPeerConnection = VerseRTCPeerConnection;
          }
        } catch {}
      })();
    `, true);
  } catch (error) {
    console.error('Injection failed:', error.message);
  }

  if (/https?:\/\/(www\.)?youtube\.com\//i.test(url)) {
    try {
      await view.webContents.executeJavaScript(`
        (() => {
          const applyHighest = () => {
            try {
              const player = document.getElementById('movie_player');
              if (!player || typeof player.getAvailableQualityLevels !== 'function') return;
              const qualities = player.getAvailableQualityLevels() || [];
              if (!qualities.length) return;
              const target = qualities[0];
              if (typeof player.setPlaybackQualityRange === 'function') player.setPlaybackQualityRange(target);
              if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(target);
              try { localStorage.setItem('yt-player-quality', JSON.stringify({ data: target, expiration: Date.now() + 31536000000, creation: Date.now() })); } catch {}
            } catch {}
          };
          applyHighest();
          setTimeout(applyHighest, 800);
          setTimeout(applyHighest, 1800);
          setTimeout(applyHighest, 3200);
          if (!window.__verseQualityObserver) {
            window.__verseQualityObserver = new MutationObserver(() => applyHighest());
            window.__verseQualityObserver.observe(document.documentElement, { childList: true, subtree: true });
          }
        })();
      `, true);
    } catch (error) {
      console.error('YouTube enhancement failed:', error.message);
    }
  }
}

function syncViewBounds(tab) {
  if (!mainWindow || !tab) return;
  const nextBounds = boundsForView();
  tab.view.setBounds(nextBounds);
  tab.view.setAutoResize({ width: true, height: true, horizontal: true, vertical: true });
}

function wireTabEvents(tab) {
  const wc = tab.view.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: 'deny' };
  });

  wc.on('page-title-updated', (_event, title) => {
    tab.title = title || 'New Tab';
    sendState();
  });

  wc.on('did-start-loading', () => {
    tab.isLoading = true;
    sendState();
  });

  wc.on('did-stop-loading', async () => {
    tab.isLoading = false;
    try {
      tab.url = wc.getURL();
      const pageTitle = await wc.getTitle();
      if (pageTitle) tab.title = pageTitle;
    } catch {}
    sendState();
  });

  wc.on('did-finish-load', async () => {
    await attachGeoSpoof(tab.view);
    await injectSecurityAndSiteEnhancements(tab.view);
  });

  wc.on('did-navigate', async (_event, url) => {
    tab.url = url;
    await attachGeoSpoof(tab.view);
    await injectSecurityAndSiteEnhancements(tab.view);
    sendState();
  });

  wc.on('did-navigate-in-page', async (_event, url) => {
    tab.url = url;
    await attachGeoSpoof(tab.view);
    await injectSecurityAndSiteEnhancements(tab.view);
    sendState();
  });

  wc.on('page-favicon-updated', (_event, favicons) => {
    tab.favicon = favicons?.[0] || null;
    sendState();
  });

  wc.on('render-process-gone', () => {
    tab.title = 'Crashed Tab';
    tab.isLoading = false;
    sendState();
  });

  wc.on('enter-html-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(true);
  });

  wc.on('leave-html-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(false);
  });
}

function createTab(targetUrl) {
  if (!selectedEngine) return null;

  const id = nextTabId();
  const partition = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ses = session.fromPartition(partition, { cache: false });
  configurePrivacyAndSecurity(ses);

  const view = new BrowserView({
    webPreferences: {
      session: ses,
      javascript: true,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  const tab = {
    id,
    view,
    session: ses,
    title: 'New Tab',
    url: '',
    isLoading: true,
    zoomFactor: 1,
    favicon: null
  };

  wireTabEvents(tab);
  tabs.push(tab);
  setActiveTab(id);
  const finalUrl = normalizeUrl(targetUrl || defaultUrlForCurrentSession());
  view.webContents.loadURL(finalUrl);
  return tab;
}

function setActiveTab(id) {
  if (homeVisible || !mainWindow) return;
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const currentView = mainWindow.getBrowserView();
  if (currentView && currentView !== tab.view) mainWindow.removeBrowserView(currentView);
  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  syncViewBounds(tab);
  sendState();
}

async function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;

  if (tabs.length === 1) {
    await resetToHome();
    return;
  }

  const tab = tabs[index];
  const wasActive = activeTabId === id;
  const currentView = mainWindow?.getBrowserView();
  if (currentView === tab.view) mainWindow.removeBrowserView(tab.view);
  await clearAndDestroyTab(tab);
  tabs.splice(index, 1);

  if (wasActive) {
    const nextTab = tabs[Math.max(0, index - 1)] || tabs[0];
    if (nextTab) {
      activeTabId = nextTab.id;
      if (!homeVisible) {
        mainWindow.setBrowserView(nextTab.view);
        syncViewBounds(nextTab);
      }
    }
  }
  sendState();
}

function activeTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

let resizeTimer = null;
function resizeViews() {
  const apply = () => {
    const tab = activeTab();
    if (tab && !homeVisible) syncViewBounds(tab);
  };
  clearTimeout(resizeTimer);
  apply();
  resizeTimer = setTimeout(apply, 40);
  setTimeout(apply, 120);
}

async function showHomeScreen() {
  homeVisible = true;
  const currentView = mainWindow?.getBrowserView();
  if (currentView) mainWindow.removeBrowserView(currentView);
  sendState();
}

async function resetToHome() {
  await destroyAllTabs();
  selectedEngine = null;
  homeVisible = true;
  sendState();
}

async function startEngineSession(engineKey) {
  if (!ENGINE_MAP[engineKey]) return false;
  await destroyAllTabs();
  selectedEngine = engineKey;
  homeVisible = false;
  createTab(defaultUrlForCurrentSession());
  sendState();
  return true;
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#050409',
    resizable: false,
    movable: false,
    fullscreen: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      sandbox: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile('splash.html');
  splashWindow.once('ready-to-show', () => splashWindow.show());
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 640,
    frame: false,
    backgroundColor: '#09070d',
    title: 'Verse',
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.webContents.send('start-fade-out');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.maximize();
          mainWindow.show();
          mainWindow.focus();
          sendState();
        }
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      }, 450);
    }, 1000);
  });

  mainWindow.on('resize', resizeViews);
  mainWindow.on('maximize', () => { resizeViews(); sendState(); });
  mainWindow.on('unmaximize', () => { resizeViews(); sendState(); });
  mainWindow.on('enter-full-screen', () => { resizeViews(); sendState(); });
  mainWindow.on('leave-full-screen', () => { resizeViews(); sendState(); });
  mainWindow.on('closed', async () => {
    await destroyAllTabs();
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createSplashWindow();
  await createMainWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', async () => {
  await destroyAllTabs();
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => !!mainWindow?.isMaximized());

ipcMain.handle('tab:new', (_e, url) => createTab(url || defaultUrlForCurrentSession()));
ipcMain.handle('tab:activate', (_e, id) => setActiveTab(id));
ipcMain.handle('tab:close', (_e, id) => closeTab(id));
ipcMain.handle('tab:navigate', (_e, input) => {
  const tab = activeTab();
  if (!tab) return;
  tab.view.webContents.loadURL(normalizeUrl(input));
});
ipcMain.handle('tab:reload', () => activeTab()?.view.webContents.reload());
ipcMain.handle('tab:stop', () => activeTab()?.view.webContents.stop());
ipcMain.handle('tab:back', () => {
  const tab = activeTab();
  if (tab?.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
});
ipcMain.handle('tab:forward', () => {
  const tab = activeTab();
  if (tab?.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
});
ipcMain.handle('tab:zoom-in', () => {
  const tab = activeTab();
  if (!tab) return 1;
  tab.zoomFactor = Math.min(3, +(tab.zoomFactor + 0.1).toFixed(2));
  tab.view.webContents.setZoomFactor(tab.zoomFactor);
  sendState();
  return tab.zoomFactor;
});
ipcMain.handle('tab:zoom-out', () => {
  const tab = activeTab();
  if (!tab) return 1;
  tab.zoomFactor = Math.max(0.3, +(tab.zoomFactor - 0.1).toFixed(2));
  tab.view.webContents.setZoomFactor(tab.zoomFactor);
  sendState();
  return tab.zoomFactor;
});
ipcMain.handle('tab:zoom-reset', () => {
  const tab = activeTab();
  if (!tab) return 1;
  tab.zoomFactor = 1;
  tab.view.webContents.setZoomFactor(1);
  sendState();
  return 1;
});

ipcMain.handle('session:start', (_e, engineKey) => startEngineSession(engineKey));
ipcMain.handle('session:go-home', () => resetToHome());
ipcMain.handle('ui:set-menu-offset', (_e, offset) => {
  menuOffset = Math.max(0, Number(offset) || 0);
  resizeViews();
  return true;
});

ipcMain.handle('session:get-state', () => ({
  selectedEngine,
  activeEngineLabel: getActiveEngine()?.label || null,
  isHomeScreen: homeVisible,
  availableEngines: Object.values(ENGINE_MAP).map(engine => ({
    key: engine.key,
    name: engine.name,
    label: engine.label
  }))
}));
