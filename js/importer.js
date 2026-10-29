// まとめて追加：メモの文章を読み取り、作品を探して当てはめる（画面に依存しない部分）。
//
// 書き方（1行に1作品）：
//   タイトル 92 ひとこと            … 点数の後ろはひとこと感想
//   タイトル / 著者 88 ひとこと      … 「 / 」の後ろは著者・監督
//   （補足）                        … かっこだけの行は、直前の作品の詳細メモに足す
//   > 長い感想                      … 「>」で始まる行は、直前の作品の詳細メモに足す
// 点数は 0〜100（「92点」「84か」も可）。点数がなければ未採点。
import { normalizeText } from './util.js';
import { similarity, fuzzyTokens } from './search/books.js';
import { ALIASES } from './search/aliases.js';

const SCORE_TOKEN = /^(\d{1,3})(?:点)?(?:か|？|\?)?$/;
const VOLUME_TAIL = /\s*((?:第\s*)?\d+\s*[巻期部]|シーズン\s*\d+|season\s*\d+|[上中下]巻?)$/i;

function splitTitleCreator(s) {
  const parts = s.split(/\s+[\/／]\s+|\t|\s{2,}|　{1,}/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0], creator: parts.slice(1).join(' ') };
  return { title: s.trim(), creator: '' };
}

/** 1行を読む。点数は「タイトルの後ろで最初に出てくる 0〜100 の数字だけの語」 */
export function parseLine(line) {
  const raw = line.trim();
  const tokens = raw.split(/(\s+)/); // 区切りも残して元の空白を保つ
  let scoreAt = -1;
  let score = null;
  const words = tokens.map((t, i) => ({ t, i })).filter((x) => x.t.trim());
  for (let k = 1; k < words.length; k++) {
    const m = words[k].t.normalize('NFKC').match(SCORE_TOKEN);
    if (m && Number(m[1]) <= 100) {
      scoreAt = words[k].i;
      score = Number(m[1]);
      break;
    }
  }
  const head = scoreAt >= 0 ? tokens.slice(0, scoreAt).join('') : raw;
  const comment = scoreAt >= 0 ? tokens.slice(scoreAt + 1).join('').trim() : '';
  let { title, creator } = splitTitleCreator(head.trim());
  let volume = '';
  const vm = title.match(VOLUME_TAIL);
  if (vm && vm.index > 0) {
    volume = vm[1].replace(/\s+/g, '');
    title = title.slice(0, vm.index).trim();
  }
  return { line: raw, title, creator, volume, score, comment, memo: '' };
}

/** 貼り付けた文章を作品ごとの行にする */
export function parseImportText(text) {
  const rows = [];
  for (const rawLine of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const prev = rows[rows.length - 1];
    // 「>」で始まる行・かっこだけの行は、直前の作品の詳細メモに足す
    const quote = line.match(/^[>＞]\s?(.*)$/);
    const paren = line.match(/^[（(](.*)[）)]$/);
    if (prev && (quote || paren)) {
      const add = quote ? quote[1] : line;
      prev.memo = prev.memo ? `${prev.memo}\n${add}` : add;
      continue;
    }
    const r = parseLine(line);
    if (r.title) rows.push(r);
  }
  return rows;
}

// ---------- 当てはめ ----------

/** 略称や表記ゆれを正式な題名に言い換える（なければ null） */
export function aliasFor(title) {
  const key = normalizeText(title);
  for (const [k, v] of Object.entries(ALIASES)) if (normalizeText(k) === key) return v;
  return null;
}

