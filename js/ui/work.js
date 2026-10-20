// 作品詳細・作品情報の編集・体験記録の追加と編集。
import { html, newId, nowIso, formatExpDate, formatDateTime, safeUrl } from '../util.js';
import { TYPES, STATUSES, VERBS, COVER_MISSING, findWork, experiencesOf, allTags, shelvesContaining } from '../model.js';
import { describeError } from '../store/errors.js';
import { coverHtml, scoreText, toast, confirmDialog, placeholderColor } from './components.js';
import { icon, TYPE_ICON } from './icons.js';

const favLabel = (on) => html`${icon(on ? 'starFill' : 'star', { size: 16 })}お気に入り`;
import {
  workInfoFields, workStateFields, experienceFields, bindFormHelpers, readExperience, readWorkInfo, readWorkState, statusOptions, FormError,
} from './forms.js';

function notFound(ctx) {
  ctx.main.innerHTML = String(html`<div class="state"><p>この作品は見つかりませんでした（削除された可能性があります）。</p><a class="btn" href="#/">作品棚へ</a></div>`);
}

function sourceLabel(w) {
  const s = w.source;
  if (s.provider === 'tmdb') return 'TMDB';
  if (s.provider === 'googlebooks') return 'Google Books';
  if (s.provider === 'openbd') return 'openBD';
  return '手入力';
}

