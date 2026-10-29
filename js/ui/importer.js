// まとめて追加：メモを貼り付け → 自動で作品を探して当てはめ → 確かめて → 一度に保存。
import { html, newId } from '../util.js';
import { TYPES, findWork, findDuplicates } from '../model.js';
import { searchWorks, resolveCandidate } from '../search/index.js';
import { verifyCover } from '../search/books.js';
import { parseImportText, matchRow, workKey } from '../importer.js';
import { describeError } from '../store/errors.js';
import { coverHtml, toast, confirmDialog } from './components.js';
import { candToWork } from './add.js';
import { icon, TYPE_ICON } from './icons.js';

const EXAMPLE = `作品名 80
作品名 75 ひとことはここに
作品名 / 著者 90
（補足は、かっこで囲んだ行に）
> 長い感想は「>」で始めると詳細メモになります`;

let st = null;
const fresh = (type = 'anime') => ({ step: 'input', type, text: '', rows: [], running: false, done: 0, saving: false });

const LEVEL = {
  ok: { label: '', cls: '' },
  check: { label: '確認してください', cls: 'check' },
  none: { label: '見つかりませんでした（表紙なしで登録）', cls: 'none' },
};

function rowWork(type, r) {
  if (r.choice) {
    const w = candToWork(r.choice);
    if (!w.volume && r.volume) w.volume = r.volume;
    if (!w.creator && r.creator) w.creator = r.creator;
    return w;
  }
  return candToWork({ provider: 'manual', type, title: r.title, creator: r.creator, volume: r.volume });
}

export async function render(ctx) {
  if (!st || st.step === 'input') st = fresh(st?.type);
  draw(ctx);
}

function draw(ctx) {
  const root = document.createElement('div');
  ctx.main.replaceChildren(root);
  const c = { ...ctx, main: root, repo: ctx.repo };
  if (st.step === 'review') return drawReview(c, ctx);
  return drawInput(c, ctx);
}

function drawInput(ctx, baseCtx) {
  ctx.setDirty(false);
  ctx.main.innerHTML = String(html`<section class="page importer">
    <a class="link-back" href="#/add">${icon('back', { size: 16 })}Add</a>
    <div class="kicker">Import — まとめて追加</div>
    <h1 class="page-title">メモから、まとめて棚へ。</h1>
    <p class="lead">これまでの記録を貼り付けると、作品を探して表紙と一緒に並べます。保存する前に、ひとつずつ確かめられます。</p>
    <div class="seg type-seg" role="radiogroup" aria-label="種別">
      ${Object.entries(TYPES).map(([v, l]) => html`<button type="button" role="radio" aria-checked="${st.type === v}" class="${st.type === v ? 'on' : ''}" data-type="${v}">${icon(TYPE_ICON[v], { size: 17 })}${l}</button>`)}
    </div>
    <label class="field import-field"><span class="label">メモ <small>1行に1作品</small></span>
      <textarea name="text" rows="12" placeholder="${EXAMPLE}" spellcheck="false">${st.text}</textarea></label>
    <details class="import-help">
      <summary>書き方</summary>
      <ul>
        <li><b>タイトル 点数 ひとこと</b> … 点数の後ろはひとこと感想になります（点数がなければ未採点）</li>
        <li><b>タイトル / 著者 点数</b> … 「 / 」の後ろは著者・監督（本はこれがあると見つかりやすい）</li>
        <li><b>（ ）だけの行</b>、<b>「&gt;」で始まる行</b> … 直前の作品の詳細メモになります</li>
        <li>「ゆるキャン」「このすば」のような略称や、ちょっとした打ち間違いも、なるべく探し当てます</li>
        <li>同じ作品が2回出てきたら、ひとつの作品に記録を2つ残します（再鑑賞と同じ扱い）</li>
      </ul>
    </details>
    <div class="form-error" role="alert" hidden></div>
    <div class="actions sticky-actions"><button type="button" class="btn primary wide" data-act="parse">${icon('search', { size: 18 })}読み取って作品を探す</button></div>
  </section>`);
  const ta = ctx.main.querySelector('textarea');
  ta.addEventListener('input', () => { st.text = ta.value; });
  ctx.main.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.type) {
      st.type = b.dataset.type;
      ctx.main.querySelectorAll('[data-type]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    } else if (b.dataset.act === 'parse') {
      const rows = parseImportText(ta.value);
      if (!rows.length) {
        const err = ctx.main.querySelector('.form-error');
        err.textContent = '読み取れる行がありませんでした。1行に1作品ずつ書いてください。';
        err.hidden = false;
        return;
      }
      if (rows.length > 300) {
        const err = ctx.main.querySelector('.form-error');
        err.textContent = '一度に追加できるのは300件までです。分けて貼り付けてください。';
        err.hidden = false;
        return;
      }
      st.rows = rows.map((r, i) => ({ ...r, i, include: true, status: 'wait', candidates: [], choice: null, level: null, existing: null }));
      st.step = 'review';
      draw(baseCtx);
      runMatching(baseCtx);
    }
  });
}

