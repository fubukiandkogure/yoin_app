// データ構造・検証・共有スナップショット・棚の絞り込みなど、画面に依存しない処理。
import { SCHEMA_VERSION, MAX_SHELF_ITEMS, FLASHBACK_MONTHS, APP_ID } from './config.js';
import {
  isValidExpDate, expDateSortKey, expDateEnd, addMonths, normalizeText, seededShuffle, safeUrl,
} from './util.js';

export const TYPES = { movie: '映画', book: '本', anime: 'アニメ' };
export const STATUSES = { planned: 'これから', inprogress: '途中', done: '完了', dropped: '中断' };
export const PROVIDERS = ['tmdb', 'googlebooks', 'openbd', 'manual'];
export const COVER_MISSING = {
  no_image: '提供元に画像がありません',
  manual: '手入力で登録しました',
  removed: '画像を外しました',
};
// 体験の動詞（「観た」「読んだ」）
export const VERBS = { movie: '観た', book: '読んだ', anime: '観た' };

export function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, works: [], experiences: [], shelves: [], updatedAt: null };
}

// ---------- 検証 ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && !isNaN(Date.parse(v));

function makeChecker(errors) {
  const fail = (m) => { if (errors.length < 30) errors.push(m); };
  const S = {
    str(v, label, { required = false, max = 20000 } = {}) {
      if (v === undefined || v === null) {
        if (required) fail(`${label}がありません`);
        return '';
      }
      if (typeof v !== 'string') { fail(`${label}が文字列ではありません`); return ''; }
      if (required && !v.trim()) fail(`${label}が空です`);
      if (v.length > max) fail(`${label}が長すぎます`);
      return v;
    },
    strOrNull(v, label, max = 2000) {
      if (v === undefined || v === null) return null;
      if (typeof v !== 'string') { fail(`${label}が文字列ではありません`); return null; }
      if (v.length > max) fail(`${label}が長すぎます`);
      return v;
    },
    intOrNull(v, label, min, max) {
      if (v === undefined || v === null) return null;
      if (!Number.isInteger(v) || v < min || v > max) { fail(`${label}は${min}〜${max}の整数である必要があります`); return null; }
      return v;
    },
    bool(v, label) {
      if (v === undefined) return false;
      if (typeof v !== 'boolean') { fail(`${label}が真偽値ではありません`); return false; }
      return v;
    },
    iso(v, label) {
      if (!isIso(v)) { fail(`${label}の日時が正しくありません`); return new Date(0).toISOString(); }
      return v;
    },
    oneOf(v, label, allowed) {
      if (!allowed.includes(v)) { fail(`${label}の値「${String(v)}」は使えません`); return allowed[0]; }
      return v;
    },
    id(v, label) {
      if (typeof v !== 'string' || !v || v.length > 100) { fail(`${label}のIDが正しくありません`); return ''; }
      return v;
    },
  };
  return { fail, S };
}

function normWork(w, label, S, fail) {
  if (!isObj(w)) { fail(`${label}の形式が正しくありません`); return null; }
  const source = isObj(w.source) ? w.source : {};
  const cover = isObj(w.cover) ? w.cover : {};
  const coverUrl = S.strOrNull(cover.url, `${label}の表紙URL`, 2000);
  if (coverUrl && !safeUrl(coverUrl)) fail(`${label}の表紙URLが正しくありません`);
  const tags = Array.isArray(w.tags) ? w.tags : (w.tags === undefined ? [] : (fail(`${label}のタグが配列ではありません`), []));
  for (const t of tags) if (typeof t !== 'string') fail(`${label}のタグが文字列ではありません`);
  return {
    id: S.id(w.id, label),
    type: S.oneOf(w.type, `${label}の種別`, Object.keys(TYPES)),
    title: S.str(w.title, `${label}のタイトル`, { required: true, max: 500 }),
    creator: S.str(w.creator, `${label}の作者・監督`, { max: 500 }),
    year: S.intOrNull(w.year, `${label}の年`, 0, 9999),
    volume: S.str(w.volume, `${label}の巻・版・シーズン`, { max: 200 }),
    source: {
      provider: S.oneOf(source.provider ?? 'manual', `${label}の取得元`, PROVIDERS),
      id: S.strOrNull(source.id, `${label}の外部ID`, 200),
      mediaType: S.strOrNull(source.mediaType, `${label}の外部種別`, 20),
      seasonNumber: S.intOrNull(source.seasonNumber, `${label}のシーズン番号`, 0, 9999),
      isbn: S.strOrNull(source.isbn, `${label}のISBN`, 20),
    },
    cover: {
      url: coverUrl || null,
      provider: S.strOrNull(cover.provider, `${label}の画像提供元`, 40),
      credit: S.strOrNull(cover.credit, `${label}の画像出典`, 200),
      missingReason: coverUrl ? null : (cover.missingReason == null ? null : S.oneOf(cover.missingReason, `${label}の画像なし理由`, Object.keys(COVER_MISSING))),
    },
    status: S.oneOf(w.status, `${label}の状態`, Object.keys(STATUSES)),
    favorite: S.bool(w.favorite, `${label}のお気に入り`),
    tags: tags.filter((t) => typeof t === 'string').slice(0, 30),
    createdAt: S.iso(w.createdAt, `${label}の作成`),
    updatedAt: S.iso(w.updatedAt ?? w.createdAt, `${label}の更新`),
  };
}

