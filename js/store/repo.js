// 記録データの読み書き窓口。保存先（GitHub／試用）の違いはアダプタが吸収する。
// 変更は「現在のデータに関数を適用 → 検証 → 丸ごと保存」で行い、競合時は最新を読み直して再適用する。
import { APP_ID } from '../config.js';
import { emptyData, validateData } from '../model.js';
import { nowIso } from '../util.js';
import { StoreError } from './errors.js';
import { GitHubAdapter } from './github.js';
import { LocalAdapter } from './local.js';

const KEY_CONNECTION = `${APP_ID}.connection`;
const KEY_CACHE = `${APP_ID}.cache`;

/** この端末に残した前回の記録を消す（接続解除時など） */
export function clearCache() {
  try { localStorage.removeItem(KEY_CACHE); } catch { /* 無視 */ }
}

export function getConnection() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY_CONNECTION) || 'null');
    if (c?.mode === 'github' && c.owner && c.repo && c.token) return c;
    if (c?.mode === 'trial') return c;
  } catch { /* 壊れていたら未設定扱い */ }
  return null;
}

export function setConnection(c) {
  localStorage.setItem(KEY_CONNECTION, JSON.stringify(c));
}

export function clearConnection() {
  localStorage.removeItem(KEY_CONNECTION);
}

export function makeAdapter(conn) {
  if (conn?.mode === 'github') return new GitHubAdapter(conn);
  if (conn?.mode === 'trial') return new LocalAdapter();
  return null;
}

export class Repo {
  /** cacheKey を渡すと、前回読み込んだ記録をこの端末に残し、次回の起動ですぐ表示できるようにする */
  constructor(adapter, { cacheKey = null } = {}) {
    this.adapter = adapter;
    this.cacheKey = cacheKey;
    this.data = emptyData();
    this.version = null;
    this.settings = {};
    this.settingsVersion = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.loadedAt = 0;
  }

  get kind() { return this.adapter.kind; }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.data);
  }

  async init() {
    const [d, s] = await Promise.all([this.adapter.load(), this.adapter.loadSettings()]);
    this.applyLoaded(d);
    this.settings = s.settings || {};
    this.settingsVersion = s.version;
    this.saveCache();
  }

  /** 前回の記録を読み込む。使えたら true（その後 syncInBackground で最新にする） */
  loadCache() {
    if (!this.cacheKey) return false;
    try {
      const c = JSON.parse(localStorage.getItem(KEY_CACHE) || 'null');
      if (!c || c.key !== this.cacheKey) return false;
      const r = validateData(c.data);
      if (!r.ok) return false;
      this.data = r.data;
      this.version = c.version ?? null;
      this.settings = c.settings || {};
      this.settingsVersion = c.settingsVersion ?? null;
      this.loadedAt = 0; // 古い可能性があるので、すぐに読み直す
      this.fromCache = true;
      return true;
    } catch {
      return false;
    }
  }

  saveCache() {
    if (!this.cacheKey) return;
    try {
      localStorage.setItem(KEY_CACHE, JSON.stringify({
        key: this.cacheKey, version: this.version, data: this.data,
        settings: this.settings, settingsVersion: this.settingsVersion, savedAt: Date.now(),
      }));
    } catch { /* 容量不足などで残せなくても動作は続ける */ }
  }

  /** 保存の順番待ちに並べて最新を読み直す（保存と同時に走らないように）。内容が変わったら true */
  syncInBackground() {
    const run = async () => {
      const before = this.version;
      const [d, s] = await Promise.all([this.adapter.load(), this.adapter.loadSettings()]);
      this.applyLoaded(d);
      this.settings = s.settings || {};
      this.settingsVersion = s.version;
      this.fromCache = false;
      this.saveCache();
      const changed = this.version !== before;
      if (changed) this.emit();
      return changed;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  applyLoaded({ data, version }) {
    if (data === null) {
      this.data = emptyData();
      this.version = null;
    } else {
      const r = validateData(data);
      if (!r.ok) {
        // 壊れたデータを空として扱うと上書きしてしまうので、ここで止める
        throw new StoreError('invalid', `保存先のデータに問題があるため読み込みを中止しました：${r.errors.slice(0, 3).join(' / ')}`);
      }
      this.data = r.data;
      this.version = version;
    }
    this.loadedAt = Date.now();
  }

  /** 保存先から読み直す。内容が変わったら true */
  async refresh() {
    const before = this.version;
    this.applyLoaded(await this.adapter.load());
    const changed = this.version !== before;
    this.saveCache();
    if (changed) this.emit();
    return changed;
  }

  /** 変更を1件ずつ順番に保存する。fn は draft を書き換える（競合時は最新データに再適用される） */
  mutate(message, fn) {
    const run = () => this._mutate(message, fn);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async _mutate(message, fn) {
    for (let attempt = 0; ; attempt++) {
      const draft = structuredClone(this.data);
      const result = fn(draft);
      draft.updatedAt = nowIso();
      const r = validateData(draft);
      if (!r.ok) throw new StoreError('invalid', `保存する内容に問題があります：${r.errors[0]}`);
      try {
        this.version = await this.adapter.save(r.data, this.version, message);
        this.data = r.data;
        this.saveCache();
        this.emit();
        return result;
      } catch (e) {
        if (e instanceof StoreError && e.kind === 'conflict' && attempt < 3) {
          await this.refresh();
          continue;
        }
        throw e;
      }
    }
  }

  // ---------- 設定（APIキーなど。保存先の非公開領域に置く） ----------

  async saveSettings(patch) {
    const next = { ...this.settings, ...patch };
    try {
      this.settingsVersion = await this.adapter.saveSettings(next, this.settingsVersion);
    } catch (e) {
      if (!(e instanceof StoreError && e.kind === 'conflict')) throw e;
      const latest = await this.adapter.loadSettings();
      const merged = { ...latest.settings, ...patch };
      this.settingsVersion = await this.adapter.saveSettings(merged, latest.version);
      this.settings = merged;
      this.saveCache();
      return;
    }
    this.settings = next;
    this.saveCache();
  }

  // ---------- 作品の削除（画像の棚からも外す） ----------

  deleteWork(workId) {
    return this.mutate('作品を削除', (d) => {
      d.works = d.works.filter((w) => w.id !== workId);
      d.experiences = d.experiences.filter((e) => e.workId !== workId);
      for (const s of d.shelves) s.items = s.items.filter((it) => it.workId !== workId);
    });
  }

  // ---------- 復元（全置き換え。1回の保存で行うので途中で一部だけ置き換わることはない） ----------

  restore(newData) {
    return this.mutate('バックアップから復元', (d) => {
      d.works = structuredClone(newData.works);
      d.experiences = structuredClone(newData.experiences);
      d.shelves = structuredClone(newData.shelves);
    });
  }
}
