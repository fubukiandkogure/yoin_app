// 本の検索と書影。
// - 書誌：国立国会図書館サーチ（日本の本に強い・キー不要）と Google Books（表記ゆれに強い）を同時に探して統合する
// - 書影：Google Books の画像 → openBD → Google Books の ISBN 指定画像（「画像なし」の代替画像は除外）の順に探す
import { StoreError, fetchWithTimeout } from '../store/errors.js';
import { normalizeText } from '../util.js';

export const GOOGLE_CREDIT = '書影・書誌情報：Google Books';
export const OPENBD_CREDIT = '書影・書誌情報：openBD（版元ドットコム）';
export const NDL_CREDIT = '書誌情報：国立国会図書館サーチ';

// ---------- ISBN ----------

export function toIsbn13(raw) {
  const s = String(raw || '').replace(/[-\s]/g, '').toUpperCase();
  if (/^97[89]\d{10}$/.test(s)) return s;
  if (/^\d{9}[\dX]$/.test(s)) {
    const core = `978${s.slice(0, 9)}`;
    const sum = [...core].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
    return core + ((10 - (sum % 10)) % 10);
  }
  return null;
}

// ---------- 書影 ----------

/** Google Books の画像URLを大きめ（幅400）にする */
export function googleLarge(url) {
  if (!url) return null;
  const u = url.replace(/^http:/, 'https:').replace(/&edge=curl/, '').replace(/&zoom=\d/, '&zoom=1');
  return /fife=/.test(u) ? u : `${u}&fife=w400`;
}

/** ISBN から引く Google Books の書影（存在しないときは 128×170 の「画像なし」画像が返る） */
export const googleCoverByIsbn = (isbn13) => `https://books.google.com/books/content?vid=ISBN${isbn13}&printsec=frontcover&img=1&zoom=1&fife=w400`;

/**
 * 読み込んだ画像が Google の代替画像（「image not available」128×170、灰色の仮表紙 128×184）かどうか。
 * 幅400を指定したときに本物の表紙は300px前後で返り、代替画像だけ128pxのままになる
 */
export function isGooglePlaceholderSize(src, w, h) {
  if (!/books\.google/.test(src || '')) return false;
  return w === 128 && (h === 170 || h === 184 || /fife=w400/.test(src));
}
export const isGooglePlaceholder = (img) => isGooglePlaceholderSize(img.src, img.naturalWidth, img.naturalHeight);

/** 書影が実際に表示できるか確かめる（代替画像・読み込み失敗は false） */
export function verifyCover(url, timeout = 8000) {
  if (!url || typeof Image === 'undefined') return Promise.resolve(Boolean(url));
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), timeout);
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { clearTimeout(t); resolve(!isGooglePlaceholder(img) && img.naturalWidth > 1); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = url;
  });
}

const cover = (url, provider, credit) => ({ url, thumb: url, provider, credit });

// ---------- 国立国会図書館サーチ ----------

/** 「杉井, 光」→「杉井光」、「Andersen, Hans Christian, 1805-1875」→「Hans Christian Andersen」 */
export function cleanNdlCreator(name) {
  const s = String(name || '').replace(/,?\s*\d{3,4}-(\d{3,4})?\s*$/, '').replace(/\s*\[.*?\]\s*/g, '').trim();
  if (/[぀-ヿ㐀-鿿]/.test(s)) return s.replace(/[,\s、]+/g, '');
  const [last, first] = s.split(/,\s*/);
  return first ? `${first} ${last}` : s;
}

/** 巻らしい表記だけを残す（「2」「上」「第3巻」など）。「す-31-2. nex」のような叢書番号は捨てる */
export function cleanVolume(v) {
  const s = String(v || '').normalize('NFKC').replace(/^[:：\s]+/, '').trim();
  return /^(第?\s*[0-9一二三四五六七八九十百]+\s*[巻部集編冊]?|[上中下前後]巻?|(vol|Vol|VOL)\.?\s*\d+)$/.test(s) ? s : '';
}

