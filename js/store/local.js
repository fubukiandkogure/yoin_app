// 試用モード：この端末のブラウザ内だけに保存する。別端末では見られないため完成形ではない。
import { APP_ID } from '../config.js';
import { newId } from '../util.js';
import { StoreError } from './errors.js';

const KEY_DATA = `${APP_ID}.trial.data`;
const KEY_SETTINGS = `${APP_ID}.trial.settings`;

function read(key) {
  const text = localStorage.getItem(key);
  if (text === null) return null;
  return JSON.parse(text);
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    throw new StoreError('toolarge', 'ブラウザの保存容量が足りないか、保存が許可されていません。', e);
  }
}

export class LocalAdapter {
  constructor() {
    this.kind = 'local';
  }

  async load() {
    let rec;
    try {
      rec = read(KEY_DATA);
    } catch {
      throw new StoreError('invalid', '試用モードのデータが壊れています。');
    }
    if (!rec) return { data: null, version: null };
    return { data: rec.data, version: rec.version };
  }

  async save(data, version) {
    const cur = read(KEY_DATA);
    // 別タブで更新されていたら競合として扱う
    if ((cur?.version ?? null) !== (version ?? null)) throw new StoreError('conflict', '別のタブで更新されていました。');
    const next = newId();
    write(KEY_DATA, { version: next, data });
    return next;
  }

  async loadSettings() {
    return { settings: read(KEY_SETTINGS) || {}, version: null };
  }

  async saveSettings(settings) {
    write(KEY_SETTINGS, settings);
    return null;
  }
}

export function clearTrialData() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(`${APP_ID}.trial.`)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
