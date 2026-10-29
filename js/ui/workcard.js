// 1作品のカード画像と、1年分のポスター画像。どちらも端末で描いて、保存またはLINEなどで送る。
import { html } from '../util.js';
import { findWork, latestExperience, catalogNumbers, catalogLabel, shelfEntries, groupByYear } from '../model.js';
import { renderWorkCard, renderYearPoster } from '../png.js';
import { knownTint, getTint } from '../tint.js';
import { describeError } from '../store/errors.js';
import { downloadBlob, toast } from './components.js';
import { icon } from './icons.js';

function fileName(base) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${String(base || 'yoin').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}_${stamp}.png`;
}

/** 画像づくりのダイアログ。form は設定欄、make(form) が {blob,...} を返す */
function imageDialog({ title, kicker, formHtml, make, filename }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog image-dialog';
  dlg.innerHTML = String(html`<div class="dialog-inner">
    <div class="kicker">${kicker}</div>
    <h2 class="dialog-title">${title}</h2>
    <form class="img-form">${formHtml}</form>
    <div class="actions"><button type="button" class="btn primary wide" data-act="make">${icon('image', { size: 18 })}画像を作る</button></div>
    <div class="image-result" aria-live="polite"></div>
    <div class="dialog-actions"><button type="button" class="btn ghost" data-act="close">閉じる</button></div>
  </div>`);
  document.body.appendChild(dlg);
  let url = null;
  let blob = null;
  const result = dlg.querySelector('.image-result');
  const close = () => {
    if (url) URL.revokeObjectURL(url);
    if (dlg.open) dlg.close();
    dlg.remove();
  };
  dlg.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'close') return close();
    if (b.dataset.act === 'make') {
      b.disabled = true;
      result.innerHTML = String(html`<div class="state state-loading"><span class="spinner"></span>Rendering…</div>`);
      try {
        const out = await make(dlg.querySelector('.img-form'));
        blob = out.blob;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        const canShare = (() => {
          try { return !!navigator.canShare?.({ files: [new File([blob], 'a.png', { type: 'image/png' })] }); } catch { return false; }
        })();
        result.innerHTML = String(html`<img class="result-img" src="${url}" alt="作成した画像" width="${out.width}" height="${out.height}">
          ${out.failed?.length ? html`<p class="hint warn">表紙を読み込めず仮表紙にした作品：${out.failed.join('、')}</p>` : ''}
          <div class="actions">
            ${canShare ? html`<button type="button" class="btn accent wide" data-act="send">${icon('send', { size: 18 })}LINEなどで送る</button>` : ''}
            <button type="button" class="btn wide ${canShare ? '' : 'primary'}" data-act="download">${icon('download', { size: 18 })}画像を保存</button>
          </div>
          <p class="hint">iPhoneでは画像を長押しして「"写真"に保存」もできます。送った画像はあとから取り消せません。</p>`);
      } catch (err) {
        result.innerHTML = String(html`<div class="state state-error"><p>画像を作れませんでした。${describeError(err)}</p></div>`);
      }
      b.disabled = false;
    } else if (b.dataset.act === 'download' && blob) {
      downloadBlob(blob, filename());
    } else if (b.dataset.act === 'send' && blob) {
      try {
        await navigator.share({ files: [new File([blob], filename(), { type: 'image/png' })] });
      } catch (err) {
        if (err?.name !== 'AbortError') toast('送信画面を開けませんでした。画像を保存してから送ってください。', 'error');
      }
    }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.showModal();
}

const themeChoice = (def) => html`<fieldset class="field opt-group">
  <legend class="label">色</legend>
  <div class="layout-choices">
    <label class="layout-choice"><input type="radio" name="theme" value="paper" ${def === 'paper' ? 'checked' : ''}><span class="demo paper"><i></i><i></i><i></i></span>生成り</label>
    <label class="layout-choice"><input type="radio" name="theme" value="night" ${def === 'night' ? 'checked' : ''}><span class="demo night"><i></i><i></i><i></i></span>夜</label>
  </div>
</fieldset>`;

/** 1作品のカード。自分用の感想は使わず、載せたい一言はここで入力する（保存しない） */
export function openWorkCard(ctx, workId) {
  const data = ctx.repo.data;
  const w = findWork(data, workId);
  if (!w) return;
  const latest = latestExperience(data, workId);
  const useProxy = ctx.repo.settings.coverProxy !== false;
  imageDialog({
    kicker: 'Share one work',
    title: `「${w.title}」の画像`,
    filename: () => fileName(w.title),
    formHtml: html`${themeChoice('paper')}
      <label class="check"><input type="checkbox" name="showScore" ${latest?.score != null ? 'checked' : 'disabled'}><span>点数を載せる${latest?.score != null ? `（${latest.score}点）` : '（未採点）'}</span></label>
      <label class="field" style="margin-top:10px"><span class="label">すすめる一言 <small>任意・この画像にだけ載ります</small></span>
        <textarea name="line" rows="2" maxlength="80" placeholder="例：ネタバレなしで観てほしい"></textarea></label>
      <p class="hint">自分用の感想やメモは載りません。</p>`,
    make: async (form) => {
      const f = form.elements;
      const tint = knownTint(w.cover.url) || (await getTint(w.cover.url, { useProxy }));
      return renderWorkCard({
        type: w.type, title: w.title, volume: w.volume, creator: w.creator, year: w.year,
        cover: w.cover.url ? { url: w.cover.url, credit: w.cover.credit } : null,
        score: f.showScore.checked ? latest?.score ?? null : null,
        line: f.line.value.trim(),
        no: catalogLabel(catalogNumbers(data).get(w.id)),
        tint,
      }, { useProxy, theme: f.theme.value });
    },
  });
}

/** 1年分の表紙を並べたポスター */
export function openYearPoster(ctx) {
  const data = ctx.repo.data;
  const groups = groupByYear(shelfEntries(data).filter((e) => e.work.status !== 'planned')).filter((g) => g.year !== 'unknown');
  if (!groups.length) {
    toast('体験した時期（年）が入った記録がまだありません');
    return;
  }
  const useProxy = ctx.repo.settings.coverProxy !== false;
  let selected = groups[0].year;
  imageDialog({
    kicker: 'Year poster',
    title: '1年のポスター',
    filename: () => fileName(`yoin_${selected}`),
    formHtml: html`<label class="field"><span class="label">年</span>
        <select name="year">${groups.map((g) => html`<option value="${g.year}">${g.year}年（${g.items.length}作品）</option>`)}</select></label>
      ${themeChoice('night')}
      <p class="hint">その年に観た・読んだ作品の表紙を並べます。点数や感想は載りません。</p>`,
    make: (form) => {
      const g = groups.find((x) => x.year === form.elements.year.value);
      selected = g.year;
      const counts = { movie: 0, book: 0, anime: 0 };
      g.items.forEach((e) => counts[e.work.type]++);
      return renderYearPoster({
        year: g.year,
        counts,
        items: g.items.map((e) => ({ type: e.work.type, title: e.work.title, volume: e.work.volume, cover: e.work.cover.url ? { url: e.work.cover.url, credit: e.work.cover.credit } : null })),
      }, { useProxy, theme: form.elements.theme.value });
    },
  });
}
