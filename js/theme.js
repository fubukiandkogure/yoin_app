// 画面のちらつきを防ぐため、最初に読み込む通常スクリプト（モジュールではない）。
// 端末ごとの表示設定（テーマ）を <html data-theme> に反映する。
(function () {
  var pref = 'auto';
  try { pref = localStorage.getItem('yoin.theme') || 'auto'; } catch (e) { /* 保存不可でも動く */ }
  var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pref', pref);
})();
