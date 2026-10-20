// 本：Google Books でタイトル検索し、表紙がなければ openBD（ISBN）で補完する。
import { StoreError, fetchWithTimeout } from '../store/errors.js';

export const GOOGLE_CREDIT = '書影・書誌情報：Google Books';
export const OPENBD_CREDIT = '書影・書誌情報：openBD（版元ドットコム）';

const isbnOf = (v) => {
  const ids = v.industryIdentifiers || [];
  return (ids.find((i) => i.type === 'ISBN_13') || ids.find((i) => i.type === 'ISBN_10'))?.identifier || null;
};

const normalizeIsbn = (q) => {
  const s = String(q).replace(/[-\s]/g, '');
  return /^(97[89]\d{10}|\d{9}[\dX])$/i.test(s) ? s : null;
};

function googleThumb(links) {
  const url = links?.thumbnail || links?.smallThumbnail;
  if (!url) return null;
  return url.replace(/^http:/, 'https:').replace(/&edge=curl/, '');
}

async function googleSearch(query, key) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  const isbn = normalizeIsbn(query);
  url.searchParams.set('q', isbn ? `isbn:${isbn}` : query);
  url.searchParams.set('maxResults', '20');
  url.searchParams.set('printType', 'books');
  if (key) url.searchParams.set('key', key);
  const res = await fetchWithTimeout(fetch, url.href);
  if (res.status === 429 || res.status === 403) {
    throw new StoreError('ratelimit', key
      ? 'Google Booksの検索回数の上限に達しました。少し待ってください。'
      : 'Google Booksの検索回数の上限に達しました（APIキー未設定時は共有の上限を使うため不安定です。設定でキーを登録すると安定します）。');
  }
  if (res.status === 400 && key) throw new StoreError('auth', 'Google BooksのAPIキーが正しくありません。');
  if (!res.ok) throw new StoreError('server', `Google Booksの検索に失敗しました（${res.status}）。`);
  const json = await res.json();
  return (json.items || []).map((it) => {
    const v = it.volumeInfo || {};
    const thumb = googleThumb(v.imageLinks);
    return {
      provider: 'googlebooks',
      id: it.id,
      type: 'book',
      title: [v.title, v.subtitle].filter(Boolean).join(' '),
      year: v.publishedDate && /^\d{4}/.test(v.publishedDate) ? Number(v.publishedDate.slice(0, 4)) : null,
      creator: (v.authors || []).join('、'),
      volume: '',
      publisher: v.publisher || '',
      isbn: isbnOf(v),
      cover: thumb ? { url: thumb, thumb, provider: 'googlebooks', credit: GOOGLE_CREDIT } : null,
      extra: v.publisher || '',
    };
  });
}

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
    isbn: s.isbn,
    cover: s.cover ? { url: s.cover, thumb: s.cover, provider: 'openbd', credit: OPENBD_CREDIT } : null,
    extra: [s.series, s.publisher].filter(Boolean).join(' / '),
  };
}

export async function searchBooks(query, key) {
  const isbn = normalizeIsbn(query);
  const errors = [];
  let results = [];
  try {
    results = await googleSearch(query, key);
  } catch (e) {
    errors.push(e);
  }
  // ISBN 検索で Google に無い／失敗した場合は openBD から
  if (isbn && !results.length) {
    try {
      const recs = await openbdGet([isbn]);
      results = recs.filter(Boolean).map(openbdCandidate);
    } catch (e) {
      errors.push(e);
    }
  }
  // 表紙がない本は openBD の書影で補完
  const missing = results.filter((r) => !r.cover && r.isbn && /^97[89]/.test(r.isbn));
  if (missing.length) {
    try {
      const recs = await openbdGet(missing.map((r) => r.isbn));
      recs.forEach((rec, i) => {
        if (rec?.summary?.cover) missing[i].cover = { url: rec.summary.cover, thumb: rec.summary.cover, provider: 'openbd', credit: OPENBD_CREDIT };
      });
    } catch { /* 補完に失敗しても検索結果は使える */ }
  }
  if (!results.length && errors.length) throw errors[0];
  return results;
}
