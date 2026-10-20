// 共有画像：1〜9作品を選んで並べ、おすすめの一言を添えてPNG画像にする。
// 画像は端末に保存するか、LINEなどのアプリに直接送る（アプリからは何も公開しない）。
import { html, newId, nowIso, normalizeText } from '../util.js';
import { MAX_SHELF_ITEMS } from '../config.js';
import { findWork, latestExperience, buildImageData, DEFAULT_IMAGE_OPTIONS, shelfEntries, filterAndSort } from '../model.js';
import { describeError } from '../store/errors.js';
import { renderShelfImage } from '../png.js';
import { coverHtml, scoreText, toast, confirmDialog, downloadBlob, loadingHtml } from './components.js';

const TITLE_EXAMPLES = ['自分を構成する9作品', '設定に引き込まれた作品', '今年よかった作品'];
const OPTION_LABELS = {
  showTitle: '棚のタイトル',
  showWorkTitle: '作品名',
  showRecommendation: 'おすすめの一言',
  showScore: '点数',
};
const REC_HINT = 40;

export async function renderList(ctx) {
  const { repo } = ctx;
  const shelves = [...repo.data.shelves].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  ctx.main.innerHTML = String(html`<section class="page">
    <h1 class="page-title">共有画像</h1>
    <p class="lead">好きな作品を1〜9つ選んで、表紙を並べた画像を作れます。保存した画像は、LINEなどで自由に送れます。</p>
    <a class="btn primary wide" href="#/shares/new">新しく作る</a>
    ${shelves.length ? html`<ul class="shelf-list">${shelves.map((s) => html`<li><a class="shelf-card" href="#/shares/${s.id}">
      <div class="mini-covers">${s.items.slice(0, 3).map((it) => {
        const w = findWork(repo.data, it.workId);
        return w ? coverHtml(w, { size: 'mini' }) : '';
      })}</div>
      <div class="shelf-card-text"><span class="shelf-card-title">${s.title || '無題'}</span>
      <span class="muted">${s.items.length}作品</span></div>
    </a></li>`)}</ul>` : html`<p class="muted center empty-note">まだ作っていません。</p>`}
    ${repo.data.works.length ? '' : html`<p class="hint center">先に作品棚へ作品を追加してください。</p>`}
  </section>`);
}

