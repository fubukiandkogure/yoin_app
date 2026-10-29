import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyData, validateData, makeBackup, parseBackup, buildImageData, filterAndSort, shelfEntries, flashback, findDuplicates, latestExperience,
} from '../js/model.js';
import { makeExpDate, isValidExpDate, expDateSortKey, utf8ToBase64, base64ToUtf8, parseTags } from '../js/util.js';

const T0 = '2025-01-10T10:00:00.000Z';
const work = (id, extra = {}) => ({
  id, type: 'movie', title: `作品${id}`, creator: '', year: 2020, volume: '',
  source: { provider: 'manual', id: null, mediaType: null, seasonNumber: null, isbn: null },
  cover: { url: null, provider: null, credit: null, missingReason: 'manual' },
  status: 'done', favorite: false, tags: [], createdAt: T0, updatedAt: T0, ...extra,
});
const exp = (id, workId, extra = {}) => ({
  id, workId, score: null, comment: '', memo: '', date: { precision: 'unknown', value: null }, note: '',
  createdAt: T0, updatedAt: T0, ...extra,
});
const sample = () => ({
  ...emptyData(),
  works: [work('w1', { cover: { url: 'https://image.tmdb.org/t/p/w342/a.jpg', provider: 'tmdb', credit: '画像・作品情報：TMDB', missingReason: null } }), work('w2')],
  experiences: [
    exp('e1', 'w1', { score: 60, comment: '昔の感想', memo: '秘密のメモA', note: '一人で', createdAt: '2024-01-01T00:00:00Z' }),
    exp('e2', 'w1', { score: 92, comment: '再鑑賞の感想', memo: '秘密のメモB', note: '恋人と映画館', createdAt: '2025-02-01T00:00:00Z' }),
  ],
  shelves: [{ id: 's1', title: '自分を構成する作品', items: [{ workId: 'w1', recommendation: 'ぜひ観て' }, { workId: 'w2', recommendation: '' }], options: { showTitle: false, showWorkTitle: true, showRecommendation: true, showScore: true }, createdAt: T0, updatedAt: T0 }],
});

test('体験時期：年月日／年月／年／不明を区別し、今日で埋めない', () => {
  assert.deepEqual(makeExpDate('', '', ''), { precision: 'unknown', value: null });
  assert.deepEqual(makeExpDate('2023', '', ''), { precision: 'year', value: '2023' });
  assert.deepEqual(makeExpDate('2023', '4', ''), { precision: 'month', value: '2023-04' });
  assert.deepEqual(makeExpDate('2023', '4', '9'), { precision: 'day', value: '2023-04-09' });
  assert.equal(makeExpDate('2023', '2', '30').precision, 'month'); // 存在しない日
  assert.ok(isValidExpDate({ precision: 'day', value: '2024-02-29' }));
  assert.ok(!isValidExpDate({ precision: 'day', value: '2023-02-29' }));
  assert.ok(expDateSortKey({ precision: 'year', value: '2023' }) < expDateSortKey({ precision: 'month', value: '2023-04' }));
});

test('点数：0点と未採点を区別し、範囲外や小数は不正', () => {
  const d = sample();
  d.experiences[0].score = 0;
  assert.ok(validateData(d).ok);
  assert.equal(validateData(d).data.experiences[0].score, 0);
  d.experiences[0].score = null;
  assert.equal(validateData(d).data.experiences[0].score, null);
  for (const bad of [101, -1, 50.5, '80']) {
    d.experiences[0].score = bad;
    assert.equal(validateData(d).ok, false, `score=${bad}`);
  }
});

test('点数・感想なしの作品だけでも有効', () => {
  const d = { ...emptyData(), works: [work('w1')] };
  assert.ok(validateData(d).ok);
});

test('最新の体験記録は最後に記録したもの。古い記録も残る', () => {
  const d = sample();
  assert.equal(latestExperience(d, 'w1').id, 'e2');
  assert.equal(d.experiences.filter((e) => e.workId === 'w1').length, 2);
});

test('共有画像のデータに非公開の項目（感想・メモ・誰と）を含めない', () => {
  const d = sample();
  const img = buildImageData(d, d.shelves[0]);
  const text = JSON.stringify(img);
  for (const secret of ['昔の感想', '再鑑賞の感想', '秘密のメモA', '秘密のメモB', '一人で', '恋人と映画館']) {
    assert.ok(!text.includes(secret), `含まれてはいけない: ${secret}`);
  }
  assert.equal(img.items[0].recommendation, 'ぜひ観て');
  assert.equal(img.items[0].score, 92);
  assert.equal(img.title, ''); // 棚のタイトルは初期設定では載せない
  const hidden = buildImageData(d, { ...d.shelves[0], options: { showTitle: true, showWorkTitle: true, showRecommendation: false, showScore: false } });
  assert.equal(hidden.items[0].score, null);
  assert.equal(hidden.items[0].recommendation, '');
  assert.equal(hidden.title, '自分を構成する作品');
});