function normExperience(e, label, S, fail, workIds) {
  if (!isObj(e)) { fail(`${label}の形式が正しくありません`); return null; }
  if (!workIds.has(e.workId)) fail(`${label}が存在しない作品を参照しています`);
  if (!isValidExpDate(e.date)) fail(`${label}の体験時期が正しくありません`);
  return {
    id: S.id(e.id, label),
    workId: String(e.workId ?? ''),
    score: S.intOrNull(e.score, `${label}の点数`, 0, 100),
    comment: S.str(e.comment, `${label}のひとこと感想`, { max: 2000 }),
    memo: S.str(e.memo, `${label}の詳細メモ`, { max: 50000 }),
    date: isValidExpDate(e.date) ? { precision: e.date.precision, value: e.date.value } : { precision: 'unknown', value: null },
    note: S.str(e.note, `${label}の体験メモ`, { max: 2000 }),
    createdAt: S.iso(e.createdAt, `${label}の作成`),
    updatedAt: S.iso(e.updatedAt ?? e.createdAt, `${label}の更新`),
  };
}

// 画像にする棚の表示設定（初期値：作品名・おすすめの一言・点数を載せ、棚タイトルは載せない）
export const DEFAULT_IMAGE_OPTIONS = {
  showTitle: false, showWorkTitle: true, showRecommendation: true, showScore: true,
  theme: 'paper', // paper（生成り）| night（夜）
  layout: 'tall', // tall（縦長・文字あり）| square（正方形・表紙中心）
};
export const IMAGE_THEMES = { paper: '生成り', night: '夜' };
export const IMAGE_LAYOUTS = { tall: '縦長（文字あり）', square: '正方形（表紙中心）' };

function normShelf(s, label, S, fail, workIds) {
  if (!isObj(s)) { fail(`${label}の形式が正しくありません`); return null; }
  if (!Array.isArray(s.items)) { fail(`${label}の作品一覧が配列ではありません`); return null; }
  if (s.items.length > MAX_SHELF_ITEMS) fail(`${label}の作品数が${MAX_SHELF_ITEMS}を超えています`);
  const seen = new Set();
  const items = s.items.map((it, i) => {
    if (!isObj(it)) { fail(`${label}の${i + 1}番目の形式が正しくありません`); return null; }
    if (!workIds.has(it.workId)) fail(`${label}が存在しない作品を含んでいます`);
    if (seen.has(it.workId)) fail(`${label}に同じ作品が重複しています`);
    seen.add(it.workId);
    return { workId: String(it.workId ?? ''), recommendation: S.str(it.recommendation, `${label}のおすすめの一言`, { max: 2000 }) };
  }).filter(Boolean);
  const o = isObj(s.options) ? s.options : {};
  const options = {};
  for (const [k, def] of Object.entries(DEFAULT_IMAGE_OPTIONS)) {
    if (o[k] === undefined) options[k] = def;
    else if (k === 'theme') options[k] = S.oneOf(o[k], `${label}の画像テーマ`, Object.keys(IMAGE_THEMES));
    else if (k === 'layout') options[k] = S.oneOf(o[k], `${label}の画像レイアウト`, Object.keys(IMAGE_LAYOUTS));
    else options[k] = S.bool(o[k], `${label}の表示設定`);
  }
  return {
    id: S.id(s.id, label),
    title: S.str(s.title, `${label}のタイトル`, { max: 200 }),
    items,
    options,
    createdAt: S.iso(s.createdAt, `${label}の作成`),
    updatedAt: S.iso(s.updatedAt ?? s.createdAt, `${label}の更新`),
  };
}