function parseNdl(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const items = [...doc.getElementsByTagName('item')];
  const text = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  const all = (el, tag) => [...el.getElementsByTagName(tag)].map((n) => n.textContent.trim()).filter(Boolean);
  return items.map((it) => {
    const isbnEl = [...it.getElementsByTagName('dc:identifier')].find((n) => /ISBN/.test(n.getAttribute('xsi:type') || ''));
    const issued = text(it, 'dcterms:issued') || text(it, 'dc:date');
    const year = /^\d{4}/.test(issued) ? Number(issued.slice(0, 4)) : null;
    const series = text(it, 'dcndl:seriesTitle');
    const publisher = text(it, 'dc:publisher');
    return {
      provider: 'ndl',
      id: text(it, 'guid') || text(it, 'link'),
      type: 'book',
      title: text(it, 'dc:title') || text(it, 'title'),
      volume: cleanVolume(text(it, 'dcndl:volume')),
      creator: [...new Set(all(it, 'dc:creator').map(cleanNdlCreator))].slice(0, 3).join('、'),
      year,
      publisher,
      isbn: toIsbn13(isbnEl?.textContent),
      cover: null,
      extra: [series, publisher].filter(Boolean).join(' / '),
      category: all(it, 'category'),
    };
  }).filter((c) => c.title && (!c.category.length || c.category.includes('図書')));
}

// 国立国会図書館サーチが混んでいて応答しないときは、しばらく使わずに Google Books だけで探す
let ndlPausedUntil = 0;
const NDL_PAUSE_MS = 60000;

async function ndl(params, retry = true) {
  if (Date.now() < ndlPausedUntil) throw new StoreError('ratelimit', '国立国会図書館サーチが混み合っているため、少しのあいだ使わずに探しています。');
  const url = new URL('https://ndlsearch.ndl.go.jp/api/opensearch');
  for (const [k, v] of Object.entries({ cnt: 30, ...params, mediatype: 'books' })) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetchWithTimeout(fetch, url.href, {}, 25000);
  } catch (e) {
    ndlPausedUntil = Date.now() + NDL_PAUSE_MS;
    throw e;
  }
  if (res.status === 429 && retry) {
    // 短時間に検索が続いたときは少し待って1回だけやり直す
    await new Promise((r) => setTimeout(r, 1800));
    return ndl(params, false);
  }
  if (res.status === 429 || res.status >= 500) {
    ndlPausedUntil = Date.now() + NDL_PAUSE_MS;
    throw new StoreError('ratelimit', '国立国会図書館サーチが混み合っています。少し待ってください。');
  }
  if (!res.ok) throw new StoreError('server', `国立国会図書館サーチの検索に失敗しました（${res.status}）。`);
  return parseNdl(await res.text());
}

/**
 * 表記ゆれに強い検索語を作る。送り仮名などで揺れやすい短い部分（「通っ」と「とおっ」など）を落とし、
 * 漢字・カタカナ・英数字の2文字以上のまとまりと、3文字以上のひらがなのまとまりだけを残す。
 * 例：「世界でいちばん透き通った物語」→「世界 でいちばん 物語」
 */
export function fuzzyTokens(query) {
  const runs = String(query).normalize('NFKC').match(/[㐀-鿿々〆]+|[぀-ゟ]+|[゠-ヿー]+|[A-Za-z0-9]+/g) || [];
  return runs.filter((r) => (/^[぀-ゟ]+$/.test(r) ? r.length >= 3 : r.length >= 2));
}

/** 表記ゆれ（透き通った／透きとおった など）に備えて、見つからなければ言い方を変えて探し直す */
async function ndlSearch(query) {
  // 続けて問い合わせるときは少し間をあける（国立国会図書館サーチの利用上限に配慮）
  const pause = () => new Promise((res) => setTimeout(res, 400));
  // 「題名 著者」のように語が分かれていれば、題名だけでなく全項目から探す
  let r = /\s/.test(query.trim()) ? [] : await ndl({ title: query });
  if (r.length) return r;
  if (!/\s/.test(query.trim())) await pause();
  r = await ndl({ any: query });
  if (r.length) return r;
  const tokens = fuzzyTokens(query);
  if (tokens.length >= 2 && tokens.join('') !== query.replace(/\s+/g, '')) {
    await pause();
    r = await ndl({ title: tokens.join(' '), cnt: 80 });
    if (r.length) return r;
  }
  await pause();
  const chars = [...query.replace(/\s+/g, '')];
  const len = Math.ceil(chars.length * 0.6);
  if (len >= 3 && len < chars.length) return ndl({ title: chars.slice(0, len).join(''), cnt: 80 });
  return [];
}

// ---------- Google Books ----------

