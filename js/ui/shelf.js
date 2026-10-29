// ホーム／作品棚：目録の表紙、振り返り、検索・絞り込み、3つの見せ方（表紙・背表紙・年表）。
import { html, debounce, expDateEnd } from '../util.js';
import {
  TYPES, TYPES_EN, STATUSES, VERBS, shelfEntries, filterAndSort, flashback, allTags, groupByYear, plannedWorks, catalogNumbers, catalogLabel,
} from '../model.js';
import { getShelfView, setShelfView } from '../prefs.js';
import { knownTint, tintAll, luminance } from '../tint.js';
import { coverHtml, choose, placeholderColor } from './components.js';
import { icon, TYPE_ICON } from './icons.js';

const SORTS = { recent: '最近記録した順', experienced: '体験した時期順', score: '点数順' };
const VIEWS = { shelf: 'Covers', spine: 'Spines', year: 'Years' };
const filters = { q: '', type: '', status: '', favorite: false, tag: '', sort: 'recent' };

function agoLabel(exp, now = new Date()) {
  const ref = expDateEnd(exp.date) || new Date(exp.createdAt);
  const months = (now.getFullYear() - ref.getFullYear()) * 12 + (now.getMonth() - ref.getMonth());
  if (months >= 12) {
    const y = Math.floor(months / 12);
    return { en: y === 1 ? 'a year ago' : `${y} years ago`, ja: `${y}年前` };
  }
  const m = Math.max(months, 3);
  return { en: `${m} months ago`, ja: `${m}か月前` };
}

function mastheadHtml(data) {
  const counts = { movie: 0, book: 0, anime: 0 };
  for (const w of data.works) counts[w.type]++;
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  return html`<header class="masthead">
    <div class="kicker">A private archive of afterglow</div>
    <div class="mh-count"><span class="num">${data.works.length}</span><span class="unit">${data.works.length === 1 ? 'work' : 'works'}</span></div>
    <div class="mh-break">
      ${Object.entries(counts).map(([t, n]) => html`<span>${TYPES_EN[t]} <b>${String(n).padStart(2, '0')}</b></span>`)}
    </div>
    <div class="mh-date">${today}</div>
  </header>`;
}

function flashbackHtml(data) {
  const picks = flashback(data);
  if (!picks.length) return '';
  return html`<section class="flashback" aria-labelledby="fb-title">
    <div class="kicker" id="fb-title">あの頃の余韻 — Look back</div>
    <div class="fb-list">
      ${picks.map(({ work, experience }) => {
        const ago = agoLabel(experience);
        const tint = knownTint(work.cover.url);
        return html`<a class="fb-item" href="#/work/${work.id}" data-cover="${work.cover.url || ''}" ${tint ? html`style="--tint:${tint}"` : ''}>
          ${coverHtml(work, { eager: true })}
          <div class="fb-text">
            <span class="fb-when">${ago.en}</span>
            <span class="fb-ago">${ago.ja}に${VERBS[work.type]}</span>
            <span class="fb-title">${work.title}${work.volume ? html` <small class="muted">${work.volume}</small>` : ''}</span>
            ${experience.comment ? html`<span class="fb-comment">${experience.comment}</span>` : ''}
          </div>
        </a>`;
      })}
    </div>
  </section>`;
}

function tileHtml({ work, latest }, i, nums) {
  const score = latest?.score;
  const statusLabel = work.status === 'planned' || work.status === 'inprogress' || work.status === 'dropped' ? STATUSES[work.status] : '';
  return html`<a class="tile" href="#/work/${work.id}" style="--i:${Math.min(i, 24)}">
    <div class="tile-cover">
      ${coverHtml(work)}
      ${work.favorite ? html`<span class="fav-mark" aria-label="お気に入り"></span>` : ''}
    </div>
    <div class="tile-meta">
      <span class="tile-no">${catalogLabel(nums.get(work.id))} · ${TYPES_EN[work.type]}${statusLabel ? html` · <b class="tile-status">${statusLabel}</b>` : ''}</span>
      <span class="tile-title">${work.title}${work.volume ? html` <small>${work.volume}</small>` : ''}</span>
      <span class="tile-score ${score == null ? 'unscored' : ''}">${score == null ? '—' : score}</span>
    </div>
  </a>`;
}

