// 화면 도우미, 자동 저장, 그림 줄이기, CSV

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = val;
}
export function nest(path, val) {
  const out = {};
  setPath(out, path, val);
  return out;
}
export function isPlainObject(v) { return v && typeof v === 'object' && v.constructor === Object; }
export function deepMerge(target, src) {
  for (const k of Object.keys(src)) {
    if (isPlainObject(src[k]) && isPlainObject(target[k])) deepMerge(target[k], src[k]);
    else target[k] = src[k];
  }
  return target;
}
export function byKey(path) { return path.replace(/\./g, '-'); }

export function tsMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds != null) return v.seconds * 1000;
  return 0;
}
export function fmtTime(v) {
  const ms = tsMillis(v);
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 알림
let toastWrap;
export function toast(msg, kind = '', ms = 2600) {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toast-wrap'; document.body.appendChild(toastWrap); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// 모달: html을 띄우고, [data-act] 버튼을 누르면 그 값을 돌려준다.
export function modal(html, { wide = false, onOpen } = {}) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog">${html}</div>`;
    document.body.appendChild(bg);
    const close = v => { bg.remove(); resolve(v); };
    bg.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b) { close({ act: b.dataset.act, root: bg }); return; }
      if (e.target === bg) close({ act: 'cancel', root: bg });
    });
    if (onOpen) onOpen(bg, close);
  });
}
export async function confirmBox(title, bodyHtml, okText = '확인', cancelText = '취소') {
  const r = await modal(`<h2>${esc(title)}</h2><div>${bodyHtml}</div>
    <div class="btn-row"><button class="btn primary" data-act="ok">${esc(okText)}</button><button class="btn" data-act="cancel">${esc(cancelText)}</button></div>`);
  return r.act === 'ok';
}

export function randCode(n = 6) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, x => A[x % A.length]).join('');
}
export async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

// CSV(엑셀에서 한글이 깨지지 않도록 BOM을 붙인다)
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 엑셀이 수식으로 읽지 않게
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }
export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
export function downloadText(filename, text, mime = 'text/csv') {
  downloadBlob(filename, new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' }));
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

// 그림 줄이기: 긴 변 1600px 이하, 700KB 이하. 그래프는 PNG가 작게 나오는 경우가 많다.
export async function compressImage(file, { maxSide = 1600, maxBytes = 700 * 1024 } = {}) {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  for (let tries = 0; tries < 6; tries++) {
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, w, h);
    cx.drawImage(bmp, 0, 0, w, h);
    const png = await new Promise(r => cv.toBlob(r, 'image/png'));
    if (png && png.size <= maxBytes) return { blob: png, mime: 'image/png', w, h };
    const jpg = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
    if (jpg && jpg.size <= maxBytes) return { blob: jpg, mime: 'image/jpeg', w, h };
    scale *= 0.8;
  }
  throw new Error('그림이 너무 커요. 그래프 부분만 잘라서 다시 올려 주세요.');
}

// 한글 입력(조합) 중인지, 방금 입력했는지
export const typing = { composing: false, last: 0 };
document.addEventListener('compositionstart', () => { typing.composing = true; }, true);
document.addEventListener('compositionend', () => { typing.composing = false; typing.last = Date.now(); }, true);
document.addEventListener('input', () => { typing.last = Date.now(); }, true);
export function userIsTyping() { return typing.composing || Date.now() - typing.last < 1200; }

// 다시 그릴 때 커서 위치를 지킨다.
export function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.dataset || !el.dataset.b) return null;
  return { b: el.dataset.b, s: el.selectionStart, e: el.selectionEnd, st: el.scrollTop };
}
export function restoreFocus(f, root = document) {
  if (!f) return;
  const el = root.querySelector(`[data-b="${CSS.escape(f.b)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  try { if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (e) { /* select 등 */ }
  el.scrollTop = f.st || 0;
}

// ─────────────────────────────────────────────
// 자동 저장: 입력이 멈추면(delay) 한꺼번에 저장. 저장 전 내용은 기기에도 백업.
// ─────────────────────────────────────────────
export class DocSaver {
  constructor({ key, write, delay = 2500, maxWait = 12000, onChange }) {
    this.key = 'bk:' + key;     // localStorage 백업 키
    this.write = write;         // async (partialNestedObject, paths) => void
    this.delay = delay; this.maxWait = maxWait;
    this.pending = {};          // path -> value (아직 보내지 않음)
    this.inflight = new Map();  // path -> value (보냈지만 확인 전)
    this.lastSaved = {};        // path -> 마지막으로 서버에 저장한 값
    this.timer = null; this.firstAt = 0;
    this.onChange = onChange || (() => {});
    this.error = null;
  }
  queue(path, value) {
    this.pending[path] = value;
    this.backup(path, value);
    const now = Date.now();
    if (!this.firstAt) this.firstAt = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.delay, this.firstAt + this.maxWait - now));
    this.timer = setTimeout(() => this.flush(), wait);
    this.onChange();
  }
  isDirty(path) { return path in this.pending || this.inflight.has(path); }
  get busy() { return Object.keys(this.pending).length > 0 || this.inflight.size > 0; }
  async flush() {
    clearTimeout(this.timer); this.timer = null; this.firstAt = 0;
    const paths = Object.keys(this.pending);
    if (!paths.length) return;
    const data = {};
    const sent = {};
    for (const p of paths) { deepMerge(data, nest(p, this.pending[p])); sent[p] = this.pending[p]; this.inflight.set(p, this.pending[p]); }
    this.pending = {};
    this.onChange();
    try {
      await this.write(data, paths);
      this.error = null;
      for (const p of paths) {
        this.lastSaved[p] = sent[p];
        if (this.inflight.get(p) === sent[p]) this.inflight.delete(p);
        if (!(p in this.pending)) this.unbackup(p);
      }
    } catch (e) {
      console.error('저장 실패', e);
      this.error = e;
      const denied = e && e.code === 'permission-denied';
      for (const p of paths) {
        if (this.inflight.get(p) === sent[p]) this.inflight.delete(p);
        if (denied) { if (!(p in this.pending)) this.unbackup(p); }
        else if (!(p in this.pending)) this.pending[p] = sent[p];
      }
      if (!denied) { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 8000); }
    }
    this.onChange();
  }
  backup(path, value) {
    try {
      const o = JSON.parse(localStorage.getItem(this.key) || '{}');
      o[path] = value;
      localStorage.setItem(this.key, JSON.stringify(o));
    } catch (e) { /* 저장 공간 없음 */ }
  }
  unbackup(path) {
    try {
      const o = JSON.parse(localStorage.getItem(this.key) || '{}');
      delete o[path];
      if (Object.keys(o).length) localStorage.setItem(this.key, JSON.stringify(o));
      else localStorage.removeItem(this.key);
    } catch (e) { /* 무시 */ }
  }
  // 지난번에 저장하지 못한 내용이 있으면 다시 저장 대기열에 넣는다.
  restoreBackup(currentGetter) {
    let o = {};
    try { o = JSON.parse(localStorage.getItem(this.key) || '{}'); } catch (e) { o = {}; }
    const restored = [];
    for (const [p, v] of Object.entries(o)) {
      if (currentGetter(p) !== v) { this.queue(p, v); restored.push(p); }
      else this.unbackup(p);
    }
    return restored;
  }
}
