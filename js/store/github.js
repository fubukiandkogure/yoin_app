// GitHub を保存先にするアダプタ。
// 記録データは本人の「非公開リポジトリ」内の JSON ファイルに置く（GitHub が本人以外の読み書きを拒否する）。
import { DATA_FILE, SETTINGS_FILE, APP_NAME } from '../config.js';
import { utf8ToBase64, base64ToUtf8 } from '../util.js';
import { StoreError, fetchWithTimeout } from './errors.js';

const API = 'https://api.github.com';

export class GitHubAdapter {
  constructor({ owner, repo, token, fetchImpl }) {
    this.kind = 'github';
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
  }

  async req(method, path, { body, accept = 'application/vnd.github+json', okStatuses = [] } = {}) {
    const res = await fetchWithTimeout(this.fetch, `${API}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok || okStatuses.includes(res.status)) return res;
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch { /* 本文なし */ }
    throw errorFromStatus(res, msg);
  }

  contentsPath(file) {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${encodeURIComponent(file)}`;
  }

  /** 接続確認：トークンが有効か、リポジトリが非公開か、書き込めるか */
  async verify() {
    const userRes = await this.req('GET', '/user');
    const user = await userRes.json();
    const repoRes = await this.req('GET', `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`);
    const repo = await repoRes.json();
    return {
      login: user.login,
      private: repo.private === true,
      canWrite: repo.permissions ? !!(repo.permissions.push || repo.permissions.admin) : null,
    };
  }

  async readFile(file) {
    const res = await this.req('GET', this.contentsPath(file), { okStatuses: [404] });
    if (res.status === 404) return { text: null, sha: null };
    const meta = await res.json();
    if (Array.isArray(meta) || meta.type !== 'file') throw new StoreError('invalid', `${file} がファイルではありません。`);
    // 1MBを超えるファイルは contents API が本文を返さないので blob API で取得する
    if (meta.encoding === 'base64' && typeof meta.content === 'string' && (meta.content || meta.size === 0)) {
      return { text: base64ToUtf8(meta.content), sha: meta.sha };
    }
    const blobRes = await this.req('GET', `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/blobs/${meta.sha}`);
    const blob = await blobRes.json();
    return { text: base64ToUtf8(blob.content), sha: meta.sha };
  }

  async writeFile(file, text, sha, message) {
    try {
      const res = await this.req('PUT', this.contentsPath(file), {
        body: { message, content: utf8ToBase64(text), ...(sha ? { sha } : {}) },
      });
      const json = await res.json();
      return json.content.sha;
    } catch (e) {
      // 409: sha が古い（別端末で更新された） / 422: sha 未指定なのにファイルが存在する
      if (e instanceof StoreError && (e.status === 409 || (e.status === 422 && /sha/i.test(e.detail || '')))) {
        throw new StoreError('conflict', '別の端末で更新されていました。最新の内容を読み込み直します。');
      }
      throw e;
    }
  }

  async load() {
    const { text, sha } = await this.readFile(DATA_FILE);
    if (text === null) return { data: null, version: null };
    try {
      return { data: JSON.parse(text), version: sha };
    } catch {
      throw new StoreError('invalid', `リポジトリの ${DATA_FILE} がJSONとして読めません。上書きを避けるため読み込みを中止しました。`);
    }
  }

  save(data, version, message) {
    return this.writeFile(DATA_FILE, JSON.stringify(data, null, 1), version, `${APP_NAME}: ${message}`);
  }

  async loadSettings() {
    const { text, sha } = await this.readFile(SETTINGS_FILE);
    if (text === null) return { settings: {}, version: null };
    try {
      return { settings: JSON.parse(text) || {}, version: sha };
    } catch {
      return { settings: {}, version: sha };
    }
  }

  saveSettings(settings, version) {
    return this.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 1), version, `${APP_NAME}: 設定を更新`);
  }
}

function errorFromStatus(res, msg) {
  const s = res.status;
  let e;
  if (s === 401) e = new StoreError('auth', 'GitHubのトークンが無効か期限切れです。設定から接続し直してください。');
  else if (s === 403 && res.headers.get('x-ratelimit-remaining') === '0') e = new StoreError('ratelimit', 'GitHubの利用回数の上限に達しました。しばらく待ってから再試行してください。');
  else if (s === 403) e = new StoreError('forbidden', `GitHubで権限が足りません（${msg || '403'}）。トークンの権限を確認してください。`);
  else if (s === 404) e = new StoreError('notfound', 'GitHub上で見つかりません。リポジトリ名とトークンの対象リポジトリを確認してください。');
  else if (s === 409) e = new StoreError('conflict', '別の端末で更新されていました。');
  else if (s === 413) e = new StoreError('toolarge', 'データが大きすぎて保存できません。');
  else if (s === 422) e = new StoreError('invalid', `GitHubが保存を受け付けませんでした（${msg}）。`);
  else if (s >= 500) e = new StoreError('server', `GitHub側で一時的なエラーが起きました（${s}）。再試行してください。`);
  else e = new StoreError('server', `GitHubとの通信でエラーが起きました（${s} ${msg}）。`);
  e.status = s;
  e.detail = msg;
  return e;
}