// ---- 背表紙 ----

function hashOf(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

function spineColors(work) {
  const c = knownTint(work.cover.url) || placeholderColor(work.title);
  const dark = luminance(c) > 0.42;
  return { c, t: dark ? '#161513' : '#f4efe5' };
}

function spineHtml({ work, latest }, i, nums) {
  const h = hashOf(work.id);
  const len = [...work.title].length;
  const width = Math.max(30, Math.min(52, 26 + len * 1.4 + (h % 7)));
  const base = work.type === 'book' ? 168 : work.type === 'movie' ? 196 : 182;
  const height = base + (h % 28) - 8;
  const { c, t } = spineColors(work);
  const lean = h % 13 === 0 && i % 9 !== 0;
  return html`<div class="spine-slot" style="--i:${Math.min(i, 40)}">
    <a class="spine ${work.favorite ? 'fav' : ''} ${lean ? 'lean' : ''}" href="#/work/${work.id}" data-cover="${work.cover.url || ''}"
      style="--w:${width}px;--h:${height}px;--c:${c};--t:${t}" title="${work.title}${work.volume ? ` ${work.volume}` : ''}">
      <span class="spine-title">${work.title}${work.volume ? ` ${work.volume}` : ''}</span>
      ${latest?.score != null ? html`<span class="spine-score">${latest.score}</span>` : ''}
      <span class="spine-no">${String(nums.get(work.id)).padStart(3, '0')}</span>
    </a>
  </div>`;
}

// ---- 表紙を傾ける（マウス・ペンのとき） ----

function enableTilt(root) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  root.addEventListener('pointermove', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const r = tile.querySelector('.cover').getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    tile.classList.add('tilting');
    tile.style.setProperty('--ry', `${(x * 16).toFixed(2)}deg`);
    tile.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
    tile.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
    tile.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
  });
  root.addEventListener('pointerout', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || tile.contains(e.relatedTarget)) return;
    tile.classList.remove('tilting');
    tile.style.removeProperty('--rx');
    tile.style.removeProperty('--ry');
  });
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
      html`<div class="kicker" style="justify-content:center">Tonight's pick</div>
        <div class="random-cover">${coverHtml(w, { eager: true })}</div>
        <h2 class="dialog-title">${w.title}${w.volume ? html` <small class="muted">${w.volume}</small>` : ''}</h2>
        <p class="muted small">${[TYPES[w.type], w.year ? `${w.year}年` : '', w.creator].filter(Boolean).join(' · ')}</p>
        <p class="hint">「これから」の${list.length}作品から選びました</p>`,
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
      <div class="ripple-hero" aria-hidden="true"><i></i><i></i><i></i><b></b></div>
      <div class="kicker" style="justify-content:center">No.000 — Empty shelf</div>
      <h1>まだ、なにも響いていない棚。</h1>
      <p>観た映画、読んだ本、アニメを並べていきましょう。<br>点数や感想は、あとからでも書けます。</p>
      <a class="btn accent" href="#/add">${icon('plus', { size: 18 })}最初の作品を追加</a>
    </section>`);
    return;
  }

  const tags = allTags(data);
  if (filters.tag && !tags.includes(filters.tag)) filters.tag = '';
  const planned = plannedWorks(data).length;
  const nums = catalogNumbers(data);
  let view = getShelfView();
  if (!VIEWS[view]) view = 'shelf';

  main.innerHTML = String(html`
    ${mastheadHtml(data)}
    ${flashbackHtml(data)}
    <section class="shelf" aria-label="作品棚">
      <div class="kicker">The shelf</div>
      <div class="shelf-tools">
        <label class="search-bar">${icon('search', { size: 18 })}
          <input type="search" name="q" value="${filters.q}" placeholder="タイトル、作者、自分のメモから探す" aria-label="検索" autocomplete="off">
        </label>
      </div>
      <div class="filter-row" role="group" aria-label="絞り込み">
        <div class="chips type-chips">
          <button type="button" class="chip ${filters.type === '' ? 'on' : ''}" data-type="">すべて</button>
          ${Object.entries(TYPES).map(([v, l]) => html`<button type="button" class="chip ${filters.type === v ? 'on' : ''}" data-type="${v}">${icon(TYPE_ICON[v], { size: 14 })}${l}</button>`)}
        </div>
        <div class="chips">
          <button type="button" class="chip fav ${filters.favorite ? 'on' : ''}" data-act="fav" aria-pressed="${filters.favorite}">${icon('star', { size: 14 })}お気に入り</button>
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
        ${planned ? html`<button type="button" class="pick-random" data-act="random">${icon('shuffle', { size: 14 })}何にしよう？</button>` : ''}
        <div class="view-tabs" role="group" aria-label="見せ方">
          ${Object.entries(VIEWS).map(([v, l]) => html`<button type="button" data-view="${v}" aria-pressed="${view === v}">${l}</button>`)}
        </div>
      </div>
      <div class="shelf-body"></div>
    </section>`);

  const entries = shelfEntries(data);
  const body = main.querySelector('.shelf-body');
  const count = main.querySelector('.count');
  const useProxy = repo.settings.coverProxy !== false;

  // 振り返りカードの色を表紙から拾う
  const fbItems = [...main.querySelectorAll('.fb-item[data-cover]')].filter((el) => el.dataset.cover);
  tintAll(fbItems.map((el) => el.dataset.cover), (url, tint) => {
    fbItems.filter((el) => el.dataset.cover === url).forEach((el) => el.style.setProperty('--tint', tint));
  }, { useProxy });

  const draw = () => {
    main.querySelectorAll('[data-view]').forEach((b) => { b.classList.toggle('on', b.dataset.view === view); b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
    const list = filterAndSort(entries, filters);
    const filtered = filters.q || filters.type || filters.status || filters.favorite || filters.tag;
    count.textContent = filtered ? `${list.length} / ${entries.length} works` : `${entries.length} works`;
    if (!list.length) {
      body.innerHTML = String(html`<div class="state grid-empty"><p>条件に合う作品がありません。</p><button type="button" class="btn small" data-act="reset">絞り込みを解除</button></div>`);
      return;
    }
    if (view === 'spine') {
      body.innerHTML = String(html`<div class="spines">${list.map((e, i) => spineHtml(e, i, nums))}</div>`);
      // 背表紙の色を表紙から拾って、少しずつ塗り替える
      const spines = [...body.querySelectorAll('.spine[data-cover]')].filter((el) => el.dataset.cover);
      tintAll(spines.map((el) => el.dataset.cover), (url, tint) => {
        const t = luminance(tint) > 0.42 ? '#161513' : '#f4efe5';
        spines.filter((el) => el.dataset.cover === url).forEach((el) => { el.style.setProperty('--c', tint); el.style.setProperty('--t', t); });
      }, { useProxy });
    } else if (view === 'year') {
      body.innerHTML = String(html`${groupByYear(list).map((g) => html`<section class="year-section">
        <div class="year-head"><h2 class="${g.year === 'unknown' ? 'jp' : ''}">${g.year === 'unknown' ? '時期不明' : g.year}</h2><span>${g.items.length} works</span></div>
        <div class="grid">${g.items.map((e, i) => tileHtml(e, i, nums))}</div>
      </section>`)}`);
    } else {
      body.innerHTML = String(html`<div class="grid">${list.map((e, i) => tileHtml(e, i, nums))}</div>`);
    }
  };
  draw();
  enableTilt(body);

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