export async function renderDetail(ctx, id) {
  const { repo } = ctx;
  const w = findWork(repo.data, id);
  if (!w) return notFound(ctx);
  const exps = experiencesOf(repo.data, id);
  const latest = exps[0] || null;
  const verb = VERBS[w.type];

  const heroUrl = safeUrl(w.cover.url);
  let justAdded = false;
  try {
    justAdded = sessionStorage.getItem('yoin.justAdded') === id;
    if (justAdded) sessionStorage.removeItem('yoin.justAdded');
  } catch { /* 無視 */ }

  ctx.main.innerHTML = String(html`<article class="page work-detail">
    <header class="hero">
      ${heroUrl ? html`<img class="hero-bg" src="${heroUrl}" alt="" aria-hidden="true" referrerpolicy="no-referrer">` : html`<div class="hero-bg" style="background:${placeholderColor(w.title)}"></div>`}
      <a class="link-back" href="#/">${icon('back', { size: 18 })}作品棚</a>
      <div class="detail-head">
        ${coverHtml(w, { size: 'large', eager: true })}
        <div class="detail-info">
          <span class="badge">${icon(TYPE_ICON[w.type], { size: 13 })}${TYPES[w.type]}</span>
          <h1 class="detail-title">${w.title}${w.volume ? html` <small>${w.volume}</small>` : ''}</h1>
          <p class="muted small">${[w.year ? `${w.year}年` : '', w.creator].filter(Boolean).join(' · ')}</p>
          ${w.tags.length ? html`<p class="tags">${w.tags.map((t) => html`<span class="tag">#${t}</span>`)}</p>` : ''}
          <div class="quick">
            <label class="quick-status"><span class="sr-only">状態</span><select name="status">${statusOptions(w.status)}</select></label>
            <button type="button" class="fav-toggle ${w.favorite ? 'on' : ''}" data-act="fav" aria-pressed="${w.favorite}">${favLabel(w.favorite)}</button>
          </div>
        </div>
      </div>
    </header>

    ${justAdded ? html`<div class="banner">${icon('check', { size: 18 })}棚に追加しました<a class="btn small" href="#/add">${icon('plus', { size: 16 })}続けて追加</a></div>` : ''}

    ${latest ? html`<section class="latest">
      <div class="latest-score ${latest.score === null ? 'unscored' : ''}">
        <span class="num">${latest.score === null ? '未採点' : latest.score}</span>
        ${latest.score === null ? '' : html`<span class="unit">/ 100</span><div class="meter"><span style="width:${latest.score}%"></span></div>`}
      </div>
      ${latest.comment ? html`<p class="latest-comment">「${latest.comment}」</p>` : html`<p class="muted">ひとこと感想はまだありません</p>`}
    </section>` : ''}

    <section class="exp-section">
      <div class="section-head">
        <h2 class="section-title">${verb}記録 <small>${exps.length}件</small></h2>
      </div>
      <a class="btn primary wide" href="#/work/${w.id}/exp/new">${icon('plus', { size: 18 })}${exps.length ? `もう一度${verb}記録を追加` : '記録を書く'}</a>
      ${exps.length ? html`<ol class="exp-list">${exps.map((e, i) => html`<li class="exp-card ${i === 0 ? 'latest-exp' : ''}">
        <div class="exp-head">
          <span class="exp-date">${formatExpDate(e.date)}</span>
          ${i === 0 && exps.length > 1 ? html`<span class="badge subtle">最新</span>` : ''}
          ${exps.length > 1 ? html`<span class="muted small">${exps.length - i}回目</span>` : ''}
          <span class="exp-score">${scoreText(e.score)}</span>
        </div>
        ${e.comment ? html`<p class="exp-comment">${e.comment}</p>` : ''}
        ${e.memo ? html`<details class="exp-memo" ${exps.length === 1 ? 'open' : ''}><summary>詳細メモ</summary><div class="memo-text">${e.memo}</div></details>` : ''}
        ${e.note ? html`<p class="exp-note">${e.note}</p>` : ''}
        <div class="exp-foot">
          <small class="muted">記録 ${formatDateTime(e.createdAt)}${e.updatedAt !== e.createdAt ? ` ・ 更新 ${formatDateTime(e.updatedAt)}` : ''}</small>
          <span>
            <a class="btn small ghost" href="#/work/${w.id}/exp/${e.id}">${icon('edit', { size: 15 })}編集</a>
            <button type="button" class="btn small ghost danger-text" data-act="del-exp" data-id="${e.id}">${icon('trash', { size: 15 })}削除</button>
          </span>
        </div>
      </li>`)}</ol>` : html`<p class="muted center">まだ記録はありません。点数や感想は空欄のままでも残せます。</p>`}
    </section>

    <section class="detail-foot">
      ${w.cover.credit ? html`<p class="credit">${w.cover.credit}</p>` : ''}
      ${!w.cover.url && w.cover.missingReason ? html`<p class="credit">仮表紙：${COVER_MISSING[w.cover.missingReason]}</p>` : ''}
      <p class="muted small">作品情報：${sourceLabel(w)} ・ 登録 ${formatDateTime(w.createdAt)}</p>
      <div class="btn-row">
        <a class="btn" href="#/work/${w.id}/edit">${icon('edit', { size: 16 })}作品情報を編集</a>
        <button type="button" class="btn ghost danger-text" data-act="del-work">${icon('trash', { size: 16 })}作品を削除</button>
      </div>
    </section>
  </article>`);

  const main = ctx.main;
  const statusSel = main.querySelector('select[name="status"]');
  statusSel.addEventListener('change', async () => {
    const v = statusSel.value;
    try {
      await repo.mutate(`状態を変更：${w.title}`, (d) => {
        const x = findWork(d, id);
        if (!x) throw new Error('作品が見つかりません');
        x.status = v;
        x.updatedAt = nowIso();
      });
      toast(`状態を「${STATUSES[v]}」にしました`);
    } catch (e) {
      statusSel.value = findWork(repo.data, id)?.status || w.status;
      toast(`保存できませんでした。${describeError(e)}`, 'error');
    }
  });

  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'fav') {
      b.disabled = true;
      try {
        let next;
        await repo.mutate(`お気に入り：${w.title}`, (d) => {
          const x = findWork(d, id);
          if (!x) throw new Error('作品が見つかりません');
          x.favorite = next = !x.favorite;
          x.updatedAt = nowIso();
        });
        b.classList.toggle('on', next);
        b.setAttribute('aria-pressed', String(next));
        b.innerHTML = String(favLabel(next));
      } catch (err) {
        toast(`保存できませんでした。${describeError(err)}`, 'error');
      }
      b.disabled = false;
    } else if (b.dataset.act === 'del-exp') {
      const ok = await confirmDialog('この記録を削除しますか？ 点数・感想・メモも消え、元に戻せません。', { okLabel: '削除する', danger: true, title: '記録の削除' });
      if (!ok) return;
      try {
        await repo.mutate(`記録を削除：${w.title}`, (d) => {
          d.experiences = d.experiences.filter((x) => x.id !== b.dataset.id);
        });
        toast('記録を削除しました');
        ctx.rerender();
      } catch (err) {
        toast(`削除できませんでした。${describeError(err)}`, 'error');
      }
    } else if (b.dataset.act === 'del-work') {
      const shelves = shelvesContaining(repo.data, id);
      const msg = html`<p>「${w.title}」と、すべての${VERBS[w.type]}記録（${exps.length}件）を削除します。元に戻せません。</p>
        ${shelves.length ? html`<p class="hint">共有画像の棚（${shelves.map((s) => s.title || '無題').join('、')}）からも外れます。</p>` : ''}`;
      const ok = await confirmDialog(msg, { okLabel: '削除する', danger: true, title: '作品の削除' });
      if (!ok) return;
      b.disabled = true;
      try {
        await repo.deleteWork(id);
        toast('作品を削除しました');
        ctx.navigate('/', { replace: true });
      } catch (err) {
        b.disabled = false;
        toast(`削除できませんでした。${describeError(err)}`, 'error');
      }
    }
  });
}

