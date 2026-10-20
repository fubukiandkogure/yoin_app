// ホーム／作品棚：振り返り、検索、絞り込み、並べ替え、表紙の一覧。
import { html, debounce, expDateEnd } from '../util.js';
import { TYPES, STATUSES, VERBS, shelfEntries, filterAndSort, flashback, allTags } from '../model.js';
import { coverHtml } from './components.js';

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
    <h2 id="fb-title" class="section-title">以前楽しんだ作品</h2>
    <div class="fb-list">
      ${picks.map(({ work, experience }) => html`<a class="fb-item" href="#/work/${work.id}">
        ${coverHtml(work, { size: 'small' })}
        <div class="fb-text">
          <span class="fb-when">${agoLabel(experience)}に${VERBS[work.type]}</span>
          <span class="fb-title">${work.title}</span>
          ${experience.comment ? html`<span class="fb-comment">「${experience.comment}」</span>` : ''}
        </div>
      </a>`)}
    </div>
  </section>`;
}

function tileHtml({ work, latest }) {
  const score = latest?.score;
  return html`<a class="tile" href="#/work/${work.id}">
    <div class="tile-cover">${coverHtml(work)}${work.favorite ? html`<span class="fav-mark" aria-label="お気に入り">★</span>` : ''}</div>
    <div class="tile-meta">
      <span class="tile-title">${work.title}${work.volume ? html` <small>${work.volume}</small>` : ''}</span>
      <span class="tile-score ${score == null ? 'unscored' : ''}">${score == null ? '—' : score}</span>
    </div>
  </a>`;
}

export async function render(ctx) {
  const { repo } = ctx;
  const data = repo.data;
  const main = ctx.main;

  if (!data.works.length) {
    main.innerHTML = String(html`<section class="empty-shelf">
      <div class="empty-art" aria-hidden="true"><span></span><span></span><span></span></div>
      <h1>まだ棚は空です</h1>
      <p>観た映画、読んだ本、アニメを並べていきましょう。<br>点数や感想はあとからでも書けます。</p>
      <a class="btn primary" href="#/add">最初の作品を追加</a>
    </section>`);
    return;
  }

  const tags = allTags(data);
  if (filters.tag && !tags.includes(filters.tag)) filters.tag = '';
  main.innerHTML = String(html`
    ${flashbackHtml(data)}
    <section class="shelf" aria-label="作品棚">
      <div class="search-bar">
        <input type="search" name="q" value="${filters.q}" placeholder="タイトルや自分のメモで検索" aria-label="検索" autocomplete="off">
      </div>
      <div class="filter-row" role="group" aria-label="絞り込み">
        <div class="chips type-chips">
          <button type="button" class="chip ${filters.type === '' ? 'on' : ''}" data-type="">すべて</button>
          ${Object.entries(TYPES).map(([v, l]) => html`<button type="button" class="chip ${filters.type === v ? 'on' : ''}" data-type="${v}">${l}</button>`)}
        </div>
        <div class="chips">
          <select name="status" class="chip-select ${filters.status ? 'on' : ''}" aria-label="状態">
            <option value="">状態</option>
            ${Object.entries(STATUSES).map(([v, l]) => html`<option value="${v}" ${filters.status === v ? 'selected' : ''}>${l}</option>`)}
          </select>
          <button type="button" class="chip ${filters.favorite ? 'on' : ''}" data-act="fav" aria-pressed="${filters.favorite}">★ お気に入り</button>
          ${tags.length ? html`<select name="tag" class="chip-select ${filters.tag ? 'on' : ''}" aria-label="タグ">
            <option value="">タグ</option>
            ${tags.map((t) => html`<option value="${t}" ${filters.tag === t ? 'selected' : ''}>#${t}</option>`)}
          </select>` : ''}
          <select name="sort" class="chip-select" aria-label="並べ替え">
            ${Object.entries(SORTS).map(([v, l]) => html`<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${l}</option>`)}
          </select>
        </div>
      </div>
      <p class="count" aria-live="polite"></p>
      <div class="grid"></div>
    </section>`);

  const entries = shelfEntries(data);
  const grid = main.querySelector('.grid');
  const count = main.querySelector('.count');
  const draw = () => {
    const list = filterAndSort(entries, filters);
    const filtered = filters.q || filters.type || filters.status || filters.favorite || filters.tag;
    count.textContent = filtered ? `${list.length} / ${entries.length}作品` : `${entries.length}作品`;
    if (!list.length) {
      grid.innerHTML = String(html`<div class="state grid-empty"><p>条件に合う作品がありません。</p><button type="button" class="btn small" data-act="reset">絞り込みを解除</button></div>`);
    } else {
      grid.innerHTML = String(html`${list.map(tileHtml)}`);
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
    } else if (t.dataset.act === 'fav') {
      filters.favorite = !filters.favorite;
      t.classList.toggle('on', filters.favorite);
      t.setAttribute('aria-pressed', String(filters.favorite));
      draw();
    } else if (t.dataset.act === 'reset') {
      Object.assign(filters, { q: '', type: '', status: '', favorite: false, tag: '' });
      ctx.rerender();
    }
  });
}