export async function renderEditor(ctx, id) {
  const { repo } = ctx;
  const isNew = id === 'new';
  const saved = isNew ? null : repo.data.shelves.find((s) => s.id === id);
  if (!isNew && !saved) {
    ctx.main.innerHTML = String(html`<div class="state"><p>見つかりませんでした。</p><a class="btn" href="#/shares">共有画像へ</a></div>`);
    return;
  }
  const draft = saved
    ? structuredClone(saved)
    : { id: newId(), title: '', items: [], options: { ...DEFAULT_IMAGE_OPTIONS }, createdAt: null, updatedAt: null };
  let persisted = !!saved;
  let dirty = false;
  let lastImageUrl = null;
  const markDirty = () => { dirty = true; ctx.setDirty(true); };

  ctx.main.innerHTML = String(html`<section class="page shelf-editor">
    <a class="link-back" href="#/shares">← 共有画像の一覧</a>
    <h1 class="page-title">${isNew ? '共有画像を作る' : '共有画像を編集'}</h1>

    <label class="field"><span class="label">棚のタイトル</span>
      <input name="title" value="${draft.title}" maxlength="200" placeholder="例：自分を構成する9作品" autocomplete="off"></label>
    <div class="chips example-chips">${TITLE_EXAMPLES.map((t) => html`<button type="button" class="chip" data-act="example" data-text="${t}">${t}</button>`)}</div>

    <div class="section-head">
      <h2 class="section-title">作品 <small class="item-count"></small></h2>
      <button type="button" class="btn small" data-act="pick">作品を選ぶ</button>
    </div>
    <p class="hint">並び順は左のつまみをドラッグするか、↑↓で変えられます。おすすめの一言は画像に載ります（自分用の感想とは別です）。</p>
    <ol class="item-list"></ol>

    <fieldset class="field options">
      <legend class="label">画像に載せるもの</legend>
      ${Object.entries(OPTION_LABELS).map(([k, l]) => html`<label class="check"><input type="checkbox" name="${k}" ${draft.options[k] ? 'checked' : ''}><span>${l}</span></label>`)}
      <small class="hint">ひとこと感想・詳細メモ・誰と観たかは画像に載りません。</small>
    </fieldset>

    <div class="form-error" role="alert" hidden></div>
    <div class="actions">
      <button type="button" class="btn primary wide" data-act="render">画像を作る</button>
      <button type="button" class="btn wide" data-act="save">下書きを保存</button>
    </div>
    <section class="image-result" aria-live="polite"></section>
    ${isNew ? '' : html`<div class="btn-row end"><button type="button" class="btn ghost danger-text" data-act="delete">この共有画像を削除</button></div>`}
  </section>`);

  const main = ctx.main;
  const list = main.querySelector('.item-list');
  const errBox = main.querySelector('.form-error');
  const result = main.querySelector('.image-result');

  const drawItems = () => {
    main.querySelector('.item-count').textContent = `${draft.items.length} / ${MAX_SHELF_ITEMS}`;
    if (!draft.items.length) {
      list.innerHTML = String(html`<li class="empty-item"><button type="button" class="btn" data-act="pick">作品棚から選ぶ</button></li>`);
      return;
    }
    list.innerHTML = String(html`${draft.items.map((it, i) => {
      const w = findWork(repo.data, it.workId);
      const latest = latestExperience(repo.data, it.workId);
      return html`<li class="item-row" data-index="${i}">
        <div class="item-main">
          <span class="drag-handle" aria-hidden="true" title="ドラッグで並べ替え">⋮⋮</span>
          ${coverHtml(w, { size: 'mini' })}
          <div class="item-text"><span class="item-title">${w.title}${w.volume ? ` ${w.volume}` : ''}</span>
            <span class="muted small">${scoreText(latest?.score)}</span></div>
          <div class="item-buttons">
            <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
            <button type="button" class="icon-btn" data-act="down" ${i === draft.items.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
            <button type="button" class="icon-btn" data-act="remove" aria-label="外す">×</button>
          </div>
        </div>
        <textarea class="rec" rows="2" maxlength="2000" placeholder="人にすすめる一言（任意）" aria-label="${w.title}のおすすめの一言">${it.recommendation}</textarea>
        <small class="hint counter ${[...it.recommendation].length > REC_HINT ? 'over' : ''}">${[...it.recommendation].length}字（目安${REC_HINT}字）</small>
      </li>`;
    })}`);
  };
  drawItems();

  const move = (from, to) => {
    if (to < 0 || to >= draft.items.length || from === to) return;
    const [x] = draft.items.splice(from, 1);
    draft.items.splice(to, 0, x);
    markDirty();
    drawItems();
  };

  main.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'title') { draft.title = t.value; markDirty(); }
    if (t.classList.contains('rec')) {
      const i = Number(t.closest('.item-row').dataset.index);
      draft.items[i].recommendation = t.value;
      const c = t.nextElementSibling;
      const n = [...t.value].length;
      c.textContent = `${n}字（目安${REC_HINT}字）`;
      c.classList.toggle('over', n > REC_HINT);
      markDirty();
    }
  });
  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'checkbox' && t.name in OPTION_LABELS) { draft.options[t.name] = t.checked; markDirty(); }
  });

  async function save() {
    errBox.hidden = true;
    const now = nowIso();
    const toSave = { ...structuredClone(draft), title: draft.title.trim(), createdAt: draft.createdAt || now, updatedAt: now };
    await repo.mutate(`共有画像を保存：${toSave.title || '無題'}`, (d) => {
      // 別端末で削除された作品は外す
      toSave.items = toSave.items.filter((it) => d.works.some((w) => w.id === it.workId));
      const i = d.shelves.findIndex((s) => s.id === toSave.id);
      if (i >= 0) d.shelves[i] = toSave;
      else d.shelves.push(toSave);
    });
    draft.createdAt = toSave.createdAt;
    draft.updatedAt = toSave.updatedAt;
    persisted = true;
    dirty = false;
    ctx.setDirty(false);
    if (isNew) history.replaceState(null, '', `#/shares/${draft.id}`);
  }

  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const row = b.closest('.item-row');
    const i = row ? Number(row.dataset.index) : -1;
    if (act === 'example') {
      const input = main.querySelector('input[name="title"]');
      input.value = draft.title = b.dataset.text;
      markDirty();
    } else if (act === 'up') move(i, i - 1);
    else if (act === 'down') move(i, i + 1);
    else if (act === 'remove') {
      draft.items.splice(i, 1);
      markDirty();
      drawItems();
    } else if (act === 'pick') {
      const picked = await openPicker(repo.data, draft.items.map((it) => it.workId));
      if (!picked) return;
      const keep = new Map(draft.items.map((it) => [it.workId, it]));
      draft.items = picked.map((wid) => keep.get(wid) || { workId: wid, recommendation: '' });
      markDirty();
      drawItems();
    } else if (act === 'save') {
      b.disabled = true;
      try {
        await save();
        toast('保存しました');
      } catch (err) {
        errBox.textContent = `保存できませんでした。${describeError(err)} 入力内容は残っています。`;
        errBox.hidden = false;
      }
      b.disabled = false;
    } else if (act === 'render') {
      if (!draft.items.length) {
        errBox.textContent = '作品を1つ以上選んでください。';
        errBox.hidden = false;
        return;
      }
      b.disabled = true;
      // 画像作成の前に下書きを保存する（保存に失敗しても画像は作る）
      let saveError = null;
      if (dirty || !persisted) {
        try { await save(); } catch (err) { saveError = err; }
      }
      result.innerHTML = String(loadingHtml('画像を作成中…'));
      try {
        const data = buildImageData(repo.data, { ...draft, items: draft.items.filter((it) => findWork(repo.data, it.workId)) });
        const out = await renderShelfImage(data, { useProxy: repo.settings.coverProxy !== false });
        if (lastImageUrl) URL.revokeObjectURL(lastImageUrl);
        lastImageUrl = URL.createObjectURL(out.blob);
        showResult(out, lastImageUrl, saveError);
      } catch (err) {
        result.innerHTML = String(html`<div class="state state-error" role="alert"><p>画像を作れませんでした。${describeError(err)}</p></div>`);
      }
      b.disabled = false;
    } else if (act === 'delete') {
      const ok = await confirmDialog('この共有画像の設定（選んだ作品・おすすめの一言）を削除します。作品棚の記録は消えません。保存・送信済みの画像には影響しません。', { okLabel: '削除する', danger: true });
      if (!ok) return;
      try {
        await repo.mutate('共有画像を削除', (d) => { d.shelves = d.shelves.filter((s) => s.id !== draft.id); });
        ctx.setDirty(false);
        toast('削除しました');
        ctx.navigate('/shares', { replace: true });
      } catch (err) {
        toast(`削除できませんでした。${describeError(err)}`, 'error');
      }
    } else if (act === 'download') {
      downloadBlob(result._blob, fileName(draft.title));
    } else if (act === 'send') {
      const file = new File([result._blob], fileName(draft.title), { type: 'image/png' });
      try {
        await navigator.share({ files: [file], title: draft.title || '' });
      } catch (err) {
        if (err?.name !== 'AbortError') toast('送信画面を開けませんでした。画像を保存してから送ってください。', 'error');
      }
    }
  });

  function showResult(out, url, saveError) {
    result._blob = out.blob;
    const canShare = (() => {
      try {
        return !!navigator.canShare?.({ files: [new File([out.blob], 'a.png', { type: 'image/png' })] });
      } catch { return false; }
    })();
    result.innerHTML = String(html`
      ${saveError ? html`<p class="form-error">下書きは保存できませんでした（${describeError(saveError)}）。画像は作成できています。</p>` : ''}
      <img class="result-img" src="${url}" alt="作成した共有画像" width="${out.width}" height="${out.height}">
      ${out.failed.length ? html`<p class="hint warn">表紙を読み込めず仮表紙にした作品：${out.failed.join('、')}</p>` : ''}
      <div class="actions">
        ${canShare ? html`<button type="button" class="btn primary wide" data-act="send">LINEなどで送る</button>` : ''}
        <button type="button" class="btn wide ${canShare ? '' : 'primary'}" data-act="download">画像を保存</button>
      </div>
      <p class="hint">iPhoneでは画像を長押しして「"写真"に保存」もできます。送った画像はあとから取り消せません。</p>`);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- ドラッグで並べ替え（タッチ・マウス共通） ----
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    const rowEl = handle.closest('.item-row');
    const from = Number(rowEl.dataset.index);
    let to = from;
    rowEl.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    // to = 取り出した後のリストで何番目に入れるか
    const onMove = (ev) => {
      const rows = [...list.querySelectorAll('.item-row')];
      const others = rows.filter((_, k) => k !== from);
      to = others.filter((r) => {
        const b = r.getBoundingClientRect();
        return ev.clientY > b.top + b.height / 2;
      }).length;
      rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
      if (to < others.length) others[to].classList.add('drop-before');
      else if (others.length) others[others.length - 1].classList.add('drop-after');
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      rowEl.classList.remove('dragging');
      list.querySelectorAll('.drop-before,.drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
      move(from, to);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });

  return () => { if (lastImageUrl) URL.revokeObjectURL(lastImageUrl); };
}