test('棚は9作品まで・重複不可・存在しない作品は不可', () => {
  const d = sample();
  d.works = Array.from({ length: 10 }, (_, i) => work(`x${i}`));
  d.experiences = [];
  d.shelves[0].items = d.works.map((w) => ({ workId: w.id, recommendation: '' }));
  assert.equal(validateData(d).ok, false);
  const d2 = sample();
  d2.shelves[0].items.push({ workId: 'w1', recommendation: '' });
  assert.equal(validateData(d2).ok, false);
  const d3 = sample();
  d3.shelves[0].items.push({ workId: 'nope', recommendation: '' });
  assert.equal(validateData(d3).ok, false);
});

test('バックアップの書き出し→読み込みで同じ内容に戻る', () => {
  const d = validateData(sample()).data;
  const text = JSON.stringify(makeBackup(d));
  const r = parseBackup(text);
  assert.ok(r.ok);
  assert.deepEqual(r.counts, { works: 2, experiences: 2, shelves: 1 });
  assert.deepEqual(r.data.works, d.works);
  assert.deepEqual(r.data.experiences, d.experiences);
  assert.deepEqual(r.data.shelves, d.shelves);
});

test('壊れたバックアップは取り込まない', () => {
  const good = JSON.stringify(makeBackup(validateData(sample()).data));
  assert.equal(parseBackup(good.slice(0, good.length - 10)).ok, false); // 途中で切れたJSON
  assert.equal(parseBackup('{"hello":1}').ok, false); // 別のファイル
  const obj = JSON.parse(good);
  obj.data.experiences[0].workId = 'missing';
  assert.equal(parseBackup(JSON.stringify(obj)).ok, false); // 参照切れ
  const obj2 = JSON.parse(good);
  obj2.schemaVersion = obj2.data.schemaVersion = 99;
  assert.match(parseBackup(JSON.stringify(obj2)).errors[0], /新しいバージョン/);
});

test('検索：タイトルと自分のメモで探せる。並べ替えで未採点は末尾', () => {
  const d = sample();
  d.works.push(work('w3', { title: 'ノルウェイの森', type: 'book' }));
  d.experiences.push(exp('e3', 'w3', { score: 70 }));
  const entries = shelfEntries(d);
  assert.deepEqual(filterAndSort(entries, { q: '秘密のメモB' }).map((e) => e.work.id), ['w1']);
  assert.deepEqual(filterAndSort(entries, { q: 'ノルウェイ' }).map((e) => e.work.id), ['w3']);
  assert.deepEqual(filterAndSort(entries, { type: 'book' }).map((e) => e.work.id), ['w3']);
  assert.deepEqual(filterAndSort(entries, { sort: 'score' }).map((e) => e.work.id), ['w1', 'w3', 'w2']);
});

test('振り返り：3か月以上前の楽しんだ作品だけ。時期不明は記録日で判定', () => {
  const d = sample();
  const now = new Date('2025-03-01T00:00:00Z');
  // e2 は 2025-02-01 記録（時期不明）なので1か月前 → 候補外
  assert.equal(flashback(d, now).length, 0);
  const later = new Date('2025-06-15T00:00:00Z');
  assert.deepEqual(flashback(d, later).map((x) => x.work.id), ['w1']);
  // 時期が分かっていればそちらを使う
  d.experiences[1].date = { precision: 'month', value: '2025-05' };
  assert.equal(flashback(d, later).length, 0);
  // 楽しんでいない（低い点・ひとことなし・お気に入りでない）作品は出さない
  d.experiences[1] = { ...d.experiences[1], date: { precision: 'year', value: '2020' }, score: 30, comment: '' };
  assert.equal(flashback(d, later).length, 0);
});

test('重複：同じ外部IDとシーズン、または同じ種別・タイトル・巻', () => {
  const d = sample();
  d.works[0].source = { provider: 'tmdb', id: '100', mediaType: 'tv', seasonNumber: 1, isbn: null };
  assert.equal(findDuplicates(d, { type: 'anime', title: 'x', volume: '', source: { provider: 'tmdb', id: '100', seasonNumber: 1 } }).length, 1);
  assert.equal(findDuplicates(d, { type: 'anime', title: 'x', volume: '', source: { provider: 'tmdb', id: '100', seasonNumber: 2 } }).length, 0);
  assert.equal(findDuplicates(d, { type: 'movie', title: '作品 w2', volume: '', source: { provider: 'manual' } }).length, 1);
});

test('UTF-8 の base64 変換（GitHub 保存用）', () => {
  const s = '余韻🎬テスト\n'.repeat(5000);
  assert.equal(base64ToUtf8(utf8ToBase64(s)), s);
});

test('タグの分割', () => {
  assert.deepEqual(parseTags('#SF、泣ける 泣ける,家族'), ['SF', '泣ける', '家族']);
});

