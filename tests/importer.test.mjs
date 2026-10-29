// まとめて追加の読み取り・当てはめのテスト（点数や感想は架空の例）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportText, parseLine, queriesFor, rankCandidates, matchRow, confidence, aliasFor, workKey } from '../js/importer.js';

test('1行の読み取り：題名・点数・ひとこと・著者・巻', () => {
  assert.deepEqual(
    (({ title, score, comment }) => ({ title, score, comment }))(parseLine('マクロスΔ 70  歌がいい')),
    { title: 'マクロスΔ', score: 70, comment: '歌がいい' },
  );
  assert.equal(parseLine('ゆるキャン  70').title, 'ゆるキャン');
  assert.equal(parseLine('灼熱の卓球娘  60か').score, 60);
  assert.equal(parseLine('モブサイコ100 75').title, 'モブサイコ100');
  assert.equal(parseLine('モブサイコ100 75').score, 75);
  assert.equal(parseLine('ウマ娘 4DX 70').title, 'ウマ娘 4DX');
  assert.equal(parseLine('SSSS.GRIDMAN 70').title, 'SSSS.GRIDMAN');
  assert.equal(parseLine('未来のミライ  40').score, 40);
  assert.equal(parseLine('グレンラガン').score, null);
  const n = parseLine('N  道尾秀介 70 構成が面白い');
  assert.deepEqual([n.title, n.creator, n.score, n.comment], ['N', '道尾秀介', 70, '構成が面白い']);
  const v = parseLine('さよならの言い方なんて知らない。 1巻 / 河野裕 70 続きが気になる');
  assert.deepEqual([v.title, v.volume, v.creator, v.score], ['さよならの言い方なんて知らない。', '1巻', '河野裕', 70]);
  assert.equal(parseLine('アイネクライネ ナハトムジーク / 伊坂幸太郎 70').title, 'アイネクライネ ナハトムジーク');
});

test('かっこの行・「>」の行は直前の作品のメモになる', () => {
  const text = [
    'ヴァイオレットエヴァーがーデン 70 ',
    '（補足の例 60）',
    'working 70',
    '',
    '檸檬先生 / 珠川こおり 70 ひとことの例',
    '> 詳細メモの例',
    '> 二行目',
  ].join('\n');
  const rows = parseImportText(text);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].memo, '（補足の例 60）');
  assert.equal(rows[1].title, 'working');
  assert.equal(rows[2].memo, '詳細メモの例\n二行目');
  assert.equal(rows[2].comment, 'ひとことの例');
});

test('略称・打ち間違いの言い換えと、探す言葉の順番', () => {
  assert.equal(aliasFor('このすば'), 'この素晴らしい世界に祝福を！');
  assert.equal(aliasFor('俺ガイル'), 'やはり俺の青春ラブコメはまちがっている。');
  assert.equal(aliasFor('Steins Gate'), 'シュタインズ・ゲート');
  assert.equal(aliasFor('雀の戸締まり'), 'すずめの戸締まり');
  const q = queriesFor('anime', parseLine('ヴァイオレットエヴァーがーデン 70'));
  assert.equal(q[0], 'ヴァイオレット・エヴァーガーデン');
  assert.ok(q.includes('ヴァイオレットエヴァーガーデン'));
  const b = queriesFor('book', parseLine('ツナグ / 辻村深月 70'));
  assert.equal(b[0], 'ツナグ 辻村深月');
  assert.ok(queriesFor('anime', parseLine('ウマ娘 4DX 70')).includes('ウマ娘'));
});

test('候補の並べ方：題名が近いもの・巻が合うもの・著者が合うもの', () => {
  const row = parseLine('さよならの言い方なんて知らない。 2巻 / 河野裕 70');
  const ranked = rankCandidates(row, [
    { title: 'さよならの言い方なんて知らない。', volume: '1', creator: '河野裕' },
    { title: 'さよならの言い方なんて知らない。', volume: '2巻', creator: '河野裕' },
    { title: 'さよならの言い方', volume: '', creator: '別人' },
  ]);
  assert.equal(ranked[0].c.volume, '2巻');
  const r2 = rankCandidates(parseLine('このすば 70'), [{ title: 'この素晴らしい世界に祝福を！' }, { title: 'この世界の片隅に' }]);
  assert.equal(r2[0].c.title, 'この素晴らしい世界に祝福を！');
  assert.equal(confidence(r2[0]), 'ok');
});

test('著者がまったく違う候補は「見つからない」寄りにする', () => {
  const best = rankCandidates(parseLine('未知の本だよ / 誰か 50'), [{ title: '愛・未知の招き', creator: '瀬戸内晴美' }])[0];
  assert.equal(confidence(best), 'none');
  const ok = rankCandidates(parseLine('かがみの孤城 / 辻村深月 70'), [{ title: 'かがみの孤城', creator: '辻村深月' }])[0];
  assert.equal(confidence(ok), 'ok');
});

test('探して当てはめる：確実な候補が見つかったらそこで止める', async () => {
  const calls = [];
  const search = async (type, q) => {
    calls.push(q);
    if (q === 'ゆるキャン△') return [{ provider: 'tmdb', id: '1', title: 'ゆるキャン△', cover: { url: 'https://x/1.jpg' } }];
    return [];
  };
  const r = await matchRow('anime', parseLine('ゆるキャン 70'), search);
  assert.equal(r.best.title, 'ゆるキャン△');
  assert.equal(r.level, 'ok');
  assert.deepEqual(calls, ['ゆるキャン△']);
  const none = await matchRow('anime', parseLine('存在しないアニメ 50'), async () => []);
  assert.equal(none.level, 'none');
  assert.equal(none.best, null);
});

test('同じ作品をまとめる鍵', () => {
  const a = { type: 'anime', title: 'x', volume: '', source: { provider: 'tmdb', id: '9', seasonNumber: null } };
  const b = { type: 'anime', title: 'y', volume: '', source: { provider: 'tmdb', id: '9', seasonNumber: null } };
  const c = { type: 'anime', title: 'ゆるキャン', volume: '', source: { provider: 'manual', id: null } };
  const d = { type: 'anime', title: 'ゆるキャン', volume: '', source: { provider: 'manual', id: null } };
  assert.equal(workKey(a), workKey(b));
  assert.equal(workKey(c), workKey(d));
});
