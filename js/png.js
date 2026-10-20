// 選んだ作品を3列に並べたPNG画像を作る。
// レイアウト：tall（縦長・作品名／点数／おすすめの一言）、square（正方形・表紙を大きく）
// テーマ：paper（生成り）、night（夜）
// 表紙は crossOrigin で読み込む（TMDB は CORS 対応）。CORS 非対応の画像（Google Books など）は
// 設定で許可されていれば画像変換サービス wsrv.nl を経由して読み込み、だめなら仮表紙を描く。
import { APP_NAME } from './config.js';
import { TYPES } from './model.js';
import { placeholderColor } from './ui/components.js';

const W = 1080;
const COLS = 3;

const THEMES = {
  paper: { bg: '#f5f1e8', ink: '#2a2824', sub: '#6b655b', faint: '#9a9386', accent: '#46685a', line: '#d9d2c3', plankTop: '#dacfb9', plank: '#c6b79b', plankShadow: 'rgba(80,60,30,.22)', coverShadow: 'rgba(30,25,15,.35)' },
  night: { bg: '#1b1a18', ink: '#ece6da', sub: '#b0a899', faint: '#847d71', accent: '#8db3a2', line: '#3a3833', plankTop: '#4c4237', plank: '#382f26', plankShadow: 'rgba(0,0,0,.5)', coverShadow: 'rgba(0,0,0,.65)' },
};
const SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", serif';
const SANS = '"Hiragino Sans", "Yu Gothic", "YuGothic", "Noto Sans JP", sans-serif';

