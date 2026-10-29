// 設定：保存先（GitHub／試用）、検索APIキー、画像、バックアップの書き出しと復元、クレジット。
import { APP_NAME, DATA_FILE, SETTINGS_FILE } from '../config.js';
import { html, formatDateTime } from '../util.js';
import { makeBackup, parseBackup, validateData } from '../model.js';
import { getConnection, setConnection, clearConnection, clearCache } from '../store/repo.js';
import { THEMES, getTheme, setTheme } from '../prefs.js';
import { GitHubAdapter } from '../store/github.js';
import { describeError } from '../store/errors.js';
import { toast, confirmDialog, downloadBlob } from './components.js';

export async function renderWelcome(ctx) {
  ctx.main.innerHTML = String(html`<section class="page welcome">
    <div class="ripple-hero" aria-hidden="true"><i></i><i></i><i></i><b></b></div>
    <h1 class="welcome-title">${APP_NAME}<span class="num">yoin</span></h1>
    <div class="welcome-sub">A private archive of afterglow</div>
    <p class="lead">観た映画、読んだ本、アニメ。<br>そのときの感想を、表紙と一緒に残しておく自分だけの棚。</p>
    <div class="welcome-actions">
      <a class="btn primary wide" href="#/settings">GitHubに保存して始める</a>
      <button type="button" class="btn wide" data-act="trial">まず試してみる（この端末だけに保存）</button>
    </div>
    <p class="hint">GitHubに保存すると、スマホとPCなど別の端末でも同じ記録を見られます。準備の手順は SETUP.md にあります。</p>
  </section>`);
  ctx.main.querySelector('[data-act="trial"]').addEventListener('click', () => {
    setConnection({ mode: 'trial' });
    ctx.reconnect().then(() => ctx.navigate('/', { replace: true }));
  });
}

