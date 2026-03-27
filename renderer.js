const state = {
  tabs: [],
  activeTabId: null,
  favorites: JSON.parse(localStorage.getItem('verseFavorites') || '[]'),
  selectedEngine: null,
  activeEngineLabel: null,
  isHomeScreen: true
};

const tabsEl = document.getElementById('tabs');
const addressForm = document.getElementById('addressForm');
const addressInput = document.getElementById('addressInput');
const backBtn = document.getElementById('backBtn');
const forwardBtn = document.getElementById('forwardBtn');
const reloadBtn = document.getElementById('reloadBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const favoritesEl = document.getElementById('favorites');
const favoritesBtn = document.getElementById('favoritesBtn');
const favoritesMenu = document.getElementById('favoritesMenu');
const addFavoriteBtn = document.getElementById('addFavoriteBtn');
const sessionBtn = document.getElementById('sessionBtn');
const sessionMenu = document.getElementById('sessionMenu');
const homeScreen = document.getElementById('homeScreen');
const sessionOverlay = document.getElementById('sessionOverlay');
const overlaySessionText = document.getElementById('overlaySessionText');
const tabsSection = document.getElementById('tabsSection');
const toolbarSection = document.getElementById('toolbarSection');
const actionCluster = document.querySelector('.action-cluster');

function activeTab() {
  return state.tabs.find(tab => tab.id === state.activeTabId) || null;
}

function shortLabel(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function renderTabs() {
  tabsEl.innerHTML = '';
  state.tabs.forEach(tab => {
    const item = document.createElement('button');
    item.className = `tab ${tab.isActive ? 'active' : ''}`;
    item.dataset.tabId = tab.id;

    const faviconWrap = document.createElement(tab.favicon ? 'img' : 'span');
    faviconWrap.className = tab.favicon ? 'tab-favicon' : 'tab-fallback-dot';
    if (tab.favicon) faviconWrap.src = tab.favicon;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New Tab';

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close tab';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      window.verse.closeTab(tab.id);
    });

    item.append(faviconWrap, title, close);
    item.addEventListener('click', () => window.verse.activateTab(tab.id));
    tabsEl.appendChild(item);
  });

  const current = activeTab();
  addressInput.value = current?.url || '';
  backBtn.disabled = !current?.canGoBack;
  forwardBtn.disabled = !current?.canGoForward;
  reloadBtn.textContent = current?.isLoading ? '✕' : '↻';
  zoomResetBtn.textContent = `${Math.round((current?.zoomFactor || 1) * 100)}%`;
}

function persistFavorites() {
  localStorage.setItem('verseFavorites', JSON.stringify(state.favorites));
}

function renderFavorites() {
  favoritesEl.innerHTML = '';
  if (!state.favorites.length) {
    const empty = document.createElement('div');
    empty.className = 'favorites-empty';
    empty.textContent = 'No favorites yet.';
    favoritesEl.appendChild(empty);
    return;
  }

  state.favorites.forEach((favorite, index) => {
    const pill = document.createElement('div');
    pill.className = 'favorite-pill';

    const link = document.createElement('button');
    link.className = 'favorite-link';
    link.textContent = favorite.title || shortLabel(favorite.url);
    link.title = favorite.url;
    link.addEventListener('click', () => {
      favoritesMenu.classList.add('hidden');
      window.verse.navigate(favorite.url);
    });

    const remove = document.createElement('button');
    remove.className = 'favorite-remove';
    remove.textContent = '×';
    remove.title = 'Remove favorite';
    remove.addEventListener('click', () => {
      state.favorites.splice(index, 1);
      persistFavorites();
      renderFavorites();
    });

    pill.append(link, remove);
    favoritesEl.appendChild(pill);
  });
}

function syncMenuOverlay() {
  const menus = [sessionMenu, favoritesMenu].filter(menu => !menu.classList.contains('hidden'));
  if (!menus.length || state.isHomeScreen) {
    window.verse.setMenuOffset(0);
    return;
  }

  let maxBottom = 0;
  for (const menu of menus) {
    const rect = menu.getBoundingClientRect();
    maxBottom = Math.max(maxBottom, rect.bottom);
  }

  const contentTop = document.getElementById('contentArea').getBoundingClientRect().top;
  const reserve = Math.max(0, Math.ceil(maxBottom - contentTop + 12));
  window.verse.setMenuOffset(reserve);
}

function applyHomeMode() {
  document.body.classList.toggle('home-mode', state.isHomeScreen);
  homeScreen.classList.toggle('hidden', !state.isHomeScreen);
  tabsSection.classList.toggle('hidden', state.isHomeScreen);
  toolbarSection.classList.toggle('hidden', state.isHomeScreen);
  sessionBtn.textContent = state.activeEngineLabel || 'Session';
  favoritesBtn.classList.toggle('hidden', state.isHomeScreen);
  if (state.isHomeScreen) window.verse.setMenuOffset(0);
}