async function googleSearch(query, key) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  const isbn = toIsbn13(query);
  url.searchParams.set('q', isbn ? `isbn:${isbn}` : query);
  url.searchParams.set('maxResults', '20');
  url.searchParams.set('printType', 'books');
  if (key) url.searchParams.set('key', key);
  const res = await fetchWithTimeout(fetch, url.href);
  if (res.status === 429 || res.status === 403) {
    throw new StoreError('ratelimit', key
      ? 'Google Booksの検索回数の上限に達しました。'
      : 'Google Booksの検索回数の上限に達しました（APIキーを設定すると安定します）。');
  }
  if (res.status === 400 && key) throw new StoreError('auth', 'Google BooksのAPIキーが正しくありません。');
  if (!res.ok) throw new StoreError('server', `Google Booksの検索に失敗しました（${res.status}）。`);
  const json = await res.json();
  return (json.items || []).map((it) => {
    const v = it.volumeInfo || {};
    const ids = v.industryIdentifiers || [];
    const isbn = toIsbn13((ids.find((i) => i.type === 'ISBN_13') || ids.find((i) => i.type === 'ISBN_10'))?.identifier);
    const thumb = googleLarge(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail);
    return {
      provider: 'googlebooks',
      id: it.id,
      type: 'book',
      title: v.title || '',
      volume: v.subtitle && /^(\d+|[上中下]|第.+[巻部])$/.test(v.subtitle) ? v.subtitle : '',
      subtitle: v.subtitle || '',
      creator: (v.authors || []).join('、'),
      year: v.publishedDate && /^\d{4}/.test(v.publishedDate) ? Number(v.publishedDate.slice(0, 4)) : null,
      publisher: v.publisher || '',
      isbn,
      cover: thumb ? cover(thumb, 'googlebooks', GOOGLE_CREDIT) : null,
      extra: v.publisher || '',
    };
  });
}

// ---------- openBD ----------

async function openbdGet(isbns) {
  if (!isbns.length) return [];
  const res = await fetchWithTimeout(fetch, `https://api.openbd.jp/v1/get?isbn=${isbns.map(encodeURIComponent).join(',')}`);
  if (!res.ok) throw new StoreError('server', `openBDの取得に失敗しました（${res.status}）。`);
  return res.json();
}

// openBD の著者表記「村上,春樹,1949- 著」を「村上春樹」にする
export function cleanOpenbdAuthor(a) {
  return String(a || '')
    .split(/\s+/)
    .map((p) => p.replace(/,?\d{4}-(\d{4})?/g, '').replace(/[／/]?(著|作|文|訳|編|絵|イラスト)$/, '').replace(/,/g, ''))
    .filter(Boolean)
    .join('、');
}

// 「ノルウェイの森. 上」のような書名から巻を分ける
export function splitOpenbdTitle(title, volume) {
  const m = String(title || '').match(/^(.+?)\.\s*(\S{1,6})$/);
  if (!volume && m) return { title: m[1], volume: m[2] };
  return { title: title || '', volume: volume || '' };
}

function openbdCandidate(rec) {
  const s = rec.summary;
  const t = splitOpenbdTitle(s.title, s.volume);
  return {
    provider: 'openbd',
    id: s.isbn,
    type: 'book',
    title: t.title,
    year: /^\d{4}/.test(s.pubdate || '') ? Number(s.pubdate.slice(0, 4)) : null,
    creator: cleanOpenbdAuthor(s.author),
    volume: t.volume,
    publisher: s.publisher || '',
    isbn: toIsbn13(s.isbn),
    cover: s.cover ? cover(s.cover, 'openbd', OPENBD_CREDIT) : null,
    extra: [s.series, s.publisher].filter(Boolean).join(' / '),
  };
}

// ---------- 統合 ----------

/** 文字のつながり（2文字ずつ）の重なりで、検索語との近さを 0〜1 で返す */
export function similarity(a, b) {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s) => {
    const g = new Map();
    const cs = [...s];
    if (cs.length === 1) g.set(s, 1);
    for (let i = 0; i < cs.length - 1; i++) {
      const k = cs[i] + cs[i + 1];
      g.set(k, (g.get(k) || 0) + 1);
    }
    return g;
  };
  const gx = grams(x);
  const gy = grams(y);
  let hit = 0;
  for (const [k, n] of gx) hit += Math.min(n, gy.get(k) || 0);
  const total = [...gx.values()].reduce((s, n) => s + n, 0) + [...gy.values()].reduce((s, n) => s + n, 0);
  const dice = (2 * hit) / total;
  return y.startsWith(x) || x.startsWith(y) ? Math.max(dice, 0.85) : dice;
}

