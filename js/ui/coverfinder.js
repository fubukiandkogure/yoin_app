// 登録済みの作品に、あとから表紙を付ける（検索して候補から選ぶ）。
import { html, nowIso } from '../util.js';
import { findWork } from '../model.js';
import { searchWorks } from '../search/index.js';
import { verifyCover, isGooglePlaceholder } from '../search/books.js';
import { describeError } from '../store/errors.js';
import { coverHtml, toast } from './components.js';
import { icon } from './icons.js';

/** 表紙の候補を探して選んでもらい、選ばれたら作品に保存する。保存したら true */
export function openCoverFinder(ctx, workId) {
  const w = findWork(ctx.repo.data, workId);
  if (!w) return Promise.resolve(false);
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog picker cover-finder';
    const initialQuery = w.source.isbn || [w.title, w.volume].filter(Boolean).join(' ');
    dlg.innerHTML = String(html`<div class="picker-head">
        <form class="cf-form">${icon('search', { size: 18 })}<input name="q" value="${initialQuery}" aria-label="検索語" autocomplete="off" enterkeyhint="search"></form>
        <button type="button" class="icon-btn" data-act="close" aria-label="閉じる">${icon('close', { size: 18 })}</button>
      </div>
      <p class="hint cf-hint">「${w.title}」の表紙を選んでください。表紙だけが変わり、感想や記録はそのままです。</p>
      <div class="picker-grid cf-grid"></div>`);
    document.body.appendChild(dlg);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(v);
    };
    const grid = dlg.querySelector('.cf-grid');
    let candidates = [];

    async function run(q) {
      grid.innerHTML = String(html`<div class="state state-loading" style="grid-column:1/-1"><span class="spinner"></span>表紙を探しています…</div>`);
      try {
        const results = await searchWorks(w.type, q, ctx.repo.settings);
        candidates = results.filter((c) => c.cover?.url).slice(0, 24);
      } catch (e) {
        grid.innerHTML = String(html`<div class="state state-error" style="grid-column:1/-1"><p>${describeError(e)}</p></div>`);
        return;
      }
      if (!candidates.length) {
        grid.innerHTML = String(html`<div class="state" style="grid-column:1/-1"><p>表紙の候補が見つかりませんでした。検索語を変えてみてください（本は ISBN でも探せます）。</p></div>`);
        return;
      }
      grid.innerHTML = String(html`${candidates.map((c, i) => html`<button type="button" class="pick-tile" data-i="${i}">
        ${coverHtml(c, { thumb: true })}
        <span class="pick-title">${c.title}${c.volume ? ` ${c.volume}` : ''}</span>
        <span class="pick-sub">${[c.publisher || c.extra, c.year].filter(Boolean).join(' · ')}</span>
      </button>`)}`);
      // 「画像なし」の代替画像だった候補は隠す
      grid.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => {
        if (isGooglePlaceholder(img)) img.closest('.pick-tile').hidden = true;
      }));
    }

    dlg.querySelector('.cf-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = e.target.elements.q.value.trim();
      if (q) run(q);
    });
    dlg.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act="close"]')) return finish(false);
      const tile = e.target.closest('.pick-tile');
      if (!tile) return;
      const c = candidates[Number(tile.dataset.i)];
      tile.disabled = true;
      if (c.cover.unverified && !(await verifyCover(c.cover.url))) {
        toast('この候補は表紙が見つかりませんでした。別の候補を選んでください', 'error');
        tile.hidden = true;
        return;
      }
      try {
        await ctx.repo.mutate(`表紙を設定：${w.title}`, (d) => {
          const x = findWork(d, workId);
          if (!x) throw new Error('作品が見つかりません');
          x.cover = { url: c.cover.url, provider: c.cover.provider, credit: c.cover.credit, missingReason: null };
          if (x.source.provider === 'manual') {
            x.source = { provider: c.provider, id: c.id ?? null, mediaType: c.mediaType ?? null, seasonNumber: c.seasonNumber ?? null, isbn: c.isbn ?? null };
          } else if (!x.source.isbn && c.isbn) {
            x.source.isbn = c.isbn;
          }
          x.updatedAt = nowIso();
        });
        toast('表紙を設定しました');
        finish(true);
      } catch (err) {
        tile.disabled = false;
        toast(`保存できませんでした。${describeError(err)}`, 'error');
      }
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    dlg.addEventListener('close', () => finish(false));
    dlg.showModal();
    run(initialQuery);
  });
}
