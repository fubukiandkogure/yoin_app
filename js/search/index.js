// 検索の窓口。取得元を差し替えるときはここの対応表を変える。
// どの取得元が使えなくても、画面側の「手入力で登録」は常に動く。
import { searchTmdb, resolveTmdb } from './tmdb.js';
import { searchBooks, resolveBook } from './books.js';

const providers = {
  movie: { label: 'TMDB', search: (q, s) => searchTmdb('movie', q, s.tmdbKey), resolve: (c, s) => resolveTmdb(c, s.tmdbKey) },
  anime: { label: 'TMDB', search: (q, s) => searchTmdb('anime', q, s.tmdbKey), resolve: (c, s) => resolveTmdb(c, s.tmdbKey) },
  book: { label: '国立国会図書館サーチ / Google Books / openBD', search: (q, s) => searchBooks(q, s.googleBooksKey), resolve: (c) => resolveBook(c) },
};

export const providerLabel = (type) => providers[type].label;
export const searchWorks = (type, query, settings) => providers[type].search(query, settings || {});
export const resolveCandidate = (cand, settings) => providers[cand.type].resolve(cand, settings || {});