/** 重複をまとめて、検索語に近い順に並べる（同じ ISBN は1件に。表紙や巻の情報は補い合う） */
export function mergeBookResults(query, lists) {
  const byKey = new Map();
  const out = [];
  for (const list of lists) {
    for (const c of list) {
      const key = c.isbn || `${normalizeText(c.title)}|${normalizeText(c.volume)}|${normalizeText(c.publisher)}`;
      const prev = byKey.get(key);
      if (prev) {
        if (!prev.cover && c.cover) prev.cover = c.cover;
        if (!prev.volume && c.volume) prev.volume = c.volume;
        if (!prev.creator && c.creator) prev.creator = c.creator;
        if (!prev.year && c.year) prev.year = c.year;
        continue;
      }
      const item = { ...c };
      byKey.set(key, item);
      out.push(item);
    }
  }
  const score = (c) => similarity(query, `${c.title}${c.volume}`) + similarity(query, c.title) * 0.5 + (c.cover ? 0.05 : 0) + (c.isbn ? 0.03 : 0) + (c.isbn?.startsWith('9784') ? 0.04 : 0);
  return out
    .map((c, i) => ({ c, s: score(c), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ c }) => c);
}

/** 表紙がない本に、openBD → Google（ISBN指定）の順で書影を付ける */
async function fillCovers(results) {
  const missing = results.filter((r) => !r.cover && r.isbn);
  if (!missing.length) return;
  try {
    const recs = await openbdGet(missing.map((r) => r.isbn));
    recs.forEach((rec, i) => {
      if (rec?.summary?.cover) missing[i].cover = cover(rec.summary.cover, 'openbd', OPENBD_CREDIT);
    });
  } catch { /* 補完に失敗しても検索結果は使える */ }
  for (const r of missing) {
    // 実在するかは表示時・登録時に確かめる（「画像なし」の代替画像なら仮表紙にする）
    if (!r.cover) r.cover = { ...cover(googleCoverByIsbn(r.isbn), 'googlebooks', GOOGLE_CREDIT), unverified: true };
  }
}

/**
 * 本を探す。
 * - onPartial：先に返ってきた検索元の結果をすぐ見せたいときのコールバック（国立国会図書館サーチは遅いことがある）
 * - googleFirst：まず Google Books だけで探し、結果がなかったときだけ国立国会図書館サーチも使う（まとめて追加用）
 */
export async function searchBooks(query, key, { onPartial, googleFirst = false } = {}) {
  const q = String(query).normalize('NFKC').trim();
  const isbn = toIsbn13(q);
  const errors = [];
  let okSources = 0;
  const settle = (p) => p.then((r) => { okSources++; return r; }, (e) => { errors.push(e); return []; });
  let lists;
  if (isbn) {
    lists = await Promise.all([
      settle(openbdGet([isbn]).then((recs) => recs.filter(Boolean).map(openbdCandidate))),
      settle(ndl({ isbn })),
      settle(googleSearch(isbn, key)),
    ]);
  } else if (googleFirst) {
    const g = await settle(googleSearch(q, key));
    lists = g.length ? [g] : [g, await settle(ndlSearch(q))];
  } else {
    const gp = settle(googleSearch(q, key));
    const np = settle(ndlSearch(q));
    if (onPartial) {
      // Google が先に返ってきたら、国立国会図書館サーチを待たずに一度見せる
      gp.then(async (g) => {
        if (!g.length) return;
        const partial = mergeBookResults(q, [g]).slice(0, 30);
        await fillCovers(partial).catch(() => {});
        onPartial(partial);
      });
    }
    lists = await Promise.all([np, gp]);
  }
  const results = mergeBookResults(q, lists).slice(0, 30);
  // どれか1つでも検索できていれば「見つからない」として返す（全部失敗したときだけエラー）
  if (!results.length && !okSources && errors.length) {
    // 国立国会図書館サーチの失敗を優先して伝える（Google は キー未設定だと上限に当たりやすいため）
    const e = errors.find((x) => !/Google/.test(x.message)) || errors[0];
    e.all = errors;
    throw e;
  }
  await fillCovers(results);
  return results;
}

/** 登録前に、確かめていない書影を確認する */
export async function resolveBook(cand) {
  if (cand.cover?.unverified) {
    const ok = await verifyCover(cand.cover.url);
    const { unverified, ...rest } = cand.cover;
    return { ...cand, cover: ok ? rest : null, seasons: null };
  }
  return { ...cand, seasons: null };
}