test('openBD の著者・書名の整形', async () => {
  const { cleanOpenbdAuthor, splitOpenbdTitle } = await import('../js/search/books.js');
  assert.equal(cleanOpenbdAuthor('村上,春樹,1949-'), '村上春樹');
  assert.equal(cleanOpenbdAuthor('東野,圭吾,1958-／著 山田,太郎／訳'), '東野圭吾、山田太郎');
  assert.deepEqual(splitOpenbdTitle('ノルウェイの森. 上', ''), { title: 'ノルウェイの森', volume: '上' });
  assert.deepEqual(splitOpenbdTitle('コンビニ人間', ''), { title: 'コンビニ人間', volume: '' });
});

test('年ごとの棚：新しい年から、時期不明は最後', async () => {
  const { groupByYear } = await import('../js/model.js');
  const e = (id, value) => ({ work: { id }, latest: value === undefined ? null : { date: value ? { precision: 'year', value } : { precision: 'unknown', value: null } } });
  const groups = groupByYear([e('a', '2021'), e('b', null), e('c', '2024'), e('d'), e('f', '2021')]);
  assert.deepEqual(groups.map((g) => g.label), ['2024年', '2021年', '時期不明']);
  assert.deepEqual(groups[1].items.map((x) => x.work.id), ['a', 'f']);
  assert.deepEqual(groups[2].items.map((x) => x.work.id), ['b', 'd']);
});

test('共有画像のテーマとレイアウト：初期値・不正な値', () => {
  const d = sample();
  delete d.shelves[0].options.theme;
  const r = validateData(d);
  assert.ok(r.ok);
  assert.equal(r.data.shelves[0].options.theme, 'paper');
  assert.equal(r.data.shelves[0].options.layout, 'tall');
  d.shelves[0].options.layout = 'circle';
  assert.equal(validateData(d).ok, false);
  d.shelves[0].options.layout = 'square';
  d.shelves[0].options.theme = 'night';
  assert.ok(validateData(d).ok);
});

test('本の検索：ISBN変換・著者名の整形・表記ゆれに強い並べ替え', async () => {
  const { toIsbn13, cleanNdlCreator, similarity, mergeBookResults } = await import('../js/search/books.js');
  assert.equal(toIsbn13('978-4-10-180262-6'), '9784101802626');
  assert.equal(toIsbn13('4062748681'), '9784062748681');
  assert.equal(cleanNdlCreator('杉井, 光'), '杉井光');
  assert.equal(cleanNdlCreator('村上, 春樹, 1949-'), '村上春樹');
  assert.equal(cleanNdlCreator('Andersen, Hans Christian, 1805-1875'), 'Hans Christian Andersen');
  const q = '世界でいちばん透き通った物語';
  assert.ok(similarity(q, '世界でいちばん透きとおった物語') > similarity(q, '世界でいちばん美しい数学'));
  const merged = mergeBookResults(q, [
    [
      { title: '世界でいちばん美しい数学', volume: '', isbn: '9784000000001', cover: null },
      { title: '世界でいちばん透きとおった物語', volume: '2', isbn: '9784101803005', cover: null },
      { title: '世界でいちばん透きとおった物語', volume: '', isbn: '9784101802626', cover: null },
    ],
    [{ title: '世界でいちばん透きとおった物語', volume: '', isbn: '9784101802626', cover: { url: 'https://x/y.jpg' } }],
  ]);
  assert.equal(merged.length, 3); // 同じISBNは1件に
  assert.equal(merged[0].isbn, '9784101802626'); // 巻なしの本編が先頭
  assert.equal(merged[0].cover.url, 'https://x/y.jpg'); // 表紙は別の提供元から補われる
  assert.equal(merged[2].title, '世界でいちばん美しい数学');
});

test('表記ゆれに強い検索語', async () => {
  const { fuzzyTokens } = await import('../js/search/books.js');
  assert.deepEqual(fuzzyTokens('世界でいちばん透き通った物語'), ['世界', 'でいちばん', '物語']);
  assert.deepEqual(fuzzyTokens('ハリー・ポッターと賢者の石'), ['ハリー・ポッター', '賢者']);
});

test('巻の表記だけを残す', async () => {
  const { cleanVolume } = await import('../js/search/books.js');
  for (const ok of ['2', '上', '第3巻', ': 下', 'Vol.4', '１２']) assert.notEqual(cleanVolume(ok), '', ok);
  for (const ng of ['す-31-2. nex', '新潮文庫', 'あ-1']) assert.equal(cleanVolume(ng), '', ng);
});

test('Google の代替画像（表紙なし）を見分ける', async () => {
  const { isGooglePlaceholderSize, googleCoverByIsbn } = await import('../js/search/books.js');
  const u = googleCoverByIsbn('9784101802626');
  assert.equal(isGooglePlaceholderSize(u, 128, 170), true);
  assert.equal(isGooglePlaceholderSize(u, 128, 184), true);
  assert.equal(isGooglePlaceholderSize(u, 300, 427), false);
  assert.equal(isGooglePlaceholderSize('https://image.tmdb.org/t/p/w342/a.jpg', 128, 170), false);
});
