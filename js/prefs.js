// 端末ごとの表示設定（テーマ・棚の表示方法）。記録データとは別に、このブラウザだけに保存する。
import { APP_ID } from './config.js';

const KEY = (k) => `${APP_ID}.${k}`;

function get(k, def) {
  try { return localStorage.getItem(KEY(k)) ?? def; } catch { return def; }
}
function set(k, v) {
  try { localStorage.setItem(KEY(k), v); } catch { /* 保存できなくても動作は続ける */ }
}

export const THEMES = { auto: '端末に合わせる', light: '生成り（明るい）', dark: '夜（暗い）' };

export function getTheme() { return get('theme', 'auto'); }

export function applyTheme(pref = getTheme()) {
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePref = pref;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#1b1a18' : '#f5f1e8';
}

export function setTheme(pref) {
  set('theme', pref);
  applyTheme(pref);
}

// 端末の明暗が切り替わったら追従する（「端末に合わせる」のとき）
export function watchSystemTheme() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (getTheme() === 'auto') applyTheme('auto');
  });
}

/** 作品棚の表示：view = shelf | year、density = normal | dense */
export function getShelfView() { return get('shelf.view', 'shelf'); }
export function setShelfView(v) { set('shelf.view', v); }
export function getDensity() { return get('shelf.density', 'normal'); }
export function setDensity(v) { set('shelf.density', v); }
