// 作品追加：種別を選んでタイトル検索 →（アニメはシーズン選択）→ 感想を書いて保存。手入力も可。
import { html, newId, nowIso } from '../util.js';
import { TYPES, findDuplicates, allTags, VERBS } from '../model.js';
import { searchWorks, resolveCandidate, providerLabel } from '../search/index.js';
import { describeError } from '../store/errors.js';
import { coverHtml, loadingHtml, toast, choose } from './components.js';
import { icon, TYPE_ICON } from './icons.js';
import {
  workInfoFields, workStateFields, experienceFields, bindFormHelpers, readExperience, readWorkInfo, readWorkState, FormError,
} from './forms.js';

let lastType = 'movie';
let st = null;
let baseCtx = null;

const fresh = () => ({ type: lastType, query: '', results: null, loading: false, error: null, step: 'search', base: null, seasonsOf: null });

export function candToWork(c) {
  return {
    type: c.type,
    title: c.title || '',
    creator: c.creator || '',
    year: c.year ?? null,
    volume: c.volume || '',
    source: { provider: c.provider, id: c.id ?? null, mediaType: c.mediaType ?? null, seasonNumber: c.seasonNumber ?? null, isbn: c.isbn ?? null },
    cover: c.cover?.url
      ? { url: c.cover.url, provider: c.cover.provider, credit: c.cover.credit, missingReason: null }
      : { url: null, provider: null, credit: null, missingReason: c.provider === 'manual' ? 'manual' : 'no_image' },
    status: 'done',
    favorite: false,
    tags: [],
  };
}

const manualWork = (type) => candToWork({ provider: 'manual', type, title: '' });

export async function render(ctx) {
  baseCtx = ctx;
  st = fresh();
  draw();
}

// 描画のたびに新しい要素を作り、前回のイベントリスナーを残さない
function draw() {
  const root = document.createElement('div');
  baseCtx.main.replaceChildren(root);
  const ctx = { ...baseCtx, main: root, repo: baseCtx.repo };
  ctx.setDirty(st.step === 'form');
  if (st.step === 'season') return drawSeasons(ctx);
  if (st.step === 'form') return drawForm(ctx);
  return drawSearch(ctx);
}

function drawSearch(ctx) {
  const main = ctx.main;
  main.innerHTML = String(html`<section class="page add-page">
    <div class="kicker">Add — 02</div>
    <h1 class="page-title">作品を追加</h1>
    <div class="seg type-seg" role="radiogroup" aria-label="種別">
      ${Object.entries(TYPES).map(([v, l]) => html`<button type="button" role="radio" aria-checked="${st.type === v}" class="${st.type === v ? 'on' : ''}" data-type="${v}">${icon(TYPE_ICON[v], { size: 17 })}${l}</button>`)}
    </div>
    <form class="search-form" role="search">
      ${icon('search', { size: 18 })}
      <input type="search" name="q" value="${st.query}" placeholder="${st.type === 'book' ? 'タイトル・著者・ISBN' : 'タイトル'}で検索" aria-label="検索語" autocomplete="off" enterkeyhint="search">
      <button class="btn primary" type="submit">検索</button>
    </form>
    <div class="results" aria-live="polite">${resultsHtml()}</div>
    <a class="import-cta" href="#/import">${icon('book', { size: 18 })}<span><b>メモからまとめて追加</b><small>これまでの記録を貼り付けて、一気に棚へ</small></span>${icon('next', { size: 18 })}</a>
    <div class="manual-cta">
      <span>見つからない・画像がないときは</span>
      <button type="button" class="btn" data-act="manual">${icon('edit', { size: 16 })}手入力で登録</button>
    </div>
    ${st.type === 'book' ? html`<p class="hint">見つからないときは、著者名も入れてみてください（例：三体 劉慈欣）。ISBN（13桁）でも探せます。</p>` : ''}
    <p class="hint center">検索元：${providerLabel(st.type)}</p>
  </section>`);
  const form = main.querySelector('.search-form');
  if (!st.results && !st.loading) form.elements.q.focus({ preventScroll: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = form.elements.q.value.trim();
    if (!q) return;
    st.query = q;
    await runSearch(ctx);
  });
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.type) {
      st.type = lastType = b.dataset.type;
      st.query = form.elements.q.value.trim();
      st.results = null;
      st.error = null;
      if (st.query) await runSearch(ctx);
      else draw(ctx);
    } else if (b.dataset.act === 'manual') {
      st.base = manualWork(st.type);
      st.base.title = form.elements.q.value.trim();
      st.manual = true;
      st.step = 'form';
      draw(ctx);
    } else if (b.dataset.act === 'retry') {
      await runSearch(ctx);
    } else if (b.dataset.idx !== undefined) {
      await pick(ctx, st.results[Number(b.dataset.idx)]);
    }
  });
}

