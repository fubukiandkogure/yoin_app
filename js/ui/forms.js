// 作品情報・体験記録の入力欄と、その読み取り・検証。
import { html, makeExpDate, splitExpDate, parseTags, safeUrl } from '../util.js';
import { TYPES, STATUSES, VERBS } from '../model.js';
import { COMMENT_HINT_LENGTH } from '../config.js';

const MEMO_HINTS = ['どんな話？', '何がよかった？', '忘れたくない場面'];

export function statusOptions(selected) {
  return Object.entries(STATUSES).map(([v, l]) => html`<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`);
}

/** 作品の基本情報（タイトル・作者など）。外部データで補完した値もここで修正できる */
export function workInfoFields(w, { showType = false } = {}) {
  const volLabel = w.type === 'book' ? '巻・版' : w.type === 'anime' ? 'シーズン・期' : '版・バージョン';
  return html`
    ${showType ? html`<fieldset class="field">
      <legend>種別</legend>
      <div class="seg">${Object.entries(TYPES).map(([v, l]) => html`<label><input type="radio" name="type" value="${v}" ${w.type === v ? 'checked' : ''}><span>${l}</span></label>`)}</div>
    </fieldset>` : ''}
    <label class="field"><span class="label">タイトル <em class="req">必須</em></span>
      <input name="title" value="${w.title || ''}" required maxlength="500" autocomplete="off"></label>
    <div class="row2">
      <label class="field"><span class="label">${w.type === 'book' ? '著者' : '監督・制作'}</span>
        <input name="creator" value="${w.creator || ''}" maxlength="500" autocomplete="off"></label>
      <label class="field"><span class="label">公開・刊行年</span>
        <input name="year" value="${w.year ?? ''}" inputmode="numeric" pattern="\\d{1,4}" maxlength="4" autocomplete="off"></label>
    </div>
    <label class="field"><span class="label">${volLabel}</span>
      <input name="volume" value="${w.volume || ''}" maxlength="200" placeholder="${w.type === 'book' ? '例：3巻、文庫版' : w.type === 'anime' ? '例：第2期' : '例：ディレクターズカット版'}" autocomplete="off"></label>
    <label class="field"><span class="label">表紙画像のURL</span>
      <input name="coverUrl" value="${w.cover?.url || ''}" inputmode="url" maxlength="2000" placeholder="空欄なら仮表紙になります" autocomplete="off">
      ${w.cover?.credit ? html`<small class="hint">出典：${w.cover.credit}（URLを変えると出典は「手入力」になります）</small>` : ''}</label>`;
}

export function workStateFields(w, tagSuggestions = []) {
  return html`
    <div class="row2">
      <label class="field"><span class="label">状態</span>
        <select name="status">${statusOptions(w.status || 'done')}</select></label>
      <label class="field check fav-check"><input type="checkbox" name="favorite" ${w.favorite ? 'checked' : ''}><span>特別なお気に入り</span></label>
    </div>
    <label class="field"><span class="label">タグ</span>
      <input name="tags" value="${(w.tags || []).join(' ')}" placeholder="スペースか読点で区切る" list="tag-list" autocomplete="off">
      <datalist id="tag-list">${tagSuggestions.map((t) => html`<option value="${t}">`)}</datalist></label>`;
}

/** 体験記録の入力欄（点数・ひとこと・詳細メモ・時期・誰とどこで） */
export function experienceFields(e, type) {
  const d = splitExpDate(e?.date);
  const score = e?.score ?? null;
  const verb = VERBS[type] || '観た';
  return html`
    <div class="field score-field">
      <span class="label">点数 <small>0〜100点・空欄なら未採点</small></span>
      <div class="score-row">
        <input name="score" class="score-num" value="${score ?? ''}" inputmode="numeric" maxlength="3" placeholder="未採点" autocomplete="off" aria-label="点数">
        <input type="range" class="score-range ${score === null ? 'unset' : ''}" min="0" max="100" step="1" value="${score ?? 50}" aria-label="点数スライダー" tabindex="-1">
        <button type="button" class="btn small ghost" data-act="clear-score">未採点</button>
      </div>
    </div>
    <label class="field"><span class="label">ひとこと感想</span>
      <textarea name="comment" rows="2" maxlength="2000" placeholder="短く一言で">${e?.comment || ''}</textarea>
      <small class="hint counter" data-counter-for="comment"></small></label>
    <div class="field"><label for="memo-field" class="label">詳細メモ</label>
      <div class="chips hint-chips">${MEMO_HINTS.map((h) => html`<button type="button" class="chip" data-act="memo-hint" data-hint="${h}">${h}</button>`)}</div>
      <textarea id="memo-field" name="memo" rows="6" maxlength="50000" placeholder="${MEMO_HINTS.join(' / ')}">${e?.memo || ''}</textarea></div>
    <fieldset class="field date-field">
      <legend class="label">${verb}時期 <small>わかる範囲でOK（年だけでも）</small></legend>
      <div class="date-row">
        <input name="dYear" value="${d.year}" inputmode="numeric" maxlength="4" placeholder="年" aria-label="年" autocomplete="off">
        <select name="dMonth" aria-label="月"><option value="">月</option>${Array.from({ length: 12 }, (_, i) => html`<option value="${i + 1}" ${String(i + 1) === d.month ? 'selected' : ''}>${i + 1}月</option>`)}</select>
        <select name="dDay" aria-label="日"><option value="">日</option>${Array.from({ length: 31 }, (_, i) => html`<option value="${i + 1}" ${String(i + 1) === d.day ? 'selected' : ''}>${i + 1}日</option>`)}</select>
        <button type="button" class="btn small ghost" data-act="date-today">今日</button>
        <button type="button" class="btn small ghost" data-act="date-clear">不明</button>
      </div>
    </fieldset>
    <label class="field"><span class="label">誰と・どこで</span>
      <input name="note" value="${e?.note || ''}" maxlength="2000" placeholder="例：友達と映画館で" autocomplete="off"></label>
    <p class="hint private-note">感想・メモ・誰とどこでは、自分だけが見られます（共有には含まれません）。</p>`;
}