const PROXY_FREE_HOSTS = ['image.tmdb.org'];
const NO_LINE_START = '、。，．,.・：；？！?!ー〜）」』】〉》］}ゃゅょっぁぃぅぇぉャュョッァィゥェォ';

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
  // 画面表示で読み込んだ（CORSヘッダーなしの）キャッシュを使わないよう、別のURLとして読み込む。
  // TMDB は Origin なしのリクエストに CORS ヘッダーを返さず、そのキャッシュが使われると書き出しに失敗するため。
  try {
    return await loadImage(`${url}${url.includes('?') ? '&' : '?'}yoin_export=1`);
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

/** 日本語向けの文字単位折り返し（句読点は行頭に置かない）。maxLines を超えたら末尾を「…」にする */
export function wrapText(ctx, text, width, maxLines) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of [...para]) {
      const over = ctx.measureText(line + ch).width > width && line;
      if (over && NO_LINE_START.includes(ch)) {
        lines.push(line + ch);
        line = '';
      } else if (over) {
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

/** 表紙をセルの下端にそろえて描く（棚板の上に立っているように）。影付き */
function drawCover(ctx, t, item, img, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = t.coverShadow;
  ctx.shadowBlur = Math.round(w * 0.05);
  ctx.shadowOffsetY = Math.round(w * 0.015);
  if (img) {
    const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + h - dh, dw, dh);
    ctx.restore();
    return;
  }
  // 仮表紙：アプリと同じ色・意匠。実際の表紙と同じ 2:3 にして下端にそろえる
  const ph = Math.min(h, w * 1.5);
  y += h - ph;
  h = ph;
  ctx.fillStyle = placeholderColor(item.title);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(255,255,255,.08)');
  g.addColorStop(1, 'rgba(0,0,0,.25)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(244,239,229,.35)';
  ctx.lineWidth = Math.max(1, w * 0.005);
  const inset = w * 0.07;
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.fillStyle = 'rgba(244,239,229,.75)';
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(w * 0.055)}px ${SANS}`;
  ctx.fillText(TYPES[item.type] || '', x + w / 2, y + inset + w * 0.12);
  ctx.fillStyle = '#f4efe5';
  const fs = Math.round(w * 0.095);
  ctx.font = `600 ${fs}px ${SERIF}`;
  const lines = wrapText(ctx, item.title, w - inset * 2 - w * 0.08, 5);
  const lh = fs * 1.45;
  const top = y + h / 2 - (lines.length * lh) / 2 + fs * 0.8;
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, top + i * lh));
  ctx.textAlign = 'left';
}

function drawPlank(ctx, t, x, y, w, thick) {
  ctx.save();
  ctx.shadowColor = t.plankShadow;
  ctx.shadowBlur = thick * 1.2;
  ctx.shadowOffsetY = thick * 0.5;
  const g = ctx.createLinearGradient(0, y, 0, y + thick);
  g.addColorStop(0, t.plankTop);
  g.addColorStop(1, t.plank);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, thick);
  ctx.restore();
}

function drawFooter(ctx, t, credits, M, y) {
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(W - M, y);
  ctx.stroke();
  ctx.fillStyle = t.sub;
  ctx.font = `600 22px ${SERIF}`;
  ctx.fillText(APP_NAME, M, y + 36);
  ctx.fillStyle = t.faint;
  ctx.font = `17px ${SANS}`;
  const lines = wrapText(ctx, credits.join(' ／ '), W - M * 2 - 90, 2).filter(Boolean);
  ctx.textAlign = 'right';
  lines.forEach((l, i) => ctx.fillText(l, W - M, y + 34 + i * 24));
  ctx.textAlign = 'left';
}
const footerHeight = (credits) => 56 + (credits.length > 2 ? 24 : 0);

// ---------- 縦長（文字あり） ----------

function layoutTall(ctx, data, t) {
  const M = 60;
  const GAP = 30;
  const CELL = (W - M * 2 - GAP * (COLS - 1)) / COLS;
  const COVER_H = Math.round(CELL * 1.5);
  const PLANK = 12;
  const o = data.options;
  const TITLE = { font: `600 26px ${SERIF}`, lh: 36 };
  const SCORE = { font: `700 25px ${SERIF}`, lh: 36 };
  const REC = { font: `22px ${SANS}`, lh: 33 };

  const textOf = (it) => {
    const parts = [];
    if (o.showWorkTitle) {
      ctx.font = TITLE.font;
      parts.push({ s: TITLE, color: t.ink, lines: wrapText(ctx, it.volume ? `${it.title} ${it.volume}` : it.title, CELL, 2) });
    }
    if (o.showScore && it.score !== null && it.score !== undefined) parts.push({ s: SCORE, color: t.accent, lines: [`${it.score}点`] });
    if (o.showRecommendation && it.recommendation.trim()) {
      ctx.font = REC.font;
      parts.push({ s: REC, color: t.sub, lines: wrapText(ctx, it.recommendation.trim(), CELL, 6) });
    }
    const h = parts.length ? 16 + parts.reduce((a, p) => a + p.lines.length * p.s.lh + 4, 0) : 0;
    return { parts, h };
  };

  const layouts = data.items.map(textOf);
  const rows = [];
  for (let i = 0; i < data.items.length; i += COLS) rows.push(data.items.slice(i, i + COLS).map((_, j) => i + j));
  let titleLines = [];
  if (data.title) {
    ctx.font = `600 46px ${SERIF}`;
    titleLines = wrapText(ctx, data.title, W - M * 2, 2);
  }
  const headerH = titleLines.length ? M + 24 + titleLines.length * 62 + 34 : M + 10;
  const rowHeights = rows.map((r) => COVER_H + PLANK + Math.max(...r.map((i) => layouts[i].h)));
  const ROW_GAP = 46;
  const footerY = headerH + rowHeights.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1) + 28;
  const H = Math.ceil(footerY + footerHeight(data.credits) + 36);

  return {
    H,
    draw(covers) {
      if (titleLines.length) {
        ctx.fillStyle = t.accent;
        ctx.font = `600 18px ${SANS}`;
        ctx.fillText(APP_NAME, M, M + 6);
        ctx.fillStyle = t.ink;
        ctx.font = `600 46px ${SERIF}`;
        titleLines.forEach((l, i) => ctx.fillText(l, M, M + 24 + 46 + i * 62));
      }
      let y = headerH;
      rows.forEach((row, ri) => {
        const rowW = row.length * CELL + (row.length - 1) * GAP;
        const x0 = M + (W - M * 2 - rowW) / 2;
        drawPlank(ctx, t, x0 - 18, y + COVER_H, rowW + 36, PLANK);
        row.forEach((i, k) => {
          const x = x0 + k * (CELL + GAP);
          const pad = CELL * 0.04;
          drawCover(ctx, t, data.items[i], covers[i], x + pad, y, CELL - pad * 2, COVER_H);
          let ty = y + COVER_H + PLANK + 16;
          for (const p of layouts[i].parts) {
            ctx.font = p.s.font;
            ctx.fillStyle = p.color;
            for (const l of p.lines) {
              ty += p.s.lh;
              ctx.fillText(l, x, ty - (p.s.lh - 26) / 2);
            }
            ty += 4;
          }
        });
        y += rowHeights[ri] + ROW_GAP;
      });
      drawFooter(ctx, t, data.credits, M, footerY);
    },
  };
}

// ---------- 正方形（表紙中心） ----------

function layoutSquare(ctx, data, t) {
  const H = W;
  const M = 64;
  const o = data.options;
  const rows = Math.ceil(data.items.length / COLS);
  let titleLines = [];
  if (data.title) {
    ctx.font = `600 40px ${SERIF}`;
    titleLines = wrapText(ctx, data.title, W - M * 2, 1);
  }
  const top = titleLines.length ? M + 64 : M;
  const footerH = footerHeight(data.credits) + 34;
  const caption = o.showWorkTitle || o.showScore ? (rows >= 3 ? 32 : 38) : 0;
  const PLANK = 10;
  const GAP_X = 34;
  const ROW_GAP = rows >= 3 ? 18 : 30;
  const availH = H - top - footerH - M / 2;
  const cellByW = (W - M * 2 - GAP_X * (COLS - 1)) / COLS;
  const cellByH = ((availH - ROW_GAP * (rows - 1)) / rows - PLANK - caption) / 1.5;
  const CELL = Math.min(cellByW, cellByH);
  const COVER_H = CELL * 1.5;
  const rowH = COVER_H + PLANK + caption;
  const gridH = rows * rowH + (rows - 1) * ROW_GAP;
  const y0 = top + (availH - gridH) / 2;

  return {
    H,
    draw(covers) {
      if (titleLines.length) {
        ctx.fillStyle = t.ink;
        ctx.font = `600 40px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.fillText(titleLines[0], W / 2, M + 30);
        ctx.textAlign = 'left';
      }
      for (let r = 0; r < rows; r++) {
        const idx = data.items.slice(r * COLS, r * COLS + COLS).map((_, k) => r * COLS + k);
        const rowW = idx.length * CELL + (idx.length - 1) * GAP_X;
        const x0 = (W - rowW) / 2;
        const y = y0 + r * (rowH + ROW_GAP);
        drawPlank(ctx, t, x0 - 18, y + COVER_H, rowW + 36, PLANK);
        idx.forEach((i, k) => {
          const x = x0 + k * (CELL + GAP_X);
          const it = data.items[i];
          drawCover(ctx, t, it, covers[i], x, y, CELL, COVER_H);
          if (caption) {
            const score = o.showScore && it.score !== null && it.score !== undefined ? `${it.score}` : '';
            ctx.font = `700 22px ${SERIF}`;
            const sw = score ? ctx.measureText(score).width + 10 : 0;
            if (o.showWorkTitle) {
              ctx.font = `600 20px ${SERIF}`;
              ctx.fillStyle = t.ink;
              ctx.fillText(wrapText(ctx, it.title, CELL - sw, 1)[0], x, y + COVER_H + PLANK + 28);
            }
            if (score) {
              ctx.font = `700 22px ${SERIF}`;
              ctx.fillStyle = t.accent;
              ctx.textAlign = 'right';
              ctx.fillText(score, x + CELL, y + COVER_H + PLANK + 28);
              ctx.textAlign = 'left';
            }
          }
        });
      }
      drawFooter(ctx, t, data.credits, M, H - footerH);
    },
  };
}

