// 保存・通信のエラー。kind で画面の出し分けをする。
export class StoreError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.kind = kind; // auth | forbidden | ratelimit | notfound | conflict | network | timeout | server | invalid | toolarge
    this.detail = detail;
  }
}

export function describeError(e) {
  if (e instanceof StoreError) return e.message;
  if (e?.name === 'AbortError') return '通信がタイムアウトしました。';
  return e?.message || `予期しないエラーが発生しました：${e}`;
}

const DEFAULT_TIMEOUT = 20000;

/** fetch のラッパー。通信失敗・タイムアウトを StoreError にする。 */
export async function fetchWithTimeout(fetchImpl, url, opts = {}, timeout = DEFAULT_TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetchImpl(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new StoreError('timeout', '通信がタイムアウトしました。電波の状態を確認して再試行してください。');
    throw new StoreError('network', '通信できませんでした。インターネット接続を確認して再試行してください。', e);
  } finally {
    clearTimeout(t);
  }
}