function resultsHtml() {
  if (st.loading) return loadingHtml('検索中…');
  if (st.error) {
    return html`<div class="state state-error" role="alert"><p>${st.error}</p>
      <div class="btn-row"><button type="button" class="btn small" data-act="retry">再試行</button>
      <button type="button" class="btn small primary" data-act="manual">手入力で登録</button></div></div>`;
  }
  if (!st.results) return '';
  if (!st.results.length) return html`<div class="state"><p>「${st.query}」は見つかりませんでした。</p><button type="button" class="btn small primary" data-act="manual">手入力で登録</button></div>`;
  const data = baseCtx.repo.data;
  return html`${st.partial ? html`<p class="hint searching-more"><span class="spinner"></span>国立国会図書館サーチでも探しています…</p>` : ''}<ul class="result-list">${st.results.map((c, i) => {
    const owned = findDuplicates(data, candToWork(c)).length > 0 || (c.needsSeason && data.works.some((w) => w.source.provider === c.provider && w.source.id === c.id));
    return html`<li><button type="button" class="result" data-idx="${i}">
    ${coverHtml({ ...c, cover: c.cover || { missingReason: 'no_image' } }, { size: 'thumb', thumb: true })}
    <span class="result-text">
      <span class="result-title">${c.title}${c.volume ? html` <small class="muted">${c.volume}</small>` : ''}</span>
      ${owned ? html`<span><span class="badge subtle">${icon('check', { size: 12 })}棚にあります</span></span>` : ''}
      ${c.originalTitle ? html`<span class="result-sub">${c.originalTitle}</span>` : ''}
      <span class="result-sub">${[c.year ? `${c.year}年` : '', c.creator, c.extra].filter(Boolean).join(' · ')}</span>
      ${c.cover ? '' : html`<span class="result-sub muted">画像なし</span>`}
    </span>
    ${icon('next', { size: 18 })}
  </button></li>`;
  })}</ul>`;
}

async function runSearch(ctx) {
  st.loading = true;
  st.error = null;
  draw(ctx);
  try {
    const q = st.query;
    st.results = await searchWorks(st.type, q, ctx.repo.settings, {
      // 先に返ってきた結果をすぐ見せる（あとから届いた分は最後にまとめて並べ直す）
      onPartial: (partial) => {
        if (st.query !== q || !st.loading) return;
        st.results = partial;
        st.loading = false;
        st.partial = true;
        draw(ctx);
      },
    });
    st.partial = false;
  } catch (e) {
    st.results = null;
    st.error = `検索できませんでした。${describeError(e)}`;
  }
  st.loading = false;
  draw(ctx);
}

async function pick(ctx, cand) {
  const box = ctx.main.querySelector('.results');
  box.innerHTML = String(loadingHtml('作品情報を取得中…'));
  let full = cand;
  try {
    full = await resolveCandidate(cand, ctx.repo.settings);
  } catch (e) {
    // 詳細が取れなくても候補の情報で登録できる
    toast(`詳細情報を取得できませんでした（${describeError(e)}）。わかる範囲で登録します。`, 'error');
  }
  st.manual = false;
  if (full.seasons && full.seasons.length > 1) {
    st.seasonsOf = full;
    st.step = 'season';
    return draw(ctx);
  }
  const only = full.seasons?.length === 1 ? full.seasons[0] : null;
  await toForm(ctx, only ? applySeason(full, only) : full);
}

function applySeason(show, season) {
  return {
    ...show,
    seasonNumber: season.seasonNumber,
    volume: season.name,
    year: season.year ?? show.year,
    cover: season.cover || show.cover,
  };
}

function drawSeasons(ctx) {
  const show = st.seasonsOf;
  ctx.main.innerHTML = String(html`<section class="page">
    <button type="button" class="link-back" data-act="back">${icon('back', { size: 18 })}検索結果に戻る</button>
    <h1 class="page-title">${show.title}</h1>
    <p class="hint">どのシーズンを記録しますか？</p>
    <ul class="result-list">
      <li><button type="button" class="result" data-season="all">
        ${coverHtml({ ...show, cover: show.cover || { missingReason: 'no_image' } }, { size: 'thumb', thumb: true })}
        <span class="result-text"><span class="result-title">シリーズ全体</span><span class="result-sub">シーズンを分けずに記録</span></span>
      </button></li>
      ${show.seasons.map((s, i) => html`<li><button type="button" class="result" data-season="${i}">
        ${coverHtml({ type: show.type, title: s.name, cover: s.cover || show.cover || { missingReason: 'no_image' } }, { size: 'thumb', thumb: true })}
        <span class="result-text"><span class="result-title">${s.name}</span>
        <span class="result-sub">${[s.year ? `${s.year}年` : '', s.episodes ? `${s.episodes}話` : ''].filter(Boolean).join(' · ')}</span></span>
      </button></li>`)}
    </ul>
  </section>`);
  ctx.main.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'back') {
      st.step = 'search';
      return draw(ctx);
    }
    if (b.dataset.season === undefined) return;
    const cand = b.dataset.season === 'all' ? show : applySeason(show, show.seasons[Number(b.dataset.season)]);
    await toForm(ctx, cand);
  });
}

