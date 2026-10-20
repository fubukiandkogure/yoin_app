// 汎用ヘルパー：エスケープ付きテンプレート、ID、日付、文字列処理。

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Safe(String(s));

function renderValue(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return esc(v);
}

// 埋め込む値はすべてエスケープされる。HTML断片を入れるときは html`` か raw() を使う。
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new Safe(out);
}

// http(s) 以外のURLは使わない（javascript: などを防ぐ）
export function safeUrl(url) {
  if (typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const nowIso = () => new Date().toISOString();

export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　・:：;；,，、。.．!！?？'"’”「」『』()（）\[\]【】〜~\-‐－—_]/g, '');
}

export function parseTags(input) {
  const seen = new Set();
  const tags = [];
  for (const t of String(input ?? '').split(/[,、，\s　]+/)) {
    const tag = t.replace(/^#/, '').trim().slice(0, 40);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags.slice(0, 30);
}

// --- 体験時期（年月日／年月／年／不明） ---

export function makeExpDate(year, month, day) {
  const y = Number(year);
  if (!year || !Number.isInteger(y) || y < 1000 || y > 9999) return { precision: 'unknown', value: null };
  const yy = String(y);
  const m = Number(month);
  if (!month || !Number.isInteger(m) || m < 1 || m > 12) return { precision: 'year', value: yy };
  const mm = String(m).padStart(2, '0');
  const d = Number(day);
  const last = new Date(y, m, 0).getDate();
  if (!day || !Number.isInteger(d) || d < 1 || d > last) return { precision: 'month', value: `${yy}-${mm}` };
  return { precision: 'day', value: `${yy}-${mm}-${String(d).padStart(2, '0')}` };
}

export function splitExpDate(date) {
  const [y = '', m = '', d = ''] = (date?.value ?? '').split('-');
  return { year: y, month: m ? String(Number(m)) : '', day: d ? String(Number(d)) : '' };
}

export function isValidExpDate(date) {
  if (!date || typeof date !== 'object') return false;
  const { precision, value } = date;
  if (precision === 'unknown') return value === null;
  const re = { year: /^\d{4}$/, month: /^\d{4}-\d{2}$/, day: /^\d{4}-\d{2}-\d{2}$/ }[precision];
  if (!re || typeof value !== 'string' || !re.test(value)) return false;
  const p = splitExpDate(date);
  const again = makeExpDate(p.year, p.month, p.day);
  return again.precision === precision && again.value === value;
}

export function formatExpDate(date) {
  if (!date || date.precision === 'unknown') return '時期不明';
  const p = splitExpDate(date);
  if (date.precision === 'year') return `${p.year}年`;
  if (date.precision === 'month') return `${p.year}年${p.month}月`;
  return `${p.year}年${p.month}月${p.day}日`;
}

// 並べ替え用のキー。精度が粗い日付は期間の先頭として扱う。不明は空文字。
export function expDateSortKey(date) {
  if (!date || date.precision === 'unknown') return '';
  const p = splitExpDate(date);
  return `${p.year}-${(p.month || '0').padStart(2, '0')}-${(p.day || '0').padStart(2, '0')}`;
}

// 期間の終わり（「3か月以上前」を判定するときは控えめに期間の終わりを使う）
export function expDateEnd(date) {
  if (!date || date.precision === 'unknown') return null;
  const p = splitExpDate(date);
  const y = Number(p.year);
  if (date.precision === 'year') return new Date(y, 11, 31, 23, 59, 59);
  const m = Number(p.month);
  if (date.precision === 'month') return new Date(y, m, 0, 23, 59, 59);
  return new Date(y, m - 1, Number(p.day), 23, 59, 59);
}

export function addMonths(d, n) {
  const x = new Date(d.getTime());
  x.setMonth(x.getMonth() + n);
  return x;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 日付ごとに固定される疑似乱数（振り返り欄が開くたびに変わりすぎないように）
export function seededShuffle(arr, seedStr) {
  let h = 2166136261;
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// UTF-8 <-> base64（GitHub Contents API 用）
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
