// TMDB（映画・アニメ）。APIキーは保存先の非公開設定から読み込む（コードには埋め込まない）。
import { StoreError, fetchWithTimeout } from '../store/errors.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
export const TMDB_CREDIT = '画像・作品情報：TMDB';
const ANIMATION_GENRE = 16;

export const tmdbImage = (path, size = 'w342') => (path ? `${IMG}${size}${path}` : null);

async function call(path, params, key) {
  if (!key) throw new StoreError('auth', 'TMDBのAPIキーが未設定です（設定画面で登録できます）。');
  const url = new URL(API + path);
  const headers = { Accept: 'application/json' };
  // v4 の読み取りアクセストークン（eyJ...）なら Bearer、v3 の API キーならクエリに付ける
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchWithTimeout(fetch, url.href, { headers });
  if (res.status === 401) throw new StoreError('auth', 'TMDBのAPIキーが正しくありません。設定を確認してください。');
  if (res.status === 429) throw new StoreError('ratelimit', 'TMDBの検索回数の上限に達しました。少し待ってください。');
  if (!res.ok) throw new StoreError('server', `TMDBの検索に失敗しました（${res.status}）。`);
  return res.json();
}

const yearOf = (d) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

function movieCandidate(m, type) {
  return {
    provider: 'tmdb',
    id: String(m.id),
    mediaType: 'movie',
    type,
    title: m.title || m.original_title || '',
    originalTitle: m.original_title !== m.title ? m.original_title : '',
    year: yearOf(m.release_date),
    creator: '',
    volume: '',
    cover: m.poster_path ? { url: tmdbImage(m.poster_path), thumb: tmdbImage(m.poster_path, 'w154'), provider: 'tmdb', credit: TMDB_CREDIT } : null,
    extra: type === 'anime' ? 'アニメ映画' : '映画',
    isAnimation: (m.genre_ids || []).includes(ANIMATION_GENRE),
  };
}

function tvCandidate(t, type) {
  return {
    provider: 'tmdb',
    id: String(t.id),
    mediaType: 'tv',
    type,
    title: t.name || t.original_name || '',
    originalTitle: t.original_name !== t.name ? t.original_name : '',
    year: yearOf(t.first_air_date),
    creator: '',
    volume: '',
    cover: t.poster_path ? { url: tmdbImage(t.poster_path), thumb: tmdbImage(t.poster_path, 'w154'), provider: 'tmdb', credit: TMDB_CREDIT } : null,
    extra: 'TVシリーズ',
    isAnimation: (t.genre_ids || []).includes(ANIMATION_GENRE),
    needsSeason: true,
  };
}

export async function searchTmdb(type, query, key) {
  const base = { query, language: 'ja-JP', include_adult: 'false' };
  if (type === 'movie') {
    const r = await call('/search/movie', base, key);
    return r.results.map((m) => movieCandidate(m, 'movie'));
  }
  // アニメ：TVシリーズとアニメ映画を両方探し、アニメ作品を優先する
  const [tv, mv] = await Promise.all([call('/search/tv', base, key), call('/search/movie', base, key)]);
  const all = [...tv.results.map((t) => tvCandidate(t, 'anime')), ...mv.results.map((m) => movieCandidate(m, 'anime'))];
  const anime = all.filter((c) => c.isAnimation);
  return anime.length ? anime : all;
}

/** 選択した候補の詳細（監督・制作・シーズン一覧）を取得する */
export async function resolveTmdb(cand, key) {
  if (cand.mediaType === 'movie') {
    const m = await call(`/movie/${cand.id}`, { language: 'ja-JP', append_to_response: 'credits' }, key);
    const directors = (m.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
    return { ...cand, creator: directors.join('、') || (m.production_companies?.[0]?.name ?? ''), seasons: null };
  }
  const t = await call(`/tv/${cand.id}`, { language: 'ja-JP' }, key);
  const creator = (t.created_by || []).map((c) => c.name).join('、') || (t.production_companies?.[0]?.name ?? '');
  const seasons = (t.seasons || [])
    .filter((s) => s.season_number > 0 || (t.seasons || []).length === 1)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name || `シーズン${s.season_number}`,
      year: yearOf(s.air_date),
      episodes: s.episode_count,
      cover: s.poster_path ? { url: tmdbImage(s.poster_path), thumb: tmdbImage(s.poster_path, 'w154'), provider: 'tmdb', credit: TMDB_CREDIT } : null,
    }));
  return { ...cand, creator, seasons };
}