async function toForm(ctx, cand) {
  const base = candToWork(cand);
  const dupes = findDuplicates(ctx.repo.data, base);
  if (dupes.length && !(await handleDuplicate(ctx, dupes[0]))) {
    if (st.step !== 'search') { st.step = 'search'; draw(ctx); } else draw(ctx);
    return;
  }
  st.base = base;
  st.step = 'form';
  draw(ctx);
}

/** 同じ作品がすでにある場合：既存に追記するなら移動して false、別作品として続けるなら true */
async function handleDuplicate(ctx, existing) {
  const r = await choose(
    html`<p>「${existing.title}${existing.volume ? ` ${existing.volume}` : ''}」はすでに棚にあります。</p>
      <p class="hint">もう一度${VERBS[existing.type]}記録なら、既存の作品に追記すると以前の感想と並べて残せます。</p>`,
    [
      { label: '既存の作品に記録を追加', value: 'append', kind: 'primary' },
      { label: '別の作品として登録', value: 'new' },
    ],
    { title: '同じ作品があります' },
  );
  if (r === 'append') {
    ctx.navigate(`/work/${existing.id}/exp/new`);
    return false;
  }
  return r === 'new';
}

function drawForm(ctx) {
  const w = st.base;
  const repo = ctx.repo;
  ctx.main.innerHTML = String(html`<section class="page">
    <button type="button" class="link-back" data-act="back">${icon('back', { size: 18 })}検索に戻る</button>
    <form class="work-form" novalidate>
      ${st.manual ? html`<h1 class="page-title">手入力で登録</h1>` : html`<div class="picked">
        ${coverHtml(w, { size: 'medium' })}
        <div class="picked-text">
          <span class="badge">${TYPES[w.type]}</span>
          <h1 class="picked-title">${w.title}${w.volume ? html` <small>${w.volume}</small>` : ''}</h1>
          <p class="muted">${[w.year ? `${w.year}年` : '', w.creator].filter(Boolean).join(' · ')}</p>
          ${w.cover.credit ? html`<p class="credit">${w.cover.credit}</p>` : ''}
        </div>
      </div>`}
      <details class="work-info" ${st.manual ? 'open' : ''}>
        <summary>作品情報を確認・修正</summary>
        ${workInfoFields(w, { showType: st.manual })}
      </details>
      <div class="form-card">${workStateFields(w, allTags(repo.data))}</div>
      <div class="form-card">
        <h2 class="section-title">記録 <small>空欄のままでも保存できます</small></h2>
        ${experienceFields(null, w.type)}
      </div>
      <div class="form-error" role="alert" hidden></div>
      <div class="actions sticky-actions">
        <button type="submit" class="btn primary wide">棚に保存</button>
      </div>
    </form>
  </section>`);
  const form = ctx.main.querySelector('form');
  bindFormHelpers(form);
  form.addEventListener('input', () => ctx.setDirty(true));
  ctx.main.querySelector('[data-act="back"]').addEventListener('click', () => {
    st.step = 'search';
    draw(ctx);
  });
  const errBox = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const btn = form.querySelector('[type="submit"]');
    let work;
    let expIn;
    try {
      const info = readWorkInfo(form, w);
      const state = readWorkState(form);
      expIn = readExperience(form);
      work = { ...w, ...info, ...state };
    } catch (err) {
      if (err instanceof FormError) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        return;
      }
      throw err;
    }
    if (st.manual) {
      const dupes = findDuplicates(repo.data, work);
      if (dupes.length && !(await handleDuplicate(ctx, dupes[0]))) return;
    }
    const now = nowIso();
    work = { ...work, id: newId(), createdAt: now, updatedAt: now };
    const exp = expIn.empty ? null : { id: newId(), workId: work.id, ...expIn.exp, createdAt: now, updatedAt: now };
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await repo.mutate(`追加：${work.title}`, (d) => {
        d.works.push(work);
        if (exp) d.experiences.push(exp);
      });
      ctx.setDirty(false);
      st = fresh();
      try { sessionStorage.setItem('yoin.justAdded', work.id); } catch { /* 無視 */ }
      toast('棚に保存しました');
      ctx.navigate(`/work/${work.id}`, { replace: true });
    } catch (err) {
      // 入力内容はそのまま残して再試行できるようにする
      errBox.textContent = `保存できませんでした。${describeError(err)} 入力内容は残っています。もう一度「棚に保存」を押してください。`;
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = '棚に保存';
    }
  });
}
