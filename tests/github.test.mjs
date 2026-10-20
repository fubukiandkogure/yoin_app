// GitHub Contents API を模した偽サーバーで、保存・競合・認証エラー・壊れたデータの扱いを確かめる。
// （本物の GitHub への接続は、各自のトークンで SETUP.md の手順に沿って確認する）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubAdapter } from '../js/store/github.js';
import { Repo } from '../js/store/repo.js';
import { utf8ToBase64, base64ToUtf8 } from '../js/util.js';
import { emptyData } from '../js/model.js';

function fakeGitHub({ token = 'good', private: isPrivate = true } = {}) {
  const files = new Map(); // path -> {text, sha}
  let n = 0;
  const calls = [];
  const res = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    calls.push(`${method} ${u.pathname}`);
    if (opts.headers.Authorization !== `Bearer ${token}`) return res(401, { message: 'Bad credentials' });
    if (u.pathname === '/user') return res(200, { login: 'me' });
    if (u.pathname === '/repos/me/data') return res(200, { private: isPrivate, permissions: { push: true } });
    const m = u.pathname.match(/^\/repos\/me\/data\/contents\/(.+)$/);
    if (!m) return res(404, { message: 'Not Found' });
    const path = decodeURIComponent(m[1]);
    const f = files.get(path);
    if (method === 'GET') {
      if (!f) return res(404, { message: 'Not Found' });
      return res(200, { type: 'file', encoding: 'base64', content: utf8ToBase64(f.text), sha: f.sha, size: f.text.length });
    }
    if (method === 'PUT') {
      const body = JSON.parse(opts.body);
      if (f && !body.sha) return res(422, { message: 'Invalid request. "sha" wasn\'t supplied.' });
      if (f && body.sha !== f.sha) return res(409, { message: 'is at abc but expected def' });
      const sha = `sha${++n}`;
      files.set(path, { text: base64ToUtf8(body.content), sha });
      return res(f ? 200 : 201, { content: { sha } });
    }
    return res(405, {});
  };
  return { fetchImpl, files, calls };
}

const T = '2025-01-01T00:00:00.000Z';
const newWork = (id, title) => ({
  id, type: 'book', title, creator: '', year: null, volume: '',
  source: { provider: 'manual', id: null, mediaType: null, seasonNumber: null, isbn: null },
  cover: { url: null, provider: null, credit: null, missingReason: 'manual' },
  status: 'done', favorite: false, tags: [], createdAt: T, updatedAt: T,
});

test('リポジトリにファイルがなければ空の棚から始まり、保存すると作られる', async () => {
  const gh = fakeGitHub();
  const repo = new Repo(new GitHubAdapter({ owner: 'me', repo: 'data', token: 'good', fetchImpl: gh.fetchImpl }));
  await repo.init();
  assert.deepEqual(repo.data.works, []);
  await repo.mutate('追加', (d) => { d.works.push(newWork('w1', '本1')); });
  const saved = JSON.parse(gh.files.get('yoin-data.json').text);
  assert.equal(saved.works[0].title, '本1');
  // 再読み込み（別端末）でも同じ内容
  const other = new Repo(new GitHubAdapter({ owner: 'me', repo: 'data', token: 'good', fetchImpl: gh.fetchImpl }));
  await other.init();
  assert.equal(other.data.works[0].title, '本1');
});

test('別端末で更新されていたら、最新を読み直して変更を再適用する（上書きしない）', async () => {
  const gh = fakeGitHub();
  const mk = () => new Repo(new GitHubAdapter({ owner: 'me', repo: 'data', token: 'good', fetchImpl: gh.fetchImpl }));
  const phone = mk();
  const pc = mk();
  await phone.init();
  await pc.init();
  await phone.mutate('スマホで追加', (d) => { d.works.push(newWork('w1', 'スマホの本')); });
  await pc.mutate('PCで追加', (d) => { d.works.push(newWork('w2', 'PCの本')); });
  const saved = JSON.parse(gh.files.get('yoin-data.json').text);
  assert.deepEqual(saved.works.map((w) => w.title), ['スマホの本', 'PCの本']);
});

test('保存失敗は例外になり、手元のデータも変わらない', async () => {
  const gh = fakeGitHub();
  const adapter = new GitHubAdapter({ owner: 'me', repo: 'data', token: 'good', fetchImpl: gh.fetchImpl });
  const repo = new Repo(adapter);
  await repo.init();
  adapter.token = 'expired';
  await assert.rejects(repo.mutate('追加', (d) => { d.works.push(newWork('w1', 'x')); }), (e) => e.kind === 'auth');
  assert.equal(repo.data.works.length, 0);
  assert.equal(gh.files.size, 0);
});

test('通信できないときは network エラー', async () => {
  const adapter = new GitHubAdapter({ owner: 'me', repo: 'data', token: 'good', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(new Repo(adapter).init(), (e) => e.kind === 'network');
});

test('保存先のデータが壊れていたら読み込みを止め、空として上書きしない', async () => {
  const gh = fakeGitHub();
  gh.files.set('yoin-data.json', { text: '{"schemaVersion":1, "works": [', sha: 'x1' });
  const repo = new Repo(new GitHubAdapter({ owner: 'me', repo: 'data', token: 'good', fetchImpl: gh.fetchImpl }));
  await assert.rejects(repo.init(), (e) => e.kind === 'invalid');
  assert.equal(gh.files.get('yoin-data.json').sha, 'x1');
});

test('復元は1回の保存で全体を置き換える。不正なデータなら何も保存しない', async () => {
  const gh = fakeGitHub();
  const repo = new Repo(new GitHubAdapter({ owner: 'me', repo: 'data', token: 'good', fetchImpl: gh.fetchImpl }));
  await repo.init();
  await repo.mutate('追加', (d) => { d.works.push(newWork('old', '古い')); });
  const before = gh.files.get('yoin-data.json').sha;
  const bad = { ...emptyData(), works: [{ ...newWork('n1', '') }] }; // タイトル空は不正
  await assert.rejects(repo.restore(bad));
  assert.equal(gh.files.get('yoin-data.json').sha, before);
  await repo.restore({ ...emptyData(), works: [newWork('n1', '新しい')] });
  const saved = JSON.parse(gh.files.get('yoin-data.json').text);
  assert.deepEqual(saved.works.map((w) => w.title), ['新しい']);
});

test('接続確認：公開リポジトリかどうかを返す', async () => {
  const gh = fakeGitHub({ private: false });
  const info = await new GitHubAdapter({ owner: 'me', repo: 'data', token: 'good', fetchImpl: gh.fetchImpl }).verify();
  assert.equal(info.private, false);
  assert.equal(info.login, 'me');
});
