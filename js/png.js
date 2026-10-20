// 選んだ作品を3列に並べたPNG画像を作る。
// 表紙は crossOrigin で読み込む（TMDB は CORS 対応）。CORS 非対応の画像（Google Books など）は
// 設定で許可されていれば画像変換サービス wsrv.nl を経由して読み込み、だめなら仮表紙を描く。
import { APP_NAME } from './config.js';
import { TYPES } from './model.js';

const W = 1080;
const M = 56; // 外側の余白
const GAP = 28;
const COLS = 3;
const CELL = (W - M * 2 - GAP * (COLS - 1)) / COLS;
const COVER_H = Math.round(CELL * 1.5);
const ROW_GAP = 44;

const C = {
  paper: '#f5f1e8',
  coverBg: '#e8e2d4',
  ink: '#2b2925',
  sub: '#6d675d',
  accent: '#4a6a5c',
  line: '#d9d2c3',
};
const SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", serif';
const SANS = '"Hiragino Sans", "Yu Gothic", "YuGothic", "Noto Sans JP", sans-serif';

const TITLE_FONT = `600 26px ${SERIF}`;
const TITLE_LH = 36;
const SCORE_FONT = `600 24px ${SANS}`;
const SCORE_LH = 36;
const REC_FONT = `22px ${SANS}`;
const REC_LH = 32;
const REC_MAX_LINES = 6;

const PROXY_FREE_HOSTS = ['image.tmdb.org'];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed'));
    img.src = src;
  });
}

export const proxied = (url) => `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=jpg`;

/** CORS 付きで画像を読む。読めなければ（許可があれば）中継経由で再試行。最終的に失敗なら null */
async function loadCover(url, useProxy) {
  try {
    return await loadImage(url);
  } catch { /* 次へ */ }
  let host = '';
  try { host = new URL(url).hostname; } catch { return null; }
  if (!useProxy || PROXY_FREE_HOSTS.includes(host)) return null;
  try {
    return await loadImage(proxied(url));
  } catch {
    return null;
  }
}

const NO_LINE_START = '、。，．,.・：；？！?!ー〜）」』】〉》］}ゃゅょっぁぃぅぇぉャュョッァィゥェォ';

/** 日本語向けの文字単位折り返し。maxLines を超えたら末尾を「…」にする */
export function wrapText(ctx, text, width, maxLines) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of [...para]) {
      if (ctx.measureText(line + ch).width > width && line && NO_LINE_START.includes(ch)) {
        // 句読点や閉じかっこは行頭に置かず、前の行にぶら下げる
        lines.push(line + ch);
        line = '';
      } else if (ctx.measureText(line + ch).width > width && line) {
        lines.push(line);
        line = ch.trim() ? ch : '';
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = [...last].slice(0, -1).join('');
    cut[maxLines - 1] = `${last}…`;
    return cut;
  }
  return lines;
}

function cellTextLayout(ctx, item, o) {
  const parts = [];
  if (o.showWorkTitle) {
    ctx.font = TITLE_FONT;
    const t = item.volume ? `${item.title} ${item.volume}` : item.title;
    parts.push({ kind: 'title', lines: wrapText(ctx, t, CELL, 2) });
  }
  if (o.showScore && item.score !== null && item.score !== undefined) parts.push({ kind: 'score', lines: [`${item.score}点`] });
  if (o.showRecommendation && item.recommendation.trim()) {
    ctx.font = REC_FONT;
    parts.push({ kind: 'rec', lines: wrapText(ctx, item.recommendation.trim(), CELL, REC_MAX_LINES) });
  }
  let h = parts.length ? 14 : 0;
  for (const p of parts) h += p.lines.length * (p.kind === 'title' ? TITLE_LH : p.kind === 'score' ? SCORE_LH : REC_LH) + 4;
  return { parts, height: h };
}