/** ひらがなをカタカナに（「エヴァーがーデン」のような混在の打ち間違い対策） */
const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** 探す言葉の候補を、よさそうな順に並べる */
export function queriesFor(type, row) {
  const qs = [];
  const alias = aliasFor(row.title) || aliasFor(`${row.title}${row.volume}`);
  if (type === 'book' && row.creator) qs.push(`${row.title} ${row.creator}`);
  if (alias) qs.push(alias);
  qs.push(row.title);
  // カタカナ中心の題名にひらがなが混ざっていたら、カタカナにそろえた形でも探す
  if (/[゠-ヿ]{3,}/.test(row.title) && /[ぁ-ゖ]/.test(row.title)) qs.push(toKatakana(row.title));
  const tokens = fuzzyTokens(row.title);
  if (tokens.length && tokens.join(' ') !== row.title) qs.push(tokens.join(' '));
  // 「ウマ娘 4DX」のように後ろに付け足しがある場合は、最初の語だけでも探す
  const first = row.title.split(/\s+/)[0];
  if (first && first !== row.title && first.length >= 2) qs.push(first);
  return [...new Set(qs.map((q) => q.trim()).filter(Boolean))];
}

/** 候補を、行の題名・著者・巻にどれだけ合うかで並べる。t は題名の近さ（0〜1） */
export function rankCandidates(row, cands) {
  const alias = aliasFor(row.title);
  return cands.map((c) => {
    const names = [c.title, c.originalTitle, c.subtitle ? `${c.title} ${c.subtitle}` : ''].filter(Boolean);
    const targets = [row.title, alias].filter(Boolean);
    let t = 0;
    for (const a of targets) for (const b of names) t = Math.max(t, similarity(a, b));
    let s = t;
    if (row.creator && c.creator) {
      const a = similarity(row.creator, c.creator);
      s += a * 0.35;
      // 著者がまったく違うなら、題名が少し似ていても別の作品とみなす
      if (a < 0.2) t -= 0.25;
    }
    if (row.volume) s += normalizeText(c.volume) === normalizeText(row.volume) ? 0.3 : c.volume ? -0.15 : -0.05;
    else if (c.volume) s -= 0.08;
    if (c.cover) s += 0.04;
    if (c.isbn?.startsWith('9784')) s += 0.02;
    return { c, s, t };
  }).sort((a, b) => b.s - a.s);
}

/** 当てはまり具合：ok（ほぼ確実）／check（念のため確認）／none（見つからない） */
export const confidence = (best) => (!best ? 'none' : best.t >= 0.6 ? 'ok' : best.t >= 0.3 ? 'check' : 'none');

/**
 * 1行ぶんの作品を探す。search(type, query) は候補の配列を返す関数。
 * 見つかった候補（最大8件）と、いちばん合うものを返す
 */
export async function matchRow(type, row, search, { pause = 0 } = {}) {
  const pool = [];
  const seen = new Set();
  let best = null;
  // 探す言葉は多くても4つまで（検索元に負担をかけすぎない）
  for (const q of queriesFor(type, row).slice(0, 4)) {
    let results = [];
    try {
      results = await search(type, q);
    } catch (e) {
      if (!pool.length) row.error = e;
    }
    for (const c of results) {
      const key = `${c.provider}|${c.id}|${c.isbn || ''}`;
      if (!seen.has(key)) { seen.add(key); pool.push(c); }
    }
    const ranked = rankCandidates(row, pool);
    best = ranked[0] || null;
    if (confidence(best) === 'ok') break;
    if (pause) await new Promise((r) => setTimeout(r, pause));
  }
  // まだ確実でなければ、最初の言葉で「深く」探し直す（本：国立国会図書館サーチも使う）
  if (confidence(rankCandidates(row, pool)[0]) !== 'ok' && search.deep) {
    try {
      for (const c of await search.deep(type, queriesFor(type, row)[0])) {
        const key = `${c.provider}|${c.id}|${c.isbn || ''}`;
        if (!seen.has(key)) { seen.add(key); pool.push(c); }
      }
    } catch { /* 見つからなくても続ける */ }
  }
  const ranked = rankCandidates(row, pool);
  return { candidates: ranked.slice(0, 8).map((x) => x.c), best: ranked[0]?.c || null, level: confidence(ranked[0]) };
}

/** 同じ作品を指す行をまとめるための鍵 */
export function workKey(work) {
  const s = work.source;
  if (s.provider !== 'manual' && s.id) return `${s.provider}|${s.id}|${s.seasonNumber ?? ''}`;
  return `manual|${work.type}|${normalizeText(work.title)}|${normalizeText(work.volume)}`;
}
