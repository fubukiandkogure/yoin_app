// 画面共通の部品（表紙、ダイアログ、トースト、状態表示）。
import { html, safeUrl } from '../util.js';
import { TYPES_EN, COVER_MISSING } from '../model.js';
import { icon } from './icons.js';
import { isGooglePlaceholder } from '../search/books.js';

// 仮表紙の色（タイトルごとに決まる、落ち着いた色）
const PH_COLORS = ['#3f5468', '#7a3b35', '#3e5a4c', '#8a6d3b', '#5b5560', '#46486b', '#2f4746', '#6b4f3a', '#4f3f55', '#55613a', '#2e3e5c', '#6a3f4f'];
export function placeholderColor(title) {
  let h = 0;
  for (const c of String(title || '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PH_COLORS[h % PH_COLORS.length];
}

/**
 * 表紙。画像の下に仮表紙を置き、画像が読めないときは仮表紙が見える。
 * item: { type, title, cover: {url, missingReason?} }
 */
export function coverHtml(item, { size = '', thumb = false, eager = false } = {}) {
  const url = safeUrl(thumb && item.cover?.thumb ? item.cover.thumb : item.cover?.url);
  const reason = url ? '' : (COVER_MISSING[item.cover?.missingReason] || '画像なし');
  return html`<div class="cover ${size} ${url ? '' : 'no-image'}" data-type="${item.type}">
    <div class="cover-ph" style="--ph:${placeholderColor(item.title)}" aria-hidden="true">
      <span class="ph-type">${TYPES_EN[item.type] || ''}</span>
      <span class="ph-title">${item.title}</span>
      <span class="ph-reason">${reason}</span>
    </div>
    ${url ? html`<img class="cover-img" src="${url}" alt="${item.title}の表紙" loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">` : ''}
  </div>`;
}

// 画像の読み込み失敗を拾って仮表紙に切り替える（CSPでインラインonerrorは使わない）
export function installCoverErrorHandler(root = document) {
  const fail = (img, reason) => {
    const cover = img.closest('.cover');
    if (!cover) return;
    cover.classList.add('no-image', 'failed');
    const r = cover.querySelector('.ph-reason');
    if (r) r.textContent = reason;
    img.remove();
  };
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('cover-img')) fail(img, '画像を読み込めませんでした');
  }, true);
  // Google Books の「image not available」代替画像は表紙として扱わない
  root.addEventListener('load', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('cover-img') && isGooglePlaceholder(img)) fail(img, '提供元に画像がありません');
  }, true);
}

export const scoreText = (score) => (score === null || score === undefined ? '未採点' : `${score}点`);

export function loadingHtml(label = '読み込み中…') {
  return html`<div class="state state-loading" role="status"><span class="spinner" aria-hidden="true"></span>${label}</div>`;
}

export function errorHtml(message, { retry = true } = {}) {
  return html`<div class="state state-error" role="alert">
    <p>${message}</p>
    ${retry ? html`<button type="button" class="btn" data-act="retry">再試行</button>` : ''}
  </div>`;
}

// ---------- トースト ----------

let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.innerHTML = String(html`${icon(kind === 'error' ? 'close' : 'check', { size: 18 })}<span>${message}</span>`);
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 6000 : 2800);
}

// ---------- ダイアログ ----------

/** 確認ダイアログ。buttons: [{label, value, kind}]。閉じたら value（キャンセルは null）を返す */
export function choose(message, buttons, { title = '', cancelLabel = 'キャンセル', className = '' } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `dialog ${className}`;
    dlg.innerHTML = String(html`<div class="dialog-inner">
      ${title ? html`<h2 class="dialog-title">${title}</h2>` : ''}
      <div class="dialog-body">${message}</div>
      <div class="dialog-actions">
        ${buttons.map((b, i) => html`<button type="button" class="btn ${b.kind || ''}" data-i="${i}">${b.label}</button>`)}
        <button type="button" class="btn ghost" data-i="cancel">${cancelLabel}</button>
      </div>
    </div>`);
    document.body.appendChild(dlg);
    // close イベントに頼らず、ボタンを押した時点で結果を返す
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) finish(b.dataset.i === 'cancel' ? null : buttons[Number(b.dataset.i)].value);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('close', () => finish(null));
    dlg.showModal();
  });
}

export async function confirmDialog(message, { okLabel = 'OK', danger = false, title = '' } = {}) {
  const r = await choose(message, [{ label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }], { title });
  return r === true;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
