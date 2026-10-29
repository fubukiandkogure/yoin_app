// 共有用のPNG画像を作る（アプリから外へは何も送らない。端末で描いて保存・送信する）。
// - renderShelfImage：選んだ1〜9作品。tall（縦長・作品名／点数／おすすめの一言）、square（正方形・表紙中心）
// - renderWorkCard：1作品のカード（4:5）。表紙の色を背景に敷く
// - renderYearPoster：1年分の表紙を並べたポスター（4:5）
// 表紙は crossOrigin で読み込む（TMDB は CORS 対応）。CORS 非対応の画像（Google Books など）は
// 設定で許可されていれば画像変換サービス wsrv.nl を経由して読み込み、だめなら仮表紙を描く。
import { APP_NAME } from './config.js';
import { TYPES_EN } from './model.js';
import { placeholderColor } from './ui/components.js';
import { isGooglePlaceholderSize } from './search/books.js';

const W = 1080;
const COLS = 3;

const THEMES = {
  paper: { bg: '#f1ede4', ink: '#161513', sub: '#5e5950', faint: '#9a9488', accent: '#e0462a', line: '#cfc7b6', coverShadow: 'rgba(22,21,19,.38)', grain: 'multiply' },
  night: { bg: '#11100f', ink: '#efe9de', sub: '#aaa293', faint: '#757065', accent: '#ff6a48', line: '#34322d', coverShadow: 'rgba(0,0,0,.75)', grain: 'screen' },
};
const JP = '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
const DISPLAY = '"Instrument Serif", "Times New Roman", serif';
const MONO = '"DM Mono", ui-monospace, Menlo, monospace';

const PROXY_FREE_HOSTS = ['image.tmdb.org'];
// CORS ヘッダーを返さないことが分かっている配信元は、直接読まずに最初から中継を使う
const NO_CORS_HOSTS = ['books.google.com', 'books.googleusercontent.com'];
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
export async function loadCover(url, useProxy) {
  // 画面表示で読み込んだ（CORSヘッダーなしの）キャッシュを使わないよう、別のURLとして読み込む。
  // TMDB は Origin なしのリクエストに CORS ヘッダーを返さず、そのキャッシュが使われると書き出しに失敗するため。
  let host = '';
  try { host = new URL(url).hostname; } catch { return null; }
  if (!NO_CORS_HOSTS.includes(host)) {
    try {
      return await loadImage(`${url}${url.includes('?') ? '&' : '?'}yoin_export=1`);
    } catch { /* 次へ */ }
  }
  if (!useProxy || PROXY_FREE_HOSTS.includes(host)) return null;
  try {
    const img = await loadImage(proxied(url));
    return isGooglePlaceholderSize(url, img.naturalWidth, img.naturalHeight) ? null : img;
  } catch {
    return null;
  }
}