/** 行ごとに作品を探す（映画・アニメは3件ずつ並行、本は1件ずつ間をあけて） */
async function runMatching(ctx) {
  st.running = true;
  st.done = 0;
  const settings = ctx.repo.settings;
  const type = st.type;
  // 本はまず Google Books で素早く探し、確実でないときだけ国立国会図書館サーチも使う（遅いことがあるため）
  const search = (t, q) => searchWorks(t, q, settings, { googleFirst: true });
  search.deep = (t, q) => searchWorks(t, q, settings);
  const queue = [...st.rows];
  const book = type === 'book';
  const worker = async () => {
    while (queue.length && st.step === 'review') {
      const r = queue.shift();
      r.status = 'searching';
      redrawRow(ctx, r);
      const res = await matchRow(type, r, search, { pause: book ? 300 : 0 });
      r.candidates = res.candidates;
      r.level = res.level;
      r.choice = res.level === 'none' ? null : res.best;
      if (r.choice) r.choice = await finalize(r.choice, settings);
      markExisting(ctx, r);
      r.status = 'done';
      st.done++;
      redrawRow(ctx, r);
      redrawSummary(ctx);
      if (book) await new Promise((res2) => setTimeout(res2, 400));
    }
  };
  await Promise.all(Array.from({ length: book ? 1 : 3 }, worker));
  st.running = false;
  redrawSummary(ctx);
}

/** 選んだ候補の仕上げ：映画・アニメは監督や制作を補い、本は書影が実在するか確かめる */
async function finalize(cand, settings) {
  let c = cand;
  if (c.provider === 'tmdb') {
    try { c = await resolveCandidate(c, settings); } catch { /* 詳細なしでも登録できる */ }
  }
  if (c.cover?.unverified) {
    const ok = await verifyCover(c.cover.url);
    const { unverified, ...rest } = c.cover;
    c = { ...c, cover: ok ? rest : null };
  }
  return c;
}

function markExisting(ctx, r) {
  const w = rowWork(st.type, r);
  const dup = findDuplicates(ctx.repo.data, w)[0] || null;
  r.existing = dup ? { id: dup.id, title: dup.title } : null;
  if (dup && r.include === true && !r.touched) r.include = false;
}

