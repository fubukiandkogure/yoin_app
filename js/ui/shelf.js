// ホーム／作品棚：振り返り、検索、絞り込み、並べ替え、表紙の一覧（棚／年ごと）。
import { html, debounce, expDateEnd } from '../util.js';
import { TYPES, STATUSES, VERBS, shelfEntries, filterAndSort, flashback, allTags, groupByYear, plannedWorks } from '../model.js';
import { getShelfView, setShelfView, getDensity, setDensity } from '../prefs.js';
import { coverHtml, choose } from './components.js';
import { icon, TYPE_ICON } from './icons.js';

const SORTS = { recent: '最近記録した順', experienced: '体験した時期順', score: '点数順' };
const filters = { q: '', type: '', status: '', favorite: false, tag: '', sort: 'recent' };

function agoLabel(exp, now = new Date()) {
  const ref = expDateEnd(exp.date) || new Date(exp.createdAt);
  const months = (now.getFullYear() - ref.getFullYear()) * 12 + (now.getMonth() - ref.getMonth());
  if (months >= 12) return `${Math.floor(months / 12)}年前`;
  return `${Math.max(months, 3)}か月前`;
}

function flashbackHtml(data) {
  const picks = flashback(data);
  if (!picks.length) return '';
  return html`<section class="flashback" aria-labelledby="fb-title">
    <div class="fb-head"><h2 id="fb-title" class="section-title">以前楽しんだ作品</h2></div>
    <div class="fb-list">
      ${picks.map(({ work, experience }) => html`<a class="fb-item" href="#/work/${work.id}">
        ${coverHtml(work, { size: 'small', eager: true })}
        <div class="fb-text">
          <span class="fb-when">${agoLabel(experience)}に${VERBS[work.type]}</span>
          <span class="fb-title">${work.title}${work.volume ? html` <small class="muted">${work.volume}</small>` : ''}</span>
          ${experience.comment ? html`<span class="fb-comment">「${experience.comment}」</span>` : ''}
        </div>
      </a>`)}
    </div>
  </section>`;
}

function tileHtml({ work, latest }) {
  const score = latest?.score;
  const statusLabel = work.status === 'planned' || work.status === 'inprogress' || work.status === 'dropped' ? STATUSES[work.status] : '';
  return html`<a class="tile" href="#/work/${work.id}">
    <div class="tile-cover">
      ${coverHtml(work)}
      ${work.favorite ? html`<span class="fav-mark" aria-label="お気に入り">${icon('starFill', { size: 14 })}</span>` : ''}
      ${statusLabel ? html`<span class="status-tag">${statusLabel}</span>` : ''}
    </div>
    <div class="tile-meta">
      <span class="tile-title">${work.title}${work.volume ? html` <small>${work.volume}</small>` : ''}</span>
      <span class="tile-score ${score == null ? 'unscored' : ''}">${score == null ? '—' : score}</span>
    </div>
  </a>`;
}

async function pickRandom(ctx) {
  const list = plannedWorks(ctx.repo.data);
  if (!list.length) return;
  let last = null;
  for (;;) {
    const pool = list.length > 1 ? list.filter((w) => w.id !== last) : list;
    const w = pool[Math.floor(Math.random() * pool.length)];
    last = w.id;
    const r = await choose(
      html`<div class="random-cover">${coverHtml(w, { size: 'large', eager: true })}</div>
        <p class="hint">「これから」の${list.length}作品から選びました</p>
        <h2 class="dialog-title">${w.title}${w.volume ? html` <small class="muted">${w.volume}</small>` : ''}</h2>
        <p class="muted small">${[TYPES[w.type], w.year ? `${w.year}年` : '', w.creator].filter(Boolean).join(' · ')}</p>`,
      [
        { label: '詳しく見る', value: 'open', kind: 'primary' },
        ...(list.length > 1 ? [{ label: 'もう一度', value: 'again' }] : []),
      ],
      { cancelLabel: '閉じる', className: 'random-dialog' },
    );
    if (r === 'open') return ctx.navigate(`/work/${w.id}`);
    if (r !== 'again') return;
  }
}