/**
 * データ全体を検証・正規化する。1件でも問題があれば ok:false を返し、何も取り込まない。
 */
export function validateData(input) {
  const errors = [];
  const { fail, S } = makeChecker(errors);
  if (!isObj(input)) return { ok: false, errors: ['データの形式が正しくありません'] };
  if (input.schemaVersion !== SCHEMA_VERSION) {
    if (Number.isInteger(input.schemaVersion) && input.schemaVersion > SCHEMA_VERSION) {
      return { ok: false, errors: [`新しいバージョン（${input.schemaVersion}）のデータです。アプリを更新してください`] };
    }
    return { ok: false, errors: ['スキーマのバージョンが不明です'] };
  }
  for (const key of ['works', 'experiences', 'shelves']) {
    if (!Array.isArray(input[key])) return { ok: false, errors: [`${key} が配列ではありません`] };
  }
  const ids = new Set();
  const uniq = (id, label) => { if (ids.has(id)) fail(`${label}のIDが重複しています`); ids.add(id); };

  const works = input.works.map((w, i) => normWork(w, `作品${i + 1}`, S, fail)).filter(Boolean);
  works.forEach((w, i) => uniq(w.id, `作品${i + 1}`));
  const workIds = new Set(works.map((w) => w.id));
  const experiences = input.experiences.map((e, i) => normExperience(e, `体験記録${i + 1}`, S, fail, workIds)).filter(Boolean);
  experiences.forEach((e, i) => uniq(e.id, `体験記録${i + 1}`));
  const shelves = input.shelves.map((s, i) => normShelf(s, `画像の棚${i + 1}`, S, fail, workIds)).filter(Boolean);
  shelves.forEach((s, i) => uniq(s.id, `画像の棚${i + 1}`));

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      schemaVersion: SCHEMA_VERSION,
      works, experiences, shelves,
      updatedAt: isIso(input.updatedAt) ? input.updatedAt : null,
    },
  };
}

// ---------- バックアップ ----------

export function makeBackup(data) {
  return {
    format: `${APP_ID}-backup`,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      schemaVersion: SCHEMA_VERSION,
      works: data.works,
      experiences: data.experiences,
      shelves: data.shelves,
      updatedAt: data.updatedAt,
    },
  };
}

/** バックアップ文字列を解析・検証する。成功時は件数のプレビューも返す。 */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSONとして読み込めませんでした（ファイルが壊れている可能性があります）'] };
  }
  if (!isObj(obj) || obj.format !== `${APP_ID}-backup` || !isObj(obj.data)) {
    return { ok: false, errors: ['このアプリのバックアップファイルではありません'] };
  }
  if (obj.schemaVersion !== obj.data.schemaVersion) {
    return { ok: false, errors: ['バックアップのバージョン情報が一致しません'] };
  }
  const r = validateData(obj.data);
  if (!r.ok) return r;
  return {
    ok: true,
    data: r.data,
    exportedAt: isIso(obj.exportedAt) ? obj.exportedAt : null,
    counts: { works: r.data.works.length, experiences: r.data.experiences.length, shelves: r.data.shelves.length },
  };
}

// ---------- 参照ヘルパー ----------

export const findWork = (data, id) => data.works.find((w) => w.id === id) || null;