/** 使う書体を、実際に描く文字の分だけ先に読み込む（和文フォントは文字ごとに分割配信されるため） */
async function ensureFonts(texts) {
  if (!document.fonts?.load) return;
  const sample = texts.filter(Boolean).join('').slice(0, 4000) || 'あ';
  await Promise.all([
    document.fonts.load(`900 40px "Zen Kaku Gothic New"`, sample),
    document.fonts.load(`700 40px "Zen Kaku Gothic New"`, sample),
    document.fonts.load(`400 40px "Zen Kaku Gothic New"`, sample),
    document.fonts.load(`italic 40px "Instrument Serif"`, '0123456789/AaBbYyZz'),
    document.fonts.load(`40px "Instrument Serif"`, '0123456789'),
    document.fonts.load(`400 20px "DM Mono"`, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.—·/'),
  ].map((p) => p.catch(() => {})));
  await document.fonts.ready.catch(() => {});
}

// 日本語を単語（文節に近い単位）で区切る。使えない環境では1文字ずつ
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
function segments(text) {
  if (!segmenter) return [...text];
  // 助詞・助動詞などの短いひらがな（「で」「た」「の」など）は前の語にくっつけて、文節に近い単位にする
  const out = [];
  for (const { segment } of segmenter.segment(text)) {
    if (out.length && /^[぀-ゟー]{1,2}$/.test(segment) && !/\s$/.test(out[out.length - 1])) out[out.length - 1] += segment;
    else out.push(segment);
  }
  return out;
}

/**
 * 日本語向けの折り返し。単語の途中ではなるべく改行せず、句読点は行頭に置かない。
 * 1単語が1行に入りきらないときだけ文字単位で折る。maxLines を超えたら末尾を「…」にする
 */
export function wrapText(ctx, text, width, maxLines) {
  const lines = [];
  const fits = (s) => ctx.measureText(s).width <= width;
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const seg of segments(para)) {
      if (fits(line + seg)) { line += seg; continue; }
      // 句読点などは前の行にぶら下げる
      if (line && [...seg].every((c) => NO_LINE_START.includes(c))) { lines.push(line + seg); line = ''; continue; }
      if (line) { lines.push(line); line = ''; }
      const t = seg.replace(/^\s+/, '');
      if (fits(t)) { line = t; continue; }
      for (const ch of [...t]) {
        if (!fits(line + ch) && line) {
          if (NO_LINE_START.includes(ch)) { lines.push(line + ch); line = ''; continue; }
          lines.push(line);
          line = ch;
        } else {
          line += ch;
        }
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

// ---------- 共通の部品 ----------

let noiseTile = null;
function grain(ctx, t, w, h, alpha = 0.06) {
  if (!noiseTile) {
    noiseTile = document.createElement('canvas');
    noiseTile.width = noiseTile.height = 160;
    const n = noiseTile.getContext('2d');
    const img = n.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    n.putImageData(img, 0, 0);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = t.grain;
  ctx.fillStyle = ctx.createPattern(noiseTile, 'repeat');
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** ロゴ：朱の点と、右へ広がる2本の弧（余韻＝響きが残るさま） */
function drawMark(ctx, t, x, y, size) {
  const s = size / 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = t.accent;
  ctx.beginPath();
  ctx.arc(12, 20, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = t.ink;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(12, 20, 10.5, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(12, 20, 17, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.restore();
}

function drawLogo(ctx, t, x, y, scale = 1) {
  drawMark(ctx, t, x, y - 26 * scale, 36 * scale);
  ctx.fillStyle = t.ink;
  ctx.font = `900 ${Math.round(26 * scale)}px ${JP}`;
  ctx.fillText(APP_NAME, x + 40 * scale, y);
  const w = ctx.measureText(APP_NAME).width;
  ctx.fillStyle = t.sub;
  ctx.font = `italic ${Math.round(24 * scale)}px ${DISPLAY}`;
  ctx.fillText('yoin', x + 46 * scale + w, y);
}

function spaced(ctx, text, x, y, spacing, align = 'left') {
  // canvas の letterSpacing が使えない環境向けに、1文字ずつ置く
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
  return total;
}

function mono(ctx, t, text, x, y, { size = 17, color = t.sub, align = 'left', spacing = 2.4 } = {}) {
  ctx.fillStyle = color;
  ctx.font = `400 ${size}px ${MONO}`;
  return spaced(ctx, String(text).toUpperCase(), x, y, spacing, align);
}

/** 表紙をセルの下端にそろえて描く。影付き。画像がなければアプリと同じ意匠の仮表紙 */
function drawCover(ctx, t, item, img, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = t.coverShadow;
  ctx.shadowBlur = Math.round(w * 0.07);
  ctx.shadowOffsetY = Math.round(w * 0.025);
  if (img) {
    const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + h - dh, dw, dh);
    ctx.restore();
    return;
  }
  const ph = Math.min(h, w * 1.5);
  y += h - ph;
  h = ph;
  ctx.fillStyle = placeholderColor(item.title);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  if (item.type === 'book') {
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(x, y, w * 0.06, h);
  } else {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.3)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = 'rgba(244,239,229,.45)';
  ctx.fillRect(x + w * 0.1, y + h * 0.07, w * 0.8, Math.max(1, w * 0.004));
  ctx.fillStyle = 'rgba(244,239,229,.75)';
  ctx.font = `400 ${Math.round(w * 0.05)}px ${MONO}`;
  spaced(ctx, TYPES_EN[item.type].toUpperCase(), x + w * 0.1, y + h * 0.16, w * 0.012);
  ctx.fillStyle = '#f4efe5';
  const fs = Math.round(w * 0.105);
  ctx.font = `900 ${fs}px ${JP}`;
  const lines = wrapText(ctx, item.title, w * 0.8, 5);
  const lh = fs * 1.32;
  const bottom = y + h * 0.84;
  lines.forEach((l, i) => ctx.fillText(l, x + w * 0.1, bottom - (lines.length - 1 - i) * lh));
  ctx.fillStyle = t.accent;
  ctx.beginPath();
  ctx.arc(x + w * 0.88, y + h * 0.92, Math.max(2.5, w * 0.022), 0, Math.PI * 2);
  ctx.fill();
}

function drawLedge(ctx, t, x, y, w) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = t.ink;
  ctx.fillRect(x, y, w, 3);
  ctx.restore();
}

function drawFooter(ctx, t, credits, M, y) {
  ctx.fillStyle = t.line;
  ctx.fillRect(M, y, W - M * 2, 1.5);
  drawLogo(ctx, t, M, y + 52, 0.95);
  ctx.fillStyle = t.faint;
  ctx.font = `400 15px ${MONO}`;
  const lines = wrapText(ctx, credits.join(' / '), W - M * 2 - 260, 2).filter(Boolean);
  ctx.textAlign = 'right';
  lines.forEach((l, i) => ctx.fillText(l, W - M, y + 38 + i * 22));
  ctx.textAlign = 'left';
}
const FOOTER_H = 84;

async function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした。'))), 'image/png');
    } catch (e) {
      reject(new Error(`画像を書き出せませんでした（${e.message}）。`));
    }
  });
}

async function loadAll(items, useProxy) {
  const covers = await Promise.all(items.map((it) => (it.cover?.url ? loadCover(it.cover.url, useProxy) : Promise.resolve(null))));
  const failed = items.filter((it, i) => it.cover?.url && !covers[i]).map((it) => it.title);
  return { covers, failed };
}

// ---------- 選んだ作品（縦長） ----------

function layoutTall(ctx, data, t) {
  const M = 64;
  const GAP = 32;
  const CELL = (W - M * 2 - GAP * (COLS - 1)) / COLS;
  const COVER_H = Math.round(CELL * 1.5);
  const o = data.options;
  const TITLE = { font: `700 25px ${JP}`, lh: 36 };
  const REC = { font: `400 21px ${JP}`, lh: 34 };

  const textOf = (it) => {
    let h = 22;
    const parts = {};
    if (o.showWorkTitle) {
      let reserve = 0;
      if (o.showScore && it.score !== null && it.score !== undefined) {
        ctx.font = `italic 46px ${DISPLAY}`;
        reserve = ctx.measureText(String(it.score)).width + 14;
      }
      ctx.font = TITLE.font;
      parts.title = wrapText(ctx, it.volume ? `${it.title} ${it.volume}` : it.title, CELL - reserve, 2);
      h += parts.title.length * TITLE.lh;
    }
    if (o.showRecommendation && it.recommendation.trim()) {
      ctx.font = REC.font;
      parts.rec = wrapText(ctx, it.recommendation.trim(), CELL, 6);
      h += 12 + parts.rec.length * REC.lh;
    }
    return { parts, h: o.showWorkTitle || o.showScore || parts.rec ? h + 6 : 0 };
  };

  const layouts = data.items.map(textOf);
  const rows = [];
  for (let i = 0; i < data.items.length; i += COLS) rows.push(data.items.slice(i, i + COLS).map((_, j) => i + j));
  let titleLines = [];
  if (data.title) {
    ctx.font = `900 58px ${JP}`;
    titleLines = wrapText(ctx, data.title, W - M * 2 - 40, 2);
  }
  const headerH = M + 36 + (titleLines.length ? titleLines.length * 74 + 18 : 0) + 22;
  const rowHeights = rows.map((r) => COVER_H + 3 + Math.max(...r.map((i) => layouts[i].h)));
  const ROW_GAP = 52;
  const footerY = headerH + rowHeights.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1) + 30;
  const H = Math.ceil(footerY + FOOTER_H + 24);

  return {
    H,
    draw(covers) {
      mono(ctx, t, `${data.items.length} selected works — a private archive`, M, M + 10, { size: 16 });
      drawMark(ctx, t, W - M - 40, M - 18, 44);
      if (titleLines.length) {
        ctx.fillStyle = t.ink;
        ctx.font = `900 58px ${JP}`;
        titleLines.forEach((l, i) => ctx.fillText(l, M - 2, M + 36 + 58 + i * 74));
      }
      let y = headerH;
      let n = 0;
      rows.forEach((row, ri) => {
        const rowW = row.length * CELL + (row.length - 1) * GAP;
        const x0 = M + (W - M * 2 - rowW) / 2;
        drawLedge(ctx, t, x0 - 16, y + COVER_H, rowW + 32);
        row.forEach((i, k) => {
          const it = data.items[i];
          const x = x0 + k * (CELL + GAP);
          const pad = CELL * 0.05;
          drawCover(ctx, t, it, covers[i], x + pad, y, CELL - pad * 2, COVER_H - 2);
          n++;
          let ty = y + COVER_H + 3 + 22;
          ctx.fillStyle = t.accent;
          ctx.font = `italic 22px ${DISPLAY}`;
          ctx.fillText(String(n).padStart(2, '0'), x, ty + 6);
          if (o.showScore && it.score !== null && it.score !== undefined) {
            ctx.fillStyle = t.ink;
            ctx.font = `italic 46px ${DISPLAY}`;
            ctx.textAlign = 'right';
            ctx.fillText(String(it.score), x + CELL, ty + 30);
            ctx.textAlign = 'left';
          }
          const p = layouts[i].parts;
          if (p.title) {
            ctx.fillStyle = t.ink;
            ctx.font = TITLE.font;
            p.title.forEach((l) => { ty += TITLE.lh; ctx.fillText(l, x, ty); });
          }
          if (p.rec) {
            ty += 12;
            ctx.fillStyle = t.sub;
            ctx.font = REC.font;
            p.rec.forEach((l) => { ty += REC.lh; ctx.fillText(l, x, ty); });
          }
        });
        y += rowHeights[ri] + ROW_GAP;
      });
      drawFooter(ctx, t, data.credits, M, footerY);
    },
  };
}

// ---------- 選んだ作品（正方形） ----------

function layoutSquare(ctx, data, t) {
  const H = W;
  const M = 64;
  const o = data.options;
  const rows = Math.ceil(data.items.length / COLS);
  let titleLine = '';
  if (data.title) {
    ctx.font = `900 40px ${JP}`;
    titleLine = wrapText(ctx, data.title, W - M * 2 - 80, 1)[0];
  }
  const top = M + (titleLine ? 70 : 30);
  const caption = o.showWorkTitle || o.showScore ? (rows >= 3 ? 32 : 40) : 0;
  const GAP_X = 34;
  const ROW_GAP = rows >= 3 ? 20 : 34;
  const availH = H - top - FOOTER_H - 28;
  const cellByW = (W - M * 2 - GAP_X * (COLS - 1)) / COLS;
  const cellByH = ((availH - ROW_GAP * (rows - 1)) / rows - 3 - caption) / 1.5;
  const CELL = Math.min(cellByW, cellByH);
  const COVER_H = CELL * 1.5;
  const rowH = COVER_H + 3 + caption;
  const gridH = rows * rowH + (rows - 1) * ROW_GAP;
  const y0 = top + (availH - gridH) / 2;

  return {
    H,
    draw(covers) {
      mono(ctx, t, `${data.items.length} selected works`, M, M + 4, { size: 15 });
      drawMark(ctx, t, W - M - 36, M - 24, 40);
      if (titleLine) {
        ctx.fillStyle = t.ink;
        ctx.font = `900 40px ${JP}`;
        ctx.fillText(titleLine, M, M + 56);
      }
      for (let r = 0; r < rows; r++) {
        const idx = data.items.slice(r * COLS, r * COLS + COLS).map((_, k) => r * COLS + k);
        const rowW = idx.length * CELL + (idx.length - 1) * GAP_X;
        const x0 = (W - rowW) / 2;
        const y = y0 + r * (rowH + ROW_GAP);
        drawLedge(ctx, t, x0 - 16, y + COVER_H, rowW + 32);
        idx.forEach((i, k) => {
          const x = x0 + k * (CELL + GAP_X);
          const it = data.items[i];
          drawCover(ctx, t, it, covers[i], x, y, CELL, COVER_H - 2);
          if (!caption) return;
          const cy = y + COVER_H + 3 + caption - 10;
          const score = o.showScore && it.score !== null && it.score !== undefined ? `${it.score}` : '';
          ctx.font = `italic 28px ${DISPLAY}`;
          const sw = score ? ctx.measureText(score).width + 10 : 0;
          if (o.showWorkTitle) {
            ctx.font = `700 ${rows >= 3 ? 17 : 19}px ${JP}`;
            ctx.fillStyle = t.ink;
            ctx.fillText(wrapText(ctx, it.title, CELL - sw, 1)[0], x, cy);
          }
          if (score) {
            ctx.font = `italic 28px ${DISPLAY}`;
            ctx.fillStyle = t.ink;
            ctx.textAlign = 'right';
            ctx.fillText(score, x + CELL, cy + 2);
            ctx.textAlign = 'left';
          }
        });
      }
      drawFooter(ctx, t, data.credits, M, H - FOOTER_H - 20);
    },
  };
}

/**
 * imageData: model.buildImageData の結果
 * 戻り値: { blob, failed: [表紙を読み込めなかった作品名], credits, width, height }
 */
export async function renderShelfImage(imageData, { useProxy = true } = {}) {
  if (!imageData.items.length) throw new Error('作品を1つ以上選んでください。');
  const t = THEMES[imageData.options.theme] || THEMES.paper;
  const credits = [...new Set(imageData.items.map((it) => it.cover?.credit).filter(Boolean))];
  const data = { ...imageData, credits };
  await ensureFonts([data.title, ...data.items.map((it) => `${it.title}${it.volume}${it.recommendation}`)]);
  const { covers, failed } = await loadAll(data.items, useProxy);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const layout = (data.options.layout === 'square' ? layoutSquare : layoutTall)(ctx, data, t);
  canvas.width = W;
  canvas.height = layout.H;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, layout.H);
  grain(ctx, t, W, layout.H);
  ctx.textBaseline = 'alphabetic';
  layout.draw(covers);
  return { blob: await toBlob(canvas), failed, credits, width: W, height: layout.H };
}