function fileName(title) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const safe = (title || 'yoin').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  return `${safe}_${stamp}.png`;
}

/** 作品棚から選ぶダイアログ。選んだ順を保つ。キャンセルなら null */
function openPicker(data, selectedIds) {
  return new Promise((resolve) => {
    const selected = [...selectedIds];
    const entries = filterAndSort(shelfEntries(data), { sort: 'recent' });
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog picker';
    dlg.innerHTML = String(html`<div class="picker-head">
        <input type="search" placeholder="タイトルで絞り込み" aria-label="絞り込み" autocomplete="off">
        <span class="picker-count"></span>
      </div>
      <div class="picker-grid">${entries.map(({ work }) => html`<button type="button" class="pick-tile" data-id="${work.id}" data-key="${normalizeText(`${work.title} ${work.creator} ${work.volume}`)}">
        ${coverHtml(work, { size: '' })}<span class="pick-title">${work.title}</span><span class="pick-badge" aria-hidden="true"></span>
      </button>`)}</div>
      ${entries.length ? '' : html`<p class="muted center">作品棚に作品がありません。</p>`}
      <div class="dialog-actions">
        <button type="button" class="btn primary" data-act="done">決定</button>
        <button type="button" class="btn ghost" data-act="cancel">キャンセル</button>
      </div>`);
    document.body.appendChild(dlg);
    const sync = () => {
      dlg.querySelector('.picker-count').textContent = `${selected.length} / ${MAX_SHELF_ITEMS}`;
      dlg.querySelectorAll('.pick-tile').forEach((t) => {
        const n = selected.indexOf(t.dataset.id);
        t.classList.toggle('on', n >= 0);
        t.setAttribute('aria-pressed', String(n >= 0));
        t.querySelector('.pick-badge').textContent = n >= 0 ? String(n + 1) : '';
      });
    };
    sync();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener('click', (e) => {
      const tile = e.target.closest('.pick-tile');
      if (tile) {
        const n = selected.indexOf(tile.dataset.id);
        if (n >= 0) selected.splice(n, 1);
        else if (selected.length >= MAX_SHELF_ITEMS) toast(`選べるのは${MAX_SHELF_ITEMS}作品までです`);
        else selected.push(tile.dataset.id);
        sync();
        return;
      }
      const b = e.target.closest('button[data-act]');
      if (b?.dataset.act === 'done') finish(selected);
      if (b?.dataset.act === 'cancel') finish(null);
    });
    dlg.querySelector('input').addEventListener('input', (e) => {
      const q = normalizeText(e.target.value);
      dlg.querySelectorAll('.pick-tile').forEach((t) => { t.hidden = q && !t.dataset.key.includes(q); });
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('close', () => finish(null));
    dlg.showModal();
  });
}