function groupCounts() {
  const counts = new Map();
  for (const r of st.rows) {
    if (!r.include || r.existing) continue;
    const k = workKey(rowWork(st.type, r));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function rowHtml(r, groups) {
  const w = rowWork(st.type, r);
  const lv = r.status === 'done' ? LEVEL[r.level] : null;
  const merged = r.include && !r.existing && (groups.get(workKey(w)) || 0) > 1;
  return html`<li class="imp-row ${r.include ? '' : 'off'} ${lv?.cls || ''}" data-i="${r.i}">
    <label class="imp-check"><input type="checkbox" ${r.include ? 'checked' : ''} data-act="toggle" aria-label="追加する"></label>
    <button type="button" class="imp-cover" data-act="choose" aria-label="候補を変える">
      ${r.status === 'done' ? coverHtml(w, { size: 'thumb', thumb: true }) : html`<span class="imp-wait">${r.status === 'searching' ? html`<span class="spinner"></span>` : ''}</span>`}
    </button>
    <div class="imp-main">
      <div class="imp-title">${r.status === 'done' ? html`${w.title}${w.volume ? html` <small>${w.volume}</small>` : ''}` : r.title}</div>
      <div class="imp-sub">
        ${r.status === 'done' ? [w.year ? `${w.year}` : '', w.creator].filter(Boolean).join(' · ') : '探しています…'}
      </div>
      <div class="imp-src">${r.line}${r.memo ? html`<br><span class="muted">${r.memo}</span>` : ''}</div>
      <div class="imp-tags">
        ${lv?.label ? html`<span class="imp-tag ${lv.cls}">${lv.label}</span>` : ''}
        ${r.existing ? html`<span class="imp-tag dup">棚にあります${r.include ? '（記録を追加）' : '（追加しない）'}</span>` : ''}
        ${merged ? html`<span class="imp-tag merge">同じ作品にまとめます</span>` : ''}
      </div>
    </div>
    <div class="imp-score ${r.score == null ? 'unscored' : ''}">${r.score == null ? '—' : r.score}</div>
  </li>`;
}

function summaryHtml() {
  const total = st.rows.length;
  const inc = st.rows.filter((r) => r.include).length;
  const check = st.rows.filter((r) => r.status === 'done' && r.include && r.level === 'check').length;
  const none = st.rows.filter((r) => r.status === 'done' && r.include && r.level === 'none').length;
  const keyErr = st.rows.find((r) => r.error?.kind === 'auth');
  return html`<div class="imp-summary">
    ${keyErr ? html`<p class="form-error">${keyErr.error.message} 設定でキーを登録してから、もう一度読み取ると表紙付きで探せます。</p>` : ''}
    <div class="imp-progress"><span style="width:${total ? Math.round((st.done / total) * 100) : 0}%"></span></div>
    <div class="imp-stats">
      <span><b class="num">${st.done}</b>/${total} 探しました</span>
      ${check ? html`<span class="imp-tag check">確認 ${check}</span>` : ''}
      ${none ? html`<span class="imp-tag none">表紙なし ${none}</span>` : ''}
    </div>
    <button type="button" class="btn accent wide" data-act="save" ${st.running || !inc || st.saving ? 'disabled' : ''}>
      ${st.running ? '探しています…' : st.saving ? '保存しています…' : html`${icon('check', { size: 18 })}${inc}件を棚に追加`}
    </button>
  </div>`;
}

function drawReview(ctx, baseCtx) {
  ctx.setDirty(true);
  const groups = groupCounts();
  ctx.main.innerHTML = String(html`<section class="page importer">
    <button type="button" class="link-back" data-act="back">${icon('back', { size: 16 })}メモに戻る</button>
    <div class="kicker">Import — ${TYPES[st.type]}</div>
    <h1 class="page-title">確かめて、追加。</h1>
    <p class="hint">表紙をタップすると候補を選び直せます。チェックを外した行は追加しません。黄色は念のため確認、灰色は見つからなかった作品です（表紙なしで登録されます）。</p>
    <ol class="imp-list">${st.rows.map((r) => rowHtml(r, groups))}</ol>
    <div class="imp-footer">${summaryHtml()}</div>
  </section>`);
  ctx.main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const li = b.closest('.imp-row');
    const r = li ? st.rows[Number(li.dataset.i)] : null;
    if (b.dataset.act === 'back') {
      const ok = !st.rows.length || await confirmDialog('探した結果は消えます（メモの文章は残ります）。戻りますか？', { okLabel: '戻る' });
      if (!ok) return;
      st.step = 'input';
      st.rows = [];
      draw(baseCtx);
    } else if (b.dataset.act === 'choose' && r && r.status === 'done') {
      const picked = await chooseCandidate(baseCtx, r);
      if (picked === undefined) return;
      r.choice = picked ? await finalize(picked, baseCtx.repo.settings) : null;
      r.level = picked ? 'ok' : 'none';
      r.touched = true;
      markExisting(baseCtx, r);
      redrawAll(ctx);
    } else if (b.dataset.act === 'save') {
      await save(baseCtx, b);
    }
  });
  ctx.main.addEventListener('change', (e) => {
    if (e.target.dataset.act !== 'toggle') return;
    const r = st.rows[Number(e.target.closest('.imp-row').dataset.i)];
    r.include = e.target.checked;
    r.touched = true;
    redrawAll(ctx);
  });
  st.view = ctx.main;
}

