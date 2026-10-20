// アプリ本体：起動、ルーティング、画面の切り替え。
import { APP_NAME } from './config.js';
import { html } from './util.js';
import { Repo, getConnection, makeAdapter } from './store/repo.js';
import { describeError } from './store/errors.js';
import { installCoverErrorHandler, loadingHtml, errorHtml, confirmDialog } from './ui/components.js';
import * as shelfView from './ui/shelf.js';
import * as addView from './ui/add.js';
import * as workView from './ui/work.js';
import * as sharesView from './ui/shares.js';
import * as settingsView from './ui/settings.js';

const main = document.getElementById('view');
let repo = null;
let bootError = null;
let ready = false;
let dirty = false;
let currentHash = location.hash;
let suppressHashChange = false;
let cleanup = null;
let viewRoot = main;

const routes = [
  [/^\/?$/, shelfView.render, 'shelf'],
  [/^\/add$/, addView.render, 'add'],
  [/^\/work\/([^/]+)$/, workView.renderDetail, 'shelf'],
  [/^\/work\/([^/]+)\/edit$/, workView.renderEdit, 'shelf'],
  [/^\/work\/([^/]+)\/exp\/([^/]+)$/, workView.renderExperience, 'shelf'],
  [/^\/shares$/, sharesView.renderList, 'shares'],
  [/^\/shares\/([^/]+)$/, sharesView.renderEditor, 'shares'],
  [/^\/settings$/, settingsView.render, 'settings'],
  [/^\/welcome$/, settingsView.renderWelcome, ''],
];

const ctx = {
  get repo() { return repo; },
  // 画面ごとに新しい要素を渡す（イベントリスナーが積み重ならないように）
  get main() { return viewRoot; },
  navigate(path, { replace = false } = {}) {
    dirty = false;
    if (replace) {
      history.replaceState(null, '', `#${path}`);
      currentHash = location.hash;
      route();
    } else if (location.hash === `#${path}`) {
      route();
    } else {
      location.hash = path;
    }
  },
  setDirty(v) { dirty = v; },
  rerender() { route(); },
  async reconnect() {
    await boot();
  },
};

function currentPath() {
  return decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
}

function updateChrome(conn, nav) {
  document.querySelector('.mode-badge').hidden = conn?.mode !== 'trial';
  document.querySelectorAll('.bottom-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === nav);
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.body.classList.toggle('no-conn', !conn);
}

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const path = currentPath();
  const conn = getConnection();
  let match = null;
  for (const [re, fn, nav] of routes) {
    const m = path.match(re);
    if (m) { match = { fn, nav, params: m.slice(1) }; break; }
  }
  if (!conn && !/^\/(welcome|settings)$/.test(path)) {
    history.replaceState(null, '', '#/welcome');
    currentHash = location.hash;
    return route();
  }
  updateChrome(conn, match?.nav);
  window.scrollTo(0, 0);
  if (!match) {
    main.innerHTML = String(html`<div class="state"><p>ページが見つかりません。</p><a class="btn" href="#/">作品棚へ</a></div>`);
    return;
  }
  const needsData = !/^\/(welcome|settings)$/.test(path);
  if (needsData && !ready) {
    if (bootError) {
      main.innerHTML = String(html`${errorHtml(`記録を読み込めませんでした。${describeError(bootError)}`)}<p class="center"><a href="#/settings">接続設定を確認する</a></p>`);
      main.querySelector('[data-act="retry"]').addEventListener('click', () => boot());
    } else {
      main.innerHTML = String(loadingHtml('記録を読み込み中…'));
    }
    return;
  }
  viewRoot = document.createElement('div');
  viewRoot.className = 'view-root';
  main.replaceChildren(viewRoot);
  try {
    cleanup = await match.fn(ctx, ...match.params);
  } catch (e) {
    console.error(e);
    main.innerHTML = String(errorHtml(describeError(e), { retry: true }));
    main.querySelector('[data-act="retry"]').addEventListener('click', () => route());
  }
}

window.addEventListener('hashchange', async () => {
  if (suppressHashChange) { suppressHashChange = false; return; }
  if (dirty) {
    const next = location.hash;
    // いったん元に戻してから確認する
    suppressHashChange = true;
    history.replaceState(null, '', currentHash || '#/');
    suppressHashChange = false;
    const ok = await confirmDialog('入力中の内容は保存されていません。移動しますか？', { okLabel: '破棄して移動', danger: true });
    if (!ok) return;
    dirty = false;
    location.hash = next;
    return;
  }
  currentHash = location.hash;
  route();
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 別端末での更新を拾う：画面に戻ってきたとき、入力中でなければ読み直す
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !ready || dirty || !repo) return;
  if (Date.now() - repo.loadedAt < 30000) return;
  try {
    if (await repo.refresh()) route();
  } catch { /* 次の操作時にエラーが出る */ }
});

async function boot() {
  ready = false;
  bootError = null;
  const conn = getConnection();
  updateChrome(conn);
  if (!conn) {
    repo = null;
    route();
    return;
  }
  repo = new Repo(makeAdapter(conn));
  route();
  try {
    await repo.init();
    ready = true;
  } catch (e) {
    console.error(e);
    bootError = e;
  }
  route();
}

document.title = APP_NAME;
document.querySelector('.brand').textContent = APP_NAME;
installCoverErrorHandler();
boot();