export async function render(ctx) {
  const { repo } = ctx;
  const data = repo.data;
  const main = ctx.main;

  if (!data.works.length) {
    main.innerHTML = String(html`<section class="empty-shelf">
      <div class="empty-art" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <h1>まだ棚は空です</h1>
      <p>観た映画、読んだ本、アニメを並べていきましょう。<br>点数や感想はあとからでも書けます。</p>
      <a class="btn primary" href="#/add">${icon('plus', { size: 18 })}最初の作品を追加</a>
    </section>`);
    return;
  }

  const tags = allTags(data);
  if (filters.tag && !tags.includes(filters.tag)) filters.tag = '';
  const planned = plannedWorks(data).length;
  let view = getShelfView();
  let density = getDensity();

  main.innerHTML = String(html`
    ${flashbackHtml(data)}
    <section class="shelf" aria-label="作品棚">
      <div class="shelf-tools">
        <label class="search-bar">${icon('search', { size: 18 })}
          <input type="search" name="q" value="${filters.q}" placeholder="タイトルや自分のメモで検索" aria-label="検索" autocomplete="off">
        </label>
      </div>
      <div class="filter-row" role="group" aria-label="絞り込み">
        <div class="chips type-chips">
          <button type="button" class="chip ${filters.type === '' ? 'on' : ''}" data-type="">すべて</button>
          ${Object.entries(TYPES).map(([v, l]) => html`<button type="button" class="chip ${filters.type === v ? 'on' : ''}" data-type="${v}">${icon(TYPE_ICON[v], { size: 15 })}${l}</button>`)}
        </div>
        <div class="chips">
          <button type="button" class="chip ${filters.favorite ? 'on' : ''}" data-act="fav" aria-pressed="${filters.favorite}">${icon('star', { size: 15 })}お気に入り</button>
          <select name="status" class="chip-select ${filters.status ? 'on' : ''}" aria-label="状態">
            <option value="">状態</option>
            ${Object.entries(STATUSES).map(([v, l]) => html`<option value="${v}" ${filters.status === v ? 'selected' : ''}>${l}</option>`)}
          </select>
          ${tags.length ? html`<select name="tag" class="chip-select ${filters.tag ? 'on' : ''}" aria-label="タグ">
            <option value="">タグ</option>
            ${tags.map((t) => html`<option value="${t}" ${filters.tag === t ? 'selected' : ''}>#${t}</option>`)}
          </select>` : ''}
          <select name="sort" class="chip-select" aria-label="並べ替え">
            ${Object.entries(SORTS).map(([v, l]) => html`<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${l}</option>`)}
          </select>
        </div>
      </div>
      <div class="shelf-meta">
        <p class="count" aria-live="polite"></p>
        ${planned ? html`<button type="button" class="pick-random" data-act="random">${icon('shuffle', { size: 15 })}何にしよう？</button>` : ''}
        <div class="icon-toggle" role="group" aria-label="表示">
          <button type="button" data-view="shelf" aria-label="棚で表示" title="棚で表示">${icon('shelf', { size: 17 })}</button>
          <button type="button" data-view="year" aria-label="年ごとに表示" title="年ごとに表示">${icon('calendar', { size: 17 })}</button>
        </div>
        <div class="icon-toggle" role="group" aria-label="表紙の大きさ">
          <button type="button" data-density="normal" aria-label="大きく表示" title="大きく">${icon('grid', { size: 17 })}</button>
          <button type="button" data-density="dense" aria-label="小さく表示" title="小さく">${icon('gridDense', { size: 17 })}</button>
        </div>
      </div>
      <div class="shelf-body"></div>
    </section>`);

  const entries = shelfEntries(data);
  const body = main.querySelector('.shelf-body');
  const count = main.querySelector('.count');
  const syncToggles = () => {
    main.querySelectorAll('[data-view]').forEach((b) => { b.classList.toggle('on', b.dataset.view === view); b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
    main.querySelectorAll('[data-density]').forEach((b) => { b.classList.toggle('on', b.dataset.density === density); b.setAttribute('aria-pressed', String(b.dataset.density === density)); });
  };
  const grid = (list) => html`<div class="grid ${density === 'dense' ? 'dense' : ''}">${list.map(tileHtml)}</div>`;
  const draw = () => {
    syncToggles();
    const list = filterAndSort(entries, filters);
    const filtered = filters.q || filters.type || filters.status || filters.favorite || filters.tag;
    count.textContent = filtered ? `${list.length} / ${entries.length}作品` : `${entries.length}作品`;
    if (!list.length) {
      body.innerHTML = String(html`<div class="state grid-empty"><p>条件に合う作品がありません。</p><button type="button" class="btn small" data-act="reset">絞り込みを解除</button></div>`);
    } else if (view === 'year') {
      body.innerHTML = String(html`${groupByYear(list).map((g) => html`<section class="year-section">
        <div class="year-head"><h2>${g.label}</h2><span>${g.items.length}作品</span></div>
        ${grid(g.items)}
      </section>`)}`);
    } else {
      body.innerHTML = String(grid(list));
    }
  };
  draw();

  const q = main.querySelector('input[name="q"]');
  q.addEventListener('input', debounce(() => { filters.q = q.value; draw(); }, 150));
  main.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'status' || el.name === 'tag' || el.name === 'sort') {
      filters[el.name] = el.value;
      el.classList.toggle('on', el.name !== 'sort' && !!el.value);
      draw();
    }
  });
  main.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.type !== undefined) {
      filters.type = t.dataset.type;
      main.querySelectorAll('.type-chips .chip').forEach((c) => c.classList.toggle('on', c === t));
      draw();
    } else if (t.dataset.view) {
      view = t.dataset.view;
      setShelfView(view);
      draw();
    } else if (t.dataset.density) {
      density = t.dataset.density;
      setDensity(density);
      draw();
    } else if (t.dataset.act === 'fav') {
      filters.favorite = !filters.favorite;
      t.classList.toggle('on', filters.favorite);
      t.setAttribute('aria-pressed', String(filters.favorite));
      draw();
    } else if (t.dataset.act === 'random') {
      pickRandom(ctx);
    } else if (t.dataset.act === 'reset') {
      Object.assign(filters, { q: '', type: '', status: '', favorite: false, tag: '' });
      ctx.rerender();
    }
  });
}