function redrawRow(ctx, r) {
  const li = st.view?.querySelector(`.imp-row[data-i="${r.i}"]`);
  if (li) li.outerHTML = String(rowHtml(r, groupCounts()));
}
function redrawSummary() {
  const f = st.view?.querySelector('.imp-footer');
  if (f) f.innerHTML = String(summaryHtml());
}
function redrawAll() {
  const list = st.view?.querySelector('.imp-list');
  if (!list) return;
  const groups = groupCounts();
  list.innerHTML = String(html`${st.rows.map((r) => rowHtml(r, groups))}`);
  redrawSummary();
}

/** 候補の選び直し。null は「表紙なしで登録」、undefined はキャンセル */
function chooseCandidate(ctx, r) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog picker';
    dlg.innerHTML = String(html`<div class="picker-head">
        <form class="cf-form">${icon('search', { size: 18 })}<input name="q" value="${r.title}${r.creator && st.type === 'book' ? ` ${r.creator}` : ''}" aria-label="検索語" autocomplete="off" enterkeyhint="search"></form>
        <button type="button" class="icon-btn" data-act="close" aria-label="閉じる">${icon('close', { size: 18 })}</button>
      </div>
      <p class="hint cf-hint">メモ：${r.line}</p>
      <div class="picker-grid"></div>
      <div class="dialog-actions"><button type="button" class="btn" data-act="manual">表紙なしで「${r.title}」として登録</button></div>`);
    document.body.appendChild(dlg);
    const grid = dlg.querySelector('.picker-grid');
    let list = r.candidates;
    const paint = () => {
      grid.innerHTML = list.length ? String(html`${list.map((c, i) => html`<button type="button" class="pick-tile" data-i="${i}">
        ${coverHtml(c.cover ? c : { ...c, cover: { missingReason: 'no_image' } }, { thumb: true })}
        <span class="pick-title">${c.title}${c.volume ? ` ${c.volume}` : ''}</span>
        <span class="pick-sub">${[c.year, c.extra || c.publisher].filter(Boolean).join(' · ')}</span>
      </button>`)}`) : String(html`<div class="state" style="grid-column:1/-1"><p>候補がありません。検索語を変えてみてください。</p></div>`);
    };
    paint();
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (dlg.open) dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('.cf-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = e.target.elements.q.value.trim();
      if (!q) return;
      grid.innerHTML = String(html`<div class="state state-loading" style="grid-column:1/-1"><span class="spinner"></span>探しています…</div>`);
      try {
        list = (await searchWorks(st.type, q, ctx.repo.settings)).slice(0, 24);
      } catch (err) {
        list = [];
        toast(describeError(err), 'error');
      }
      paint();
    });
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="close"]')) return finish(undefined);
      if (e.target.closest('[data-act="manual"]')) return finish(null);
      const t = e.target.closest('.pick-tile');
      if (t) finish(list[Number(t.dataset.i)]);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(undefined); });
    dlg.addEventListener('close', () => finish(undefined));
    dlg.showModal();
  });
}

async function save(ctx, btn) {
  const rows = st.rows.filter((r) => r.include);
  if (!rows.length) return;
  st.saving = true;
  redrawSummary();
  const base = Date.now();
  try {
    let added = 0;
    await ctx.repo.mutate(`まとめて追加：${rows.length}件`, (d) => {
      added = 0;
      const byKey = new Map();
      rows.forEach((r, i) => {
        const t = new Date(base + i * 1000).toISOString();
        let work = r.existing ? findWork(d, r.existing.id) : null;
        if (!work) {
          const w = rowWork(st.type, r);
          const key = workKey(w);
          work = byKey.get(key);
          if (!work) {
            work = { ...w, id: newId(), createdAt: t, updatedAt: t };
            d.works.push(work);
            byKey.set(key, work);
            added++;
          }
        }
        if (r.score != null || r.comment || r.memo) {
          d.experiences.push({
            id: newId(), workId: work.id, score: r.score, comment: r.comment.slice(0, 2000), memo: r.memo.slice(0, 50000),
            date: { precision: 'unknown', value: null }, note: '', createdAt: t, updatedAt: t,
          });
        }
      });
    });
    ctx.setDirty(false);
    toast(`${added}作品を棚に追加しました`);
    st = fresh(st.type);
    ctx.navigate('/', { replace: true });
  } catch (err) {
    st.saving = false;
    redrawSummary();
    toast(`保存できませんでした。${describeError(err)} もう一度「追加」を押してください。`, 'error');
  }
  return btn;
}