/** 入力欄の補助動作（点数スライダー、文字数、メモのヒント、今日ボタン） */
export function bindFormHelpers(form) {
  const num = form.querySelector('.score-num');
  const range = form.querySelector('.score-range');
  if (num && range) {
    range.addEventListener('input', () => {
      num.value = range.value;
      range.classList.remove('unset');
      num.dispatchEvent(new Event('input', { bubbles: true }));
    });
    num.addEventListener('input', () => {
      const v = Number(num.value);
      if (num.value.trim() === '') range.classList.add('unset');
      else if (Number.isInteger(v) && v >= 0 && v <= 100) {
        range.value = String(v);
        range.classList.remove('unset');
      }
    });
  }
  const updateCounter = () => {
    const c = form.querySelector('[data-counter-for="comment"]');
    const t = form.elements.comment;
    if (c && t) {
      const n = [...t.value].length;
      c.textContent = `${n}字（目安${COMMENT_HINT_LENGTH}字）`;
      c.classList.toggle('over', n > COMMENT_HINT_LENGTH);
    }
  };
  updateCounter();
  form.addEventListener('input', (ev) => { if (ev.target.name === 'comment') updateCounter(); });
  form.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'clear-score') {
      num.value = '';
      range.classList.add('unset');
      form.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (act === 'memo-hint') {
      const ta = form.elements.memo;
      const prefix = ta.value && !ta.value.endsWith('\n') ? '\n' : '';
      ta.value += `${prefix}【${btn.dataset.hint}】\n`;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      form.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (act === 'date-today') {
      const t = new Date();
      form.elements.dYear.value = String(t.getFullYear());
      form.elements.dMonth.value = String(t.getMonth() + 1);
      form.elements.dDay.value = String(t.getDate());
      form.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (act === 'date-clear') {
      form.elements.dYear.value = '';
      form.elements.dMonth.value = '';
      form.elements.dDay.value = '';
      form.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

export class FormError extends Error {}

/** 体験記録の入力を読む。何も入力されていなければ empty:true */
export function readExperience(form) {
  const f = form.elements;
  const scoreRaw = f.score.value.trim().normalize('NFKC');
  let score = null;
  if (scoreRaw !== '') {
    const n = Number(scoreRaw);
    if (!/^\d{1,3}$/.test(scoreRaw) || !Number.isInteger(n) || n < 0 || n > 100) throw new FormError('点数は0〜100の整数で入力してください（空欄なら未採点）。');
    score = n;
  }
  const yearRaw = f.dYear.value.trim().normalize('NFKC');
  if (yearRaw && !/^\d{4}$/.test(yearRaw)) throw new FormError('年は4桁の数字で入力してください。');
  if (!yearRaw && (f.dMonth.value || f.dDay.value)) throw new FormError('月日を入れる場合は年も入力してください。');
  if (yearRaw && !f.dMonth.value && f.dDay.value) throw new FormError('日を入れる場合は月も選んでください。');
  const date = makeExpDate(yearRaw, f.dMonth.value, f.dDay.value);
  if (f.dDay.value && date.precision !== 'day') throw new FormError('存在しない日付です。');
  const exp = {
    score,
    comment: f.comment.value.trim(),
    memo: f.memo.value.replace(/\s+$/, ''),
    date,
    note: f.note.value.trim(),
  };
  const empty = score === null && !exp.comment && !exp.memo.trim() && date.precision === 'unknown' && !exp.note;
  return { exp, empty };
}

/** 作品情報の入力を読む。original は編集前の作品（表紙の出典を引き継ぐため） */
export function readWorkInfo(form, original) {
  const f = form.elements;
  const title = f.title.value.trim();
  if (!title) throw new FormError('タイトルを入力してください。');
  const yearRaw = f.year.value.trim().normalize('NFKC');
  if (yearRaw && !/^\d{1,4}$/.test(yearRaw)) throw new FormError('年は数字で入力してください。');
  const coverUrl = f.coverUrl.value.trim();
  if (coverUrl && !safeUrl(coverUrl)) throw new FormError('表紙画像のURLは https:// から始まるURLを入力してください。');
  let cover;
  if (!coverUrl) {
    cover = { url: null, provider: null, credit: null, missingReason: original?.cover?.url ? 'removed' : (original?.cover?.missingReason || 'manual') };
  } else if (coverUrl === original?.cover?.url) {
    cover = { ...original.cover };
  } else {
    cover = { url: safeUrl(coverUrl), provider: 'manual', credit: '画像：手入力', missingReason: null };
  }
  return {
    type: f.type ? f.type.value : original.type,
    title,
    creator: f.creator.value.trim(),
    year: yearRaw ? Number(yearRaw) : null,
    volume: f.volume.value.trim(),
    cover,
  };
}

export function readWorkState(form) {
  const f = form.elements;
  return { status: f.status.value, favorite: f.favorite.checked, tags: parseTags(f.tags.value) };
}