function drawContain(ctx, img, x, y, w, h) {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawPlaceholder(ctx, item, x, y) {
  ctx.fillStyle = '#d8d0bf';
  ctx.fillRect(x + 10, y + 10, CELL - 20, COVER_H - 20);
  ctx.fillStyle = C.sub;
  ctx.font = `20px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(TYPES[item.type] || '', x + CELL / 2, y + 60);
  ctx.fillStyle = C.ink;
  ctx.font = `600 30px ${SERIF}`;
  const lines = wrapText(ctx, item.title, CELL - 60, 5);
  const top = y + COVER_H / 2 - (lines.length * 42) / 2 + 30;
  lines.forEach((l, i) => ctx.fillText(l, x + CELL / 2, top + i * 42));
  ctx.textAlign = 'left';
}

/**
 * imageData: model.buildImageData の結果
 * 戻り値: { blob, failed: [表紙を読み込めなかった作品名], credits: [...] }
 */
export async function renderShelfImage(imageData, { useProxy = true } = {}) {
  const { items, options: o } = imageData;
  if (!items.length) throw new Error('作品を1つ以上選んでください。');
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});

  const covers = await Promise.all(items.map((it) => (it.cover?.url ? loadCover(it.cover.url, useProxy) : Promise.resolve(null))));
  const failed = items.filter((it, i) => it.cover?.url && !covers[i]).map((it) => it.title);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // 高さを先に計算する
  const layouts = items.map((it) => cellTextLayout(ctx, it, o));
  const rows = [];
  for (let i = 0; i < items.length; i += COLS) rows.push(items.slice(i, i + COLS).map((_, j) => i + j));
  let titleLines = [];
  if (imageData.title) {
    ctx.font = `600 44px ${SERIF}`;
    titleLines = wrapText(ctx, imageData.title, W - M * 2, 2);
  }
  const headerH = titleLines.length ? M + titleLines.length * 60 + 24 : M;
  const rowHeights = rows.map((r) => COVER_H + Math.max(...r.map((i) => layouts[i].height)));
  const credits = [...new Set(items.map((it) => it.cover?.credit).filter(Boolean))];
  ctx.font = `18px ${SANS}`;
  const creditLines = wrapText(ctx, credits.join(' ／ '), W - M * 2, 3).filter(Boolean);
  const footerH = 30 + 30 + creditLines.length * 26 + M - 20;
  const H = Math.ceil(headerH + rowHeights.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1) + footerH);

  canvas.width = W;
  canvas.height = H;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  if (titleLines.length) {
    ctx.fillStyle = C.ink;
    ctx.font = `600 44px ${SERIF}`;
    titleLines.forEach((l, i) => ctx.fillText(l, M, M + 44 + i * 60));
  }

  let y = headerH;
  rows.forEach((row, ri) => {
    // 作品数が3の倍数でない最後の行は中央に寄せる
    const rowW = row.length * CELL + (row.length - 1) * GAP;
    let x = M + (W - M * 2 - rowW) / 2;
    for (const i of row) {
      const it = items[i];
      ctx.fillStyle = C.coverBg;
      ctx.fillRect(x, y, CELL, COVER_H);
      if (covers[i]) drawContain(ctx, covers[i], x, y, CELL, COVER_H);
      else drawPlaceholder(ctx, it, x, y);

      let ty = y + COVER_H + 14;
      for (const p of layouts[i].parts) {
        if (p.kind === 'title') { ctx.font = TITLE_FONT; ctx.fillStyle = C.ink; }
        else if (p.kind === 'score') { ctx.font = SCORE_FONT; ctx.fillStyle = C.accent; }
        else { ctx.font = REC_FONT; ctx.fillStyle = C.sub; }
        const lh = p.kind === 'title' ? TITLE_LH : p.kind === 'score' ? SCORE_LH : REC_LH;
        for (const l of p.lines) {
          ty += lh;
          ctx.fillText(l, x, ty - (lh - 26) / 2);
        }
        ty += 4;
      }
      x += CELL + GAP;
    }
    y += rowHeights[ri] + ROW_GAP;
  });

  // フッター：アプリ名と画像の出典
  let fy = H - footerH + 30;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, fy - 10);
  ctx.lineTo(W - M, fy - 10);
  ctx.stroke();
  ctx.fillStyle = C.sub;
  ctx.font = `600 20px ${SERIF}`;
  fy += 26;
  ctx.fillText(APP_NAME, M, fy);
  ctx.font = `18px ${SANS}`;
  for (const l of creditLines) {
    fy += 26;
    ctx.fillText(l, M, fy);
  }

  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした。'))), 'image/png');
    } catch (e) {
      // 外部画像で canvas が汚染された場合（通常は crossOrigin 読み込みで起きない）
      reject(new Error(`画像を書き出せませんでした（${e.message}）。`));
    }
  });
  return { blob, failed, credits, width: W, height: H };
}