// ---------- 1作品のカード ----------

/**
 * card: { type, title, volume, creator, year, cover, score, line, no, tint }
 * line は共有のときだけ入力する一言（保存されない）。自分用の感想は渡さないこと。
 */
export async function renderWorkCard(card, { useProxy = true, theme = 'paper' } = {}) {
  const t = THEMES[theme] || THEMES.paper;
  const H = 1350;
  const M = 72;
  await ensureFonts([card.title, card.volume, card.creator, card.line]);
  const [img] = (await loadAll([card], useProxy)).covers;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  // 表紙の色を上半分に敷く
  const tint = card.tint || placeholderColor(card.title);
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.72);
  g.addColorStop(0, tint);
  g.addColorStop(1, t.bg);
  ctx.globalAlpha = theme === 'night' ? 0.55 : 0.7;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.72);
  ctx.globalAlpha = 1;
  grain(ctx, t, W, H, 0.07);

  mono(ctx, t, `${card.no || ''}${card.no ? ' — ' : ''}${TYPES_EN[card.type]}${card.year ? ` — ${card.year}` : ''}`, M, M + 8, { size: 17, color: t.ink });
  drawMark(ctx, t, W - M - 40, M - 22, 46);

  const cw = 430;
  const ch = 645;
  drawCover(ctx, t, card, img, (W - cw) / 2, M + 60, cw, ch);

  let y = M + 60 + ch + 92;
  ctx.fillStyle = t.ink;
  ctx.font = `900 60px ${JP}`;
  const title = card.volume ? `${card.title} ${card.volume}` : card.title;
  const tl = wrapText(ctx, title, W - M * 2 - (card.score != null ? 190 : 0), 2);
  tl.forEach((l, i) => ctx.fillText(l, M, y + i * 74));
  if (card.score != null) {
    ctx.font = `italic 150px ${DISPLAY}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(card.score), W - M, y + 26);
    ctx.textAlign = 'left';
    mono(ctx, t, '/100', W - M, y + 62, { size: 15, align: 'right' });
  }
  y += (tl.length - 1) * 74 + 50;
  if (card.creator) {
    ctx.fillStyle = t.sub;
    ctx.font = `500 26px ${JP}`;
    ctx.fillText(wrapText(ctx, card.creator, W - M * 2 - 190, 1)[0], M, y);
    y += 26;
  }
  if (card.line) {
    y += 46;
    ctx.fillStyle = t.accent;
    ctx.font = `italic 96px ${DISPLAY}`;
    ctx.fillText('“', M - 6, y + 40);
    ctx.fillStyle = t.ink;
    ctx.font = `500 30px ${JP}`;
    wrapText(ctx, card.line, W - M * 2 - 50, 3).forEach((l, i) => ctx.fillText(l, M + 50, y + i * 46));
  }
  drawFooter(ctx, t, card.cover?.credit ? [card.cover.credit] : [], M, H - FOOTER_H - 26);
  return { blob: await toBlob(canvas), failed: card.cover?.url && !img ? [card.title] : [], width: W, height: H };
}

// ---------- 1年のポスター ----------

/** poster: { year, items: [{type,title,volume,cover}], counts: {movie,book,anime} } */
export async function renderYearPoster(poster, { useProxy = true, theme = 'night' } = {}) {
  const t = THEMES[theme] || THEMES.night;
  const H = 1350;
  const M = 64;
  const items = poster.items.slice(0, 60);
  await ensureFonts([String(poster.year), ...items.map((it) => it.title)]);
  const { covers, failed } = await loadAll(items, useProxy);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, t, W, H, 0.06);

  mono(ctx, t, `My year in ${APP_NAME === '余韻' ? 'yoin' : APP_NAME}`, M, M + 6, { size: 17 });
  drawMark(ctx, t, W - M - 40, M - 22, 46);
  ctx.fillStyle = t.ink;
  ctx.font = `italic 250px ${DISPLAY}`;
  ctx.fillText(String(poster.year), M - 10, M + 220);
  const c = poster.counts;
  const parts = [['Film', c.movie], ['Book', c.book], ['Anime', c.anime]].filter(([, n]) => n);
  let mx = M;
  ctx.textBaseline = 'alphabetic';
  parts.forEach(([label, n]) => {
    ctx.fillStyle = t.accent;
    ctx.font = `italic 54px ${DISPLAY}`;
    ctx.fillText(String(n), mx, M + 300);
    const nw = ctx.measureText(String(n)).width;
    const lw = mono(ctx, t, label, mx + nw + 10, M + 300, { size: 16, color: t.sub });
    mx += nw + lw + 46;
  });
  ctx.fillStyle = t.ink;
  ctx.fillRect(M, M + 328, W - M * 2, 2);

  // 表紙が全部入る、いちばん大きい並べ方を選ぶ
  const top = M + 360;
  const availW = W - M * 2;
  const availH = H - top - FOOTER_H - 46;
  const n = items.length;
  let best = null;
  for (let cols = 1; cols <= 10; cols++) {
    const gap = cols <= 4 ? 22 : cols <= 6 ? 14 : 10;
    const rows = Math.ceil(n / cols);
    const cw = (availW - gap * (cols - 1)) / cols;
    const chh = cw * 1.5;
    const fitW = rows * chh + gap * (rows - 1) <= availH ? cw : (availH - gap * (rows - 1)) / rows / 1.5;
    if (!best || fitW > best.cw) best = { cols, rows, gap, cw: fitW };
  }
  const { cols, gap, cw } = best;
  const chh = cw * 1.5;
  const rowsN = Math.ceil(n / cols);
  const gridW = cols * cw + gap * (cols - 1);
  const gridH = rowsN * chh + gap * (rowsN - 1);
  const x0 = M + (availW - gridW) / 2;
  const y0 = top + (availH - gridH) / 2;
  items.forEach((it, i) => {
    const r = Math.floor(i / cols);
    const k = i % cols;
    drawCover(ctx, t, it, covers[i], x0 + k * (cw + gap), y0 + r * (chh + gap), cw, chh);
  });
  if (poster.items.length > items.length) mono(ctx, t, `+${poster.items.length - items.length} more`, W - M, top - 14, { size: 14, align: 'right' });
  const credits = [...new Set(items.map((it) => it.cover?.credit).filter(Boolean))];
  drawFooter(ctx, t, credits, M, H - FOOTER_H - 26);
  return { blob: await toBlob(canvas), failed, width: W, height: H };
}