function updateFromPayload(payload) {
  state.tabs = payload.tabs;
  state.activeTabId = payload.activeTabId;
  state.selectedEngine = payload.selectedEngine;
  state.activeEngineLabel = payload.activeEngineLabel;
  state.isHomeScreen = payload.isHomeScreen;
  renderTabs();
  applyHomeMode();
}

async function runSessionAnimation(label) {
  overlaySessionText.textContent = `Establishing ${label}`;
  sessionOverlay.classList.remove('hidden');
  requestAnimationFrame(() => sessionOverlay.classList.add('visible'));
  await new Promise(resolve => setTimeout(resolve, 3000));
}

function closeOverlay() {
  sessionOverlay.classList.remove('visible');
  setTimeout(() => sessionOverlay.classList.add('hidden'), 280);
}

async function startSession(engineKey, label) {
  sessionMenu.classList.add('hidden');
  favoritesMenu.classList.add('hidden');
  await runSessionAnimation(label);
  await window.verse.startSession(engineKey);
  closeOverlay();
}

window.verse.onState(updateFromPayload);
window.verse.getSessionState().then((payload) => {
  state.selectedEngine = payload.selectedEngine;
  state.activeEngineLabel = payload.activeEngineLabel;
  state.isHomeScreen = payload.isHomeScreen;
  applyHomeMode();
  renderFavorites();
});

document.getElementById('newTab').addEventListener('click', () => window.verse.newTab());
document.getElementById('closeWindow').addEventListener('click', () => window.verse.closeWindow());
document.getElementById('minimizeWindow').addEventListener('click', () => window.verse.minimize());
document.getElementById('maximizeWindow').addEventListener('click', () => window.verse.maximizeToggle());

backBtn.addEventListener('click', () => window.verse.goBack());
forwardBtn.addEventListener('click', () => window.verse.goForward());
reloadBtn.addEventListener('click', () => {
  const current = activeTab();
  if (current?.isLoading) window.verse.stop();
  else window.verse.reload();
});

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  window.verse.navigate(addressInput.value);
});

zoomInBtn.addEventListener('click', () => window.verse.zoomIn());
zoomOutBtn.addEventListener('click', () => window.verse.zoomOut());
zoomResetBtn.addEventListener('click', () => window.verse.zoomReset());

addFavoriteBtn.addEventListener('click', () => {
  const current = activeTab();
  if (!current?.url) return;
  const exists = state.favorites.some(item => item.url === current.url);
  if (!exists) {
    state.favorites.push({ title: current.title || shortLabel(current.url), url: current.url });
    persistFavorites();
    renderFavorites();
  }
});

favoritesBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  sessionMenu.classList.add('hidden');
  favoritesMenu.classList.toggle('hidden');
  syncMenuOverlay();
});

sessionBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  favoritesMenu.classList.add('hidden');
  sessionMenu.classList.toggle('hidden');
  syncMenuOverlay();
});

document.querySelectorAll('.engine-card').forEach(button => {
  button.addEventListener('click', () => {
    const key = button.dataset.engine;
    const labels = {
      google: 'Google Session',
      bing: 'Microsoft Bing Session',
      duckduckgo: 'DuckDuckGo Session'
    };
    startSession(key, labels[key]);
  });
});

document.querySelectorAll('.session-option').forEach(button => {
  button.addEventListener('click', async () => {
    const targetEngine = button.dataset.engine;
    const wantsHome = button.dataset.home === 'true';
    sessionMenu.classList.add('hidden');
    syncMenuOverlay();

    if (wantsHome) {
      await window.verse.goHome();
      return;
    }

    const labels = {
      google: 'Google Session',
      bing: 'Microsoft Bing Session',
      duckduckgo: 'DuckDuckGo Session'
    };
    await startSession(targetEngine, labels[targetEngine]);
  });
});

document.addEventListener('click', (event) => {
  if (!sessionMenu.contains(event.target) && event.target !== sessionBtn) {
    sessionMenu.classList.add('hidden');
  }
  if (!favoritesMenu.contains(event.target) && event.target !== favoritesBtn) {
    favoritesMenu.classList.add('hidden');
  }
  syncMenuOverlay();
});

document.addEventListener('keydown', (event) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const modifier = isMac ? event.metaKey : event.ctrlKey;

  if (!state.isHomeScreen && modifier && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    addressInput.focus();
    addressInput.select();
  }

  if (!state.isHomeScreen && modifier && event.key.toLowerCase() === 't') {
    event.preventDefault();
    window.verse.newTab();
  }

  if (!state.isHomeScreen && modifier && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    const current = activeTab();
    if (current) window.verse.closeTab(current.id);
  }

  if (!state.isHomeScreen && modifier && event.key === '=') {
    event.preventDefault();
    window.verse.zoomIn();
  }

  if (!state.isHomeScreen && modifier && event.key === '-') {
    event.preventDefault();
    window.verse.zoomOut();
  }

  if (!state.isHomeScreen && modifier && event.key === '0') {
    event.preventDefault();
    window.verse.zoomReset();
  }
});

window.addEventListener('resize', syncMenuOverlay);
window.addEventListener('scroll', syncMenuOverlay, true);
