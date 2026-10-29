// 表紙の色を拾う。作品詳細の背景や背表紙の色に使う。
// 一度調べた色はこの端末に覚えておく（表紙URL → 色）。
import { APP_ID } from './config.js';
import { loadCover } from './png.js';

const KEY = `${APP_ID}.tints`;
const MAX = 800;
let memo = null;
const pending = new Map();

function store() {
  if (!memo) {
    try { memo = new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}'))); } catch { memo = new Map(); }
  }
  return memo;
}

function persist() {
  try {
    const entries = [...store().entries()].slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* 保存できなくても動く */ }
}

/** 覚えている色があればすぐ返す（なければ null） */
export const knownTint = (url) => (url ? store().get(url) || null : null);

/**
 * 表紙の「らしい色」を返す。白や黒に近い画素は控えめに数え、鮮やかな色を少し重く見る。
 * 読み込めない（CORS 不可で中継も使えない）ときは null。
 */
export function getTint(url, { useProxy = true } = {}) {
  if (!url) return Promise.resolve(null);
  const known = knownTint(url);
  if (known) return Promise.resolve(known);
  if (pending.has(url)) return pending.get(url);
  const p = (async () => {
    const img = await loadCover(url, useProxy);
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 36;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 24, 36);
    let data;
    try { data = ctx.getImageData(0, 0, 24, 36).data; } catch { return null; }
    let r = 0; let g = 0; let b = 0; let wsum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i]; const G = data[i + 1]; const B = data[i + 2];
      const max = Math.max(R, G, B); const min = Math.min(R, G, B);
      const light = (max + min) / 510;
      const sat = max === 0 ? 0 : (max - min) / max;
      const w = 0.15 + sat * 1.6 + (light > 0.92 || light < 0.06 ? -0.12 : 0);
      if (w <= 0) continue;
      r += R * w; g += G * w; b += B * w; wsum += w;
    }
    if (!wsum) return null;
    const tint = `rgb(${Math.round(r / wsum)}, ${Math.round(g / wsum)}, ${Math.round(b / wsum)})`;
    store().set(url, tint);
    persist();
    return tint;
  })().catch(() => null).finally(() => pending.delete(url));
  pending.set(url, p);
  return p;
}

/** 色の明るさ（0〜1）。文字色を白にするか黒にするかの判定に使う */
export function luminance(rgb) {
  const m = String(rgb).match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return 0.5;
  const [r, g, b] = m.slice(1).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** たくさんの表紙の色を、同時に読み込みすぎないよう順番に調べる */
export async function tintAll(urls, onTint, { useProxy = true, concurrency = 3 } = {}) {
  const queue = [...new Set(urls.filter((u) => u && !knownTint(u)))];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      const t = await getTint(u, { useProxy });
      if (t) onTint(u, t);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}