/** 作品の体験記録（新しく記録した順） */
export function experiencesOf(data, workId) {
  return data.experiences
    .filter((e) => e.workId === workId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** 作品棚に出す「最新の体験記録」 = いちばん新しく記録したもの */
export const latestExperience = (data, workId) => experiencesOf(data, workId)[0] || null;

export function allTags(data) {
  const count = new Map();
  for (const w of data.works) for (const t of w.tags) count.set(t, (count.get(t) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([t]) => t);
}

export function shelvesContaining(data, workId) {
  return data.shelves.filter((s) => s.items.some((it) => it.workId === workId));
}

// ---------- 重複チェック ----------

export function findDuplicates(data, cand) {
  const t = normalizeText(cand.title);
  const v = normalizeText(cand.volume);
  return data.works.filter((w) => {
    const s = w.source;
    if (cand.source?.provider && cand.source.provider !== 'manual' && s.provider === cand.source.provider && s.id && s.id === cand.source.id) {
      return (s.seasonNumber ?? null) === (cand.source.seasonNumber ?? null);
    }
    return w.type === cand.type && normalizeText(w.title) === t && normalizeText(w.volume) === v;
  });
}

// ---------- 作品棚（絞り込み・並べ替え・検索） ----------

export function shelfEntries(data) {
  const byWork = new Map();
  for (const e of data.experiences) {
    if (!byWork.has(e.workId)) byWork.set(e.workId, []);
    byWork.get(e.workId).push(e);
  }
  return data.works.map((w) => {
    const exps = (byWork.get(w.id) || []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const latest = exps[0] || null;
    const recordedAt = [w.createdAt, ...exps.map((e) => e.createdAt)].sort().pop();
    const text = normalizeText([
      w.title, w.creator, w.volume, w.tags.join(' '),
      ...exps.map((e) => `${e.comment} ${e.memo} ${e.note}`),
    ].join(' '));
    return { work: w, latest, recordedAt, text };
  });
}

export function filterAndSort(entries, { q = '', type = '', status = '', favorite = false, tag = '', sort = 'recent' } = {}) {
  const terms = String(q).trim().split(/[\s　]+/).map(normalizeText).filter(Boolean);
  const list = entries.filter(({ work, text }) =>
    (!type || work.type === type) &&
    (!status || work.status === status) &&
    (!favorite || work.favorite) &&
    (!tag || work.tags.includes(tag)) &&
    terms.every((t) => text.includes(t)));
  const byRecent = (a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0);
  if (sort === 'score') {
    list.sort((a, b) => {
      const sa = a.latest?.score ?? null;
      const sb = b.latest?.score ?? null;
      if (sa === null && sb === null) return byRecent(a, b);
      if (sa === null) return 1; // 未採点は末尾
      if (sb === null) return -1;
      return sb - sa || byRecent(a, b);
    });
  } else if (sort === 'experienced') {
    list.sort((a, b) => {
      const ka = expDateSortKey(a.latest?.date);
      const kb = expDateSortKey(b.latest?.date);
      if (!ka && !kb) return byRecent(a, b);
      if (!ka) return 1; // 時期不明は末尾
      if (!kb) return -1;
      return ka < kb ? 1 : ka > kb ? -1 : byRecent(a, b);
    });
  } else {
    list.sort(byRecent);
  }
  return list;
}

/** 年ごとの棚：最新の体験記録の年でまとめる（新しい年から。時期不明は最後） */
export function groupByYear(entries) {
  const groups = new Map();
  for (const e of entries) {
    const v = e.latest?.date?.value;
    const key = v ? v.slice(0, 4) : 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : b.localeCompare(a)))
    .map(([year, items]) => ({ year, label: year === 'unknown' ? '時期不明' : `${year}年`, items }));
}

/** 「これから」の作品（何にしようか迷ったとき用） */
export const plannedWorks = (data) => data.works.filter((w) => w.status === 'planned');

// ---------- 振り返り ----------

/** 体験から3か月以上前で、楽しんだ（お気に入り・70点以上・ひとことあり）作品を最大3件 */
export function flashback(data, now = new Date(), count = 3) {
  const threshold = addMonths(now, -FLASHBACK_MONTHS);
  const candidates = [];
  for (const w of data.works) {
    if (w.status === 'planned') continue;
    const latest = latestExperience(data, w.id);
    if (!latest) continue;
    const ref = expDateEnd(latest.date) || new Date(latest.createdAt);
    if (ref > threshold) continue;
    const enjoyed = w.favorite || (latest.score !== null && latest.score >= 70) || latest.comment.trim() !== '';
    if (enjoyed) candidates.push({ work: w, experience: latest });
  }
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return seededShuffle(candidates, day).slice(0, count);
}

// ---------- 共有画像のデータ ----------

/**
 * 画像に描く項目だけを明示的に取り出す。ひとこと感想・詳細メモ・誰と観たか・タグなどは含めない。
 */
export function buildImageData(data, shelf) {
  const o = { ...DEFAULT_IMAGE_OPTIONS, ...shelf.options };
  const items = [];
  for (const it of shelf.items) {
    const w = findWork(data, it.workId);
    if (!w) continue;
    items.push({
      type: w.type,
      title: w.title,
      volume: w.volume || '',
      cover: w.cover.url ? { url: w.cover.url, credit: w.cover.credit || '' } : null,
      recommendation: o.showRecommendation ? it.recommendation || '' : '',
      score: o.showScore ? latestExperience(data, w.id)?.score ?? null : null,
    });
  }
  return { title: o.showTitle ? shelf.title || '' : '', options: o, items };
}