export async function renderEdit(ctx, id) {
  const { repo } = ctx;
  const w = findWork(repo.data, id);
  if (!w) return notFound(ctx);
  ctx.main.innerHTML = String(html`<section class="page">
    <a class="link-back" href="#/work/${w.id}">${icon('back', { size: 18 })}作品に戻る</a>
    <h1 class="page-title">作品情報を編集</h1>
    <form class="work-form" novalidate>
      ${coverHtml(w, { size: 'medium' })}
      ${workInfoFields(w, { showType: true })}
      ${workStateFields(w, allTags(repo.data))}
      <div class="form-error" role="alert" hidden></div>
      <div class="actions sticky-actions"><button type="submit" class="btn primary wide">保存</button></div>
    </form>
  </section>`);
  const form = ctx.main.querySelector('form');
  form.addEventListener('input', () => ctx.setDirty(true));
  const errBox = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    let patch;
    try {
      patch = { ...readWorkInfo(form, w), ...readWorkState(form) };
    } catch (err) {
      if (!(err instanceof FormError)) throw err;
      errBox.textContent = err.message;
      errBox.hidden = false;
      return;
    }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await repo.mutate(`作品情報を編集：${patch.title}`, (d) => {
        const x = findWork(d, id);
        if (!x) throw new FormError('作品が見つかりません（別の端末で削除された可能性があります）。');
        Object.assign(x, patch, { updatedAt: nowIso() });
      });
      ctx.setDirty(false);
      toast('保存しました');
      ctx.navigate(`/work/${id}`, { replace: true });
    } catch (err) {
      errBox.textContent = `保存できませんでした。${describeError(err)} 入力内容は残っています。`;
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = '保存';
    }
  });
}

export async function renderExperience(ctx, workId, expId) {
  const { repo } = ctx;
  const w = findWork(repo.data, workId);
  if (!w) return notFound(ctx);
  const isNew = expId === 'new';
  const existing = isNew ? null : repo.data.experiences.find((e) => e.id === expId && e.workId === workId);
  if (!isNew && !existing) return notFound(ctx);
  const previous = experiencesOf(repo.data, workId);
  const verb = VERBS[w.type];

  ctx.main.innerHTML = String(html`<section class="page">
    <a class="link-back" href="#/work/${w.id}">${icon('back', { size: 18 })}作品に戻る</a>
    <div class="picked compact">
      ${coverHtml(w, { size: 'small' })}
      <div class="picked-text"><h1 class="picked-title">${w.title}${w.volume ? html` <small>${w.volume}</small>` : ''}</h1>
      <p class="muted">${isNew ? (previous.length ? `${previous.length + 1}回目の${verb}記録` : `${verb}記録を書く`) : '記録を編集'}</p></div>
    </div>
    ${isNew && previous.length ? html`<p class="hint">以前の記録（${previous.map((p) => `${formatExpDate(p.date)} ${scoreText(p.score)}`).join(' / ')}）はそのまま残ります。</p>` : ''}
    <form class="work-form" novalidate>
      ${experienceFields(existing, w.type)}
      <div class="form-error" role="alert" hidden></div>
      <div class="actions sticky-actions"><button type="submit" class="btn primary wide">保存</button></div>
    </form>
  </section>`);
  const form = ctx.main.querySelector('form');
  bindFormHelpers(form);
  form.addEventListener('input', () => ctx.setDirty(true));
  const errBox = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    let input;
    try {
      input = readExperience(form);
    } catch (err) {
      if (!(err instanceof FormError)) throw err;
      errBox.textContent = err.message;
      errBox.hidden = false;
      return;
    }
    if (isNew && input.empty) {
      errBox.textContent = '何か1つ入力してください（点数・感想・時期など）。';
      errBox.hidden = false;
      return;
    }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = '保存中…';
    const now = nowIso();
    const newExp = isNew ? { id: newId(), workId, ...input.exp, createdAt: now, updatedAt: now } : null;
    try {
      await repo.mutate(`${isNew ? '記録を追加' : '記録を編集'}：${w.title}`, (d) => {
        if (!findWork(d, workId)) throw new FormError('作品が見つかりません（別の端末で削除された可能性があります）。');
        if (isNew) {
          d.experiences.push(newExp);
        } else {
          const x = d.experiences.find((y) => y.id === expId);
          if (!x) throw new FormError('記録が見つかりません（別の端末で削除された可能性があります）。');
          Object.assign(x, input.exp, { updatedAt: now });
        }
      });
      ctx.setDirty(false);
      toast('保存しました');
      ctx.navigate(`/work/${workId}`, { replace: true });
    } catch (err) {
      errBox.textContent = `保存できませんでした。${describeError(err)} 入力内容は残っています。`;
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = '保存';
    }
  });
}
