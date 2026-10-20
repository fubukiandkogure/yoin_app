# 余韻（仮）

映画・本・アニメを表紙で並べて、そのときの感想を残しておく自分専用の作品棚。
好きな作品を選んで、表紙を並べた画像を作り、LINEなどで送れます。

- セットアップ手順：[SETUP.md](SETUP.md)
- アプリ名の変更：`js/config.js` の `APP_NAME` と、`index.html` の `<title>` / `.brand`

## できること

- 映画・本・アニメを検索して、表紙付きで棚に並べる（見つからなければ手入力）
- 点数（0〜100）・ひとこと・詳細メモ・観た時期・誰とどこで、を何度でも記録（再鑑賞・再読も残る）
- 棚の表示：本棚風／年ごと、大きさ2段階、絞り込み・並べ替え・自分のメモ検索
- 「以前楽しんだ作品」の振り返り、「これから」から1つ選ぶ「何にしよう？」
- 共有画像：1〜9作品を選んで、縦長（作品名・点数・おすすめの一言）または正方形（表紙中心）、生成り／夜の2色
- 明るい／暗い表示、ホーム画面に追加してアプリのように使える（オフラインでも前回の記録を表示）

## 構成

ビルド不要の静的サイトです（HTML / CSS / ES Modules）。GitHub Pages にそのまま置けます。

| 役割 | 仕組み |
| --- | --- |
| 記録の保存 | 本人の **非公開GitHubリポジトリ** の `yoin-data.json`（GitHub Contents API） |
| ログイン | リポジトリを1つだけ読み書きできる Fine-grained token（端末のブラウザに保存） |
| 本人以外のアクセス | 非公開リポジトリなので GitHub 側で拒否される |
| 別端末での同期 | 同じリポジトリを読み書き。同時に保存したときは最新を読み直して変更を再適用 |
| 作品検索 | TMDB（映画・アニメ）、Google Books ＋ openBD（本）。キーは非公開リポジトリの `yoin-settings.json` |
| 共有 | 選んだ作品の表紙・作品名・おすすめの一言・点数を描いた PNG を端末で作成。保存または共有シートで送信 |
| 試用モード | ブラウザ内（localStorage）だけに保存。別端末では見られない |
| 起動の速さ | 前回読み込んだ記録を端末に残し、すぐ表示してから裏で GitHub と同期（`yoin.cache`） |
| 更新・オフライン | `sw.js` がアプリのファイルを毎回サーバーに確認し、通信できないときだけ控えを使う |

```
index.html         画面の枠
css/style.css      見た目
js/config.js       アプリ名などの定数
js/model.js        データ構造・検証・バックアップ・棚の絞り込み・振り返り・画像用データ
js/png.js          共有画像（PNG）の描画
js/store/          保存先（github.js / local.js）と読み書き窓口（repo.js）
js/search/         検索（tmdb.js / books.js）。取得元の差し替えは index.js
js/ui/             各画面（icons.js はアイコン）
js/prefs.js        端末ごとの表示設定（テーマ・棚の表示）
sw.js              Service Worker（ファイルの更新確認とオフライン用の控え）
tools/make_icons.py  ホーム画面アイコン（icons/*.png）の生成
tests/             自動テスト（node --test）
```

## 開発

```bash
python -m http.server 8765
```

http://localhost:8765/ を開きます（ES Modules のため `file://` では動きません）。

```bash
npm test
```

## 共有画像と非公開データ

画像には `buildImageData()`（`js/model.js`）が取り出した項目だけを描きます。
ひとこと感想・詳細メモ・誰と観たか・タグ・状態は渡さないので、画像に入ることはありません（テストで確認しています）。
アプリから外部に公開されるデータはありません。送った画像は取り消せない点だけ注意してください。

表紙の書き出しには CORS が必要です。TMDB の画像は対応しています。Google Books など非対応の画像は、設定で許可されていれば
画像変換サービス wsrv.nl を経由して読み込み（送られるのは表紙画像のURLだけ）、読めなければ仮表紙で描きます。

## クレジット

This product uses the TMDB API but is not endorsed or certified by TMDB.
書誌情報・書影：Google Books、openBD（版元ドットコム）。