export async function render(ctx) {
  const conn = getConnection();
  const repo = conn ? ctx.repo : null;
  const ready = !!(repo && repo.data && repo.loadedAt);
  const s = ready ? repo.settings : {};

  ctx.main.innerHTML = String(html`<section class="page settings">
    <div class="kicker">Settings</div>
    <h1 class="page-title">設定</h1>

    <section class="card">
      <h2 class="section-title">保存先</h2>
      ${conn?.mode === 'github' ? html`<p>GitHub：<strong>${conn.owner}/${conn.repo}</strong>（非公開リポジトリ）</p>
        <p class="hint">記録は ${DATA_FILE}、APIキーなどは ${SETTINGS_FILE} に保存されます。</p>`
        : conn?.mode === 'trial' ? html`<p class="warn-box">試用モード：記録はこの端末のブラウザにだけ保存されています。別の端末では見られず、ブラウザのデータを消すと失われます。続けて使うなら、下のバックアップで書き出してからGitHubに接続し、復元してください。</p>`
        : html`<p>まだ保存先が設定されていません。</p>`}

      <details class="connect" ${conn?.mode === 'github' ? '' : 'open'}>
        <summary>${conn?.mode === 'github' ? 'GitHubの接続を変更' : 'GitHubに接続する'}</summary>
        <form class="connect-form" autocomplete="off">
          <p class="hint">GitHubで<strong>非公開（Private）</strong>のリポジトリを作り、そのリポジトリだけに「Contents: Read and write」を許可した Fine-grained token を発行して入力してください（手順は SETUP.md）。トークンはこの端末のブラウザにだけ保存されます。</p>
          <label class="field"><span class="label">GitHubのユーザー名</span><input name="owner" value="${conn?.owner || ''}" required autocapitalize="off" spellcheck="false"></label>
          <label class="field"><span class="label">リポジトリ名</span><input name="repo" value="${conn?.repo || 'yoin-data'}" required autocapitalize="off" spellcheck="false"></label>
          <label class="field"><span class="label">トークン</span><input name="token" type="password" value="" placeholder="${conn?.mode === 'github' ? '変更する場合のみ入力' : 'github_pat_...'}" autocapitalize="off" spellcheck="false"></label>
          <div class="form-error" role="alert" hidden></div>
          <button type="submit" class="btn primary">接続を確認して保存</button>
        </form>
      </details>
      <div class="btn-row">
        ${conn?.mode !== 'trial' ? html`<button type="button" class="btn small ghost" data-act="trial">試用モードに切り替える</button>` : ''}
        ${conn ? html`<button type="button" class="btn small ghost danger-text" data-act="disconnect">この端末の接続を解除</button>` : ''}
      </div>
    </section>

    ${ready ? html`<section class="card">
      <h2 class="section-title">作品検索のAPIキー</h2>
      <p class="hint">保存先（${conn.mode === 'github' ? '非公開リポジトリ' : 'この端末'}）に保存され、公開コードには含まれません。</p>
      <form class="keys-form" autocomplete="off">
        <label class="field"><span class="label">TMDB（映画・アニメ） ${s.tmdbKey ? html`<em class="ok">設定済み</em>` : html`<em class="req">未設定</em>`}</span>
          <input name="tmdbKey" type="password" placeholder="${s.tmdbKey ? '変更する場合のみ入力' : 'APIキー または 読み取りアクセストークン'}" spellcheck="false"></label>
        <label class="field"><span class="label">Google Books（本） ${s.googleBooksKey ? html`<em class="ok">設定済み</em>` : html`<em class="muted">任意・未設定</em>`}</span>
          <input name="googleBooksKey" type="password" placeholder="${s.googleBooksKey ? '変更する場合のみ入力' : '未設定でも検索できますが不安定です'}" spellcheck="false"></label>
        <div class="btn-row">
          <button type="submit" class="btn primary small">保存</button>
          ${s.tmdbKey || s.googleBooksKey ? html`<button type="button" class="btn small ghost" data-act="clear-keys">キーを削除</button>` : ''}
        </div>
      </form>
    </section>

    <section class="card">
      <h2 class="section-title">共有画像</h2>
      <label class="check"><input type="checkbox" name="coverProxy" ${s.coverProxy !== false ? 'checked' : ''}>
        <span>表紙を直接読み込めないとき、画像変換サービス（wsrv.nl）を経由する</span></label>
      <p class="hint">Google Booksなど一部の表紙は、そのままでは画像に書き出せません。経由するときは表紙画像のURLだけが wsrv.nl に送られます。オフにすると、その作品は仮表紙で描かれます。</p>
    </section>

    <section class="card">
      <h2 class="section-title">バックアップ</h2>
      <p class="hint">作品・記録・共有画像の設定をすべてJSONファイルに書き出します（APIキーは含みません）。</p>
      <button type="button" class="btn" data-act="export">JSONを書き出す</button>
      <h3 class="sub-title">復元</h3>
      <p class="hint">バックアップから復元すると、今の記録はすべて置き換わります。</p>
      <label class="btn file-btn">JSONファイルを選ぶ<input type="file" accept="application/json,.json" hidden></label>
      <div class="restore-preview" aria-live="polite"></div>
    </section>` : ''}

    <section class="card">
      <h2 class="section-title">表示</h2>
      <fieldset class="field">
        <legend class="label">画面の色（この端末だけの設定）</legend>
        <div class="seg theme-seg">${Object.entries(THEMES).map(([v, l]) => html`<label><input type="radio" name="theme" value="${v}" ${getTheme() === v ? 'checked' : ''}><span>${l}</span></label>`)}</div>
      </fieldset>
    </section>

    <section class="card credits">
      <h2 class="section-title">クレジット</h2>
      <p>映画・アニメの作品情報と画像は <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a> を利用しています。</p>
      <p>本の書誌情報は <a href="https://ndlsearch.ndl.go.jp/" target="_blank" rel="noopener">国立国会図書館サーチ</a> を利用しています。</p>
      <p class="small">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      <p>本の書誌情報と書影は <a href="https://books.google.com/" target="_blank" rel="noopener">Google Books</a> と <a href="https://openbd.jp/" target="_blank" rel="noopener">openBD</a>（版元ドットコム）を利用しています。</p>
      <p class="muted small">${APP_NAME} は個人用の記録アプリです。各画像の権利はそれぞれの権利者に帰属します。</p>
    </section>
    <footer class="colophon">
      <span class="brand"><svg class="brand-mark" viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><circle cx="12" cy="20" r="5.2" class="mark-dot"/><path d="M12 9.5a10.5 10.5 0 0 1 0 21" class="mark-ring r1"/><path d="M12 3a17 17 0 0 1 0 34" class="mark-ring r2"/></svg><span class="brand-jp">${APP_NAME}</span><span class="brand-en">yoin</span></span>
      <p>A private archive of afterglow</p>
    </footer>
  </section>`);

  const main = ctx.main;
  main.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => setTheme(r.value)));

  // ---- GitHub 接続 ----
  const cform = main.querySelector('.connect-form');
  cform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = cform.querySelector('.form-error');
    err.hidden = true;
    const owner = cform.elements.owner.value.trim();
    const repoName = cform.elements.repo.value.trim();
    const token = cform.elements.token.value.trim() || (conn?.mode === 'github' ? conn.token : '');
    if (!owner || !repoName || !token) {
      err.textContent = 'ユーザー名・リポジトリ名・トークンを入力してください。';
      err.hidden = false;
      return;
    }
    const btn = cform.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = '確認中…';
    try {
      const adapter = new GitHubAdapter({ owner, repo: repoName, token });
      const info = await adapter.verify();
      if (!info.private) throw new Error('このリポジトリは公開（Public）になっています。記録が誰でも読めてしまうため、非公開（Private）のリポジトリを指定してください。');
      if (info.canWrite === false) throw new Error('このトークンではリポジトリに書き込めません。Contents を Read and write にしてください。');
      const loaded = await adapter.load();
      if (loaded.data !== null && !validateData(loaded.data).ok) throw new Error(`リポジトリの ${DATA_FILE} の形式が正しくないため接続を中止しました。`);
      setConnection({ mode: 'github', owner, repo: repoName, token });
      toast(`GitHub（${info.login}）に接続しました`);
      await ctx.reconnect();
      ctx.navigate('/', { replace: true });
    } catch (ex) {
      err.textContent = `接続できませんでした。${describeError(ex)}`;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = '接続を確認して保存';
    }
  });

  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'trial') {
      const ok = await confirmDialog('試用モードでは、記録はこの端末のブラウザにだけ保存されます。GitHubに保存した記録はそのまま残ります。切り替えますか？', { okLabel: '切り替える' });
      if (!ok) return;
      setConnection({ mode: 'trial' });
      await ctx.reconnect();
      ctx.navigate('/', { replace: true });
    } else if (act === 'disconnect') {
      const msg = conn.mode === 'github'
        ? 'この端末からトークンを削除します。GitHub上の記録は消えません。再び使うにはトークンを入力し直します。'
        : '試用モードを終了します。この端末の試用データは残りますが、再び試用モードにするまで表示されません。';
      const ok = await confirmDialog(msg, { okLabel: '解除する', danger: true });
      if (!ok) return;
      clearConnection();
      clearCache();
      await ctx.reconnect();
      ctx.navigate('/welcome', { replace: true });
    } else if (act === 'clear-keys') {
      const ok = await confirmDialog('保存されているAPIキーを削除しますか？', { okLabel: '削除する', danger: true });
      if (!ok) return;
      try {
        await repo.saveSettings({ tmdbKey: '', googleBooksKey: '' });
        toast('APIキーを削除しました');
        ctx.rerender();
      } catch (ex) {
        toast(`保存できませんでした。${describeError(ex)}`, 'error');
      }
    } else if (act === 'export') {
      const backup = makeBackup(repo.data);
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      downloadBlob(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }), `yoin-backup-${stamp}.json`);
    }
  });

  if (!ready) return;

  // ---- APIキー ----
  const kform = main.querySelector('.keys-form');
  kform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    for (const k of ['tmdbKey', 'googleBooksKey']) {
      const v = kform.elements[k].value.trim();
      if (v) patch[k] = v;
    }
    if (!Object.keys(patch).length) return toast('変更はありません');
    try {
      await repo.saveSettings(patch);
      toast('APIキーを保存しました');
      ctx.rerender();
    } catch (ex) {
      toast(`保存できませんでした。${describeError(ex)}`, 'error');
    }
  });

  main.querySelector('input[name="coverProxy"]').addEventListener('change', async (e) => {
    try {
      await repo.saveSettings({ coverProxy: e.target.checked });
      toast('保存しました');
    } catch (ex) {
      e.target.checked = !e.target.checked;
      toast(`保存できませんでした。${describeError(ex)}`, 'error');
    }
  });

  // ---- 復元 ----
  const fileInput = main.querySelector('input[type="file"]');
  const preview = main.querySelector('.restore-preview');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      preview.innerHTML = String(html`<div class="state state-error" role="alert"><p>このファイルは復元できません。今の記録は変更していません。</p>
        <ul class="small">${parsed.errors.slice(0, 5).map((m) => html`<li>${m}</li>`)}</ul></div>`);
      return;
    }
    const cur = repo.data;
    preview.innerHTML = String(html`<div class="restore-box">
      <p><strong>${file.name}</strong>${parsed.exportedAt ? `（${formatDateTime(parsed.exportedAt)} に書き出し）` : ''}</p>
      <table class="restore-table">
        <thead><tr><th></th><th>今の記録</th><th>復元後</th></tr></thead>
        <tbody>
          <tr><th>作品</th><td>${cur.works.length}</td><td>${parsed.counts.works}</td></tr>
          <tr><th>記録</th><td>${cur.experiences.length}</td><td>${parsed.counts.experiences}</td></tr>
          <tr><th>共有画像</th><td>${cur.shelves.length}</td><td>${parsed.counts.shelves}</td></tr>
        </tbody>
      </table>
      <p class="hint">今の記録はすべてこの内容に置き換わります。</p>
      <div class="btn-row"><button type="button" class="btn danger" data-restore>置き換えて復元</button>
      <button type="button" class="btn ghost" data-cancel>やめる</button></div>
    </div>`);
    preview.querySelector('[data-cancel]').addEventListener('click', () => { preview.innerHTML = ''; });
    preview.querySelector('[data-restore]').addEventListener('click', async (ev) => {
      const ok = await confirmDialog(`今の記録（作品${cur.works.length}件）を、バックアップの内容（作品${parsed.counts.works}件）に置き換えます。よろしいですか？`, { okLabel: '復元する', danger: true, title: '復元の確認' });
      if (!ok) return;
      ev.target.disabled = true;
      try {
        await repo.restore(parsed.data);
        toast('復元しました');
        ctx.navigate('/', { replace: true });
      } catch (ex) {
        ev.target.disabled = false;
        preview.insertAdjacentHTML('beforeend', String(html`<p class="form-error">復元できませんでした。今の記録は変更されていません。${describeError(ex)}</p>`));
      }
    });
  });
}