/**
 * imageData: model.buildImageData の結果
 * 戻り値: { blob, failed: [表紙を読み込めなかった作品名], credits, width, height }
 */
export async function renderShelfImage(imageData, { useProxy = true } = {}) {
  if (!imageData.items.length) throw new Error('作品を1つ以上選んでください。');
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const t = THEMES[imageData.options.theme] || THEMES.paper;
  const credits = [...new Set(imageData.items.map((it) => it.cover?.credit).filter(Boolean))];
  const data = { ...imageData, credits };

  const covers = await Promise.all(data.items.map((it) => (it.cover?.url ? loadCover(it.cover.url, useProxy) : Promise.resolve(null))));
  const failed = data.items.filter((it, i) => it.cover?.url && !covers[i]).map((it) => it.title);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const layout = (data.options.layout === 'square' ? layoutSquare : layoutTall)(ctx, data, t);
  canvas.width = W;
  canvas.height = layout.H;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, layout.H);
  ctx.textBaseline = 'alphabetic';
  layout.draw(covers);

  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした。'))), 'image/png');
    } catch (e) {
      // 外部画像で canvas が汚染された場合（通常は crossOrigin 読み込みで起きない）
      reject(new Error(`画像を書き出せませんでした（${e.message}）。`));
    }
  });
  return { blob, failed, credits, width: W, height: layout.H };
}
