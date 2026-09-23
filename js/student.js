// 학생 화면
import {
  db, auth, configured, signInAnonymously, onAuthStateChanged, signOut, clearLocalData,
  doc, collection, getDoc, setDoc, updateDoc, onSnapshot, writeBatch, serverTimestamp,
  deleteField, arrayUnion, arrayRemove, Bytes
} from './fb.js';
import * as C from './common.js';
import {
  $, $$, esc, nl2br, getPath, setPath, byKey, fmtTime, tsMillis, toast, modal, confirmBox,
  sha256hex, compressImage, copyText, downloadBlob, captureFocus, restoreFocus, userIsTyping, DocSaver
} from './util.js';

const IDLE_LIMIT_MS = 3 * 60 * 60 * 1000; // 3시간 동안 쓰지 않으면 자동으로 나감(함께 쓰는 기기 대비)

const S = {
  uid: null, m: null,
  team: null, tdoc: {}, tdocRaw: {}, cls: null, notes: {}, notesRaw: {},
  pool: null, cardMap: {}, topicMap: {},
  data: {}, dataLoading: {}, imgCache: {}, imgLoading: {},
  view: { stage: null, sub: {} },
  ui: { catDomain: 'all', catQuery: '', catOpen: {}, helper: {} },
  conflicts: {}, unsub: [], started: false, lastSig: '', prevStages: null,
};
let tSaver = null, nSaver = null, classUnsub = null;
const main = () => $('#main');

// ─────────────────────────────── 시작
if (!configured) {
  document.body.innerHTML = `<div class="wrap narrow"><div class="card"><h1>설정이 필요해요</h1>
  <p>선생님: <b>js/firebase-config.js</b> 파일에 Firebase 설정값을 붙여 넣어 주세요. (설치 안내서 2단계)</p></div></div>`;
} else {
  boot();
}

function boot() {
  renderTop();
  main().innerHTML = `<div class="card">불러오는 중…</div>`;
  const last = +localStorage.getItem('lastActive') || 0;
  const idleTooLong = last && Date.now() - last > IDLE_LIMIT_MS;
  onAuthStateChanged(auth, async user => {
    if (S.loggingOut) return; // 나가는 중에는 새로 로그인하지 않음
    if (!user) {
      try { await signInAnonymously(auth); }
      catch (e) {
        const c = e && e.code;
        showFatal(c === 'auth/too-many-requests' ? '지금은 새 기기가 너무 많이 들어오고 있어요. 몇 분 뒤에 새로 고침해 주세요(선생님께도 알려 주세요).'
          : c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation' ? '선생님: Firebase 콘솔에서 익명 로그인을 켜 주세요(설치 안내서 3단계).'
          : '로그인할 수 없어요. 인터넷 연결을 확인해 주세요.', e);
      }
      return;
    }
    if (S.uid === user.uid && S.started) return;
    S.uid = user.uid;
    // 오래 쓰지 않은 기기: 저장하지 못한 글이 없을 때만 자동으로 나간다(글이 사라지지 않게).
    if (idleTooLong && !S._idleHandled && !Object.keys(localStorage).some(k => k.startsWith('bk:'))) {
      S._idleHandled = true;
      await leaveDevice();
      return;
    }
    touch();
    try {
      const ms = await getDoc(doc(db, 'members', S.uid));
      if (ms.exists()) {
        const m = ms.data();
        try {
          await getDoc(doc(db, 'notes', m.seat)); // 자리가 아직 이 기기 것인지 확인
          startSession(m);
        } catch (e) {
          if (e && e.code === 'permission-denied') showEntry({ lost: true, code: m.team });
          else startSession(m); // 인터넷이 잠시 끊긴 경우 등
        }
      } else {
        showEntry({});
      }
    } catch (e) {
      showFatal('자료를 불러오지 못했어요. 인터넷 연결을 확인하고 새로 고침해 주세요.', e);
    }
  });
  ['input', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, throttleTouch, true));
  window.addEventListener('online', updateSaveState);
  window.addEventListener('offline', updateSaveState);
  window.addEventListener('beforeunload', e => {
    if ((tSaver && tSaver.busy) || (nSaver && nSaver.busy)) { flushAll(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
}
function touch() { localStorage.setItem('lastActive', String(Date.now())); }
let _touchT = 0;
function throttleTouch() { const n = Date.now(); if (n - _touchT > 60000) { _touchT = n; touch(); } }
function showFatal(msg, e) {
  console.error(e);
  main().innerHTML = `<div class="card"><h2>문제가 생겼어요</h2><p>${esc(msg)}</p><p class="small muted">${esc(e && (e.code || e.message) || '')}</p>
  <button class="btn" onclick="location.reload()">새로 고침</button></div>`;
}

// ─────────────────────────────── 입장
function stopSession() {
  S.unsub.forEach(u => { try { u(); } catch (e) { /* 무시 */ } });
  S.unsub = [];
  if (classUnsub) { classUnsub(); classUnsub = null; }
  S.team = null; S.cls = null; S.tdoc = {}; S.tdocRaw = {}; S.notes = {}; S.notesRaw = {};
  S.data = {}; S.dataLoading = {}; S.imgCache = {}; S.imgLoading = {}; S.lastSig = ''; S.prevStages = null;
}
function showEntry({ lost = false, code = '' }) {
  stopSession();
  S.started = false;
  $('#tabs').innerHTML = '';
  renderTop();
  main().innerHTML = `
  <div class="enter">
    <div class="card">
      <h1>통계 프로젝트</h1>
      ${lost ? `<div class="box warm">이 기기에서 쓰던 자리가 다른 기기로 옮겨졌거나 선생님이 자리를 풀었어요. 다시 들어와 주세요.</div>` : ''}
      <label class="f" for="code">모둠 입장 코드 <span class="hint">선생님께 받은 6글자</span></label>
      <div class="row"><input id="code" class="big grow" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(code)}">
      <button class="btn primary" id="codeBtn">확인</button></div>
      <div id="step2"></div>
    </div>
    <p class="small muted center">이름은 쓰지 않아요. 선생님이 정해 준 번호로 들어와요.</p>
  </div>`;
  const codeEl = $('#code');
  codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') lookupCode(); });
  $('#codeBtn').addEventListener('click', lookupCode);
  if (code) lookupCode();
}

async function lookupCode() {
  const code = $('#code').value.trim().toUpperCase();
  const box = $('#step2');
  if (code.length !== 6) { box.innerHTML = `<p class="small" style="color:var(--bad)">코드 6글자를 넣어 주세요.</p>`; return; }
  box.innerHTML = '<p class="muted">확인하는 중…</p>';
  let ts;
  try { ts = await getDoc(doc(db, 'teams', code)); } catch (e) { box.innerHTML = `<p style="color:var(--bad)">확인하지 못했어요. 인터넷 연결을 확인해 주세요.</p>`; return; }
  if (!ts.exists()) { box.innerHTML = `<p style="color:var(--bad)">없는 코드예요. 다시 확인해 주세요.</p>`; return; }
  const t = ts.data();
  let sel = 0;
  box.innerHTML = `
    <div class="box blue"><b>${esc(t.className)} ${esc(t.teamNo)}모둠</b>이 맞나요?</div>
    <label class="f">내 번호</label>
    <div class="numbtns">${Array.from({ length: t.size }, (_, i) => `<button class="numbtn" data-n="${i + 1}">${i + 1}</button>`).join('')}</div>
    <label class="f" for="pin">비밀번호 숫자 4자리</label>
    <input id="pin" class="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off">
    <label class="f" for="pin2">한 번 더</label>
    <input id="pin2" class="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off">
    <p class="hint">처음 들어오면 지금 넣은 숫자가 내 비밀번호가 돼요. 다른 기기에서 다시 들어올 때 필요하니 잊지 않게 적어 두세요.</p>
    <div class="btn-row"><button class="btn primary" id="enterBtn">들어가기</button></div>
    <p id="enterMsg" class="small"></p>`;
  $$('.numbtn', box).forEach(b => b.addEventListener('click', () => {
    sel = +b.dataset.n; $$('.numbtn', box).forEach(x => x.classList.toggle('sel', x === b));
  }));
  $('#enterBtn').addEventListener('click', async () => {
    const pin = $('#pin').value.trim(), pin2 = $('#pin2').value.trim();
    const msg = $('#enterMsg');
    if (!sel) { msg.textContent = '내 번호를 골라 주세요.'; return; }
    if (!/^\d{4}$/.test(pin)) { msg.textContent = '비밀번호는 숫자 4자리예요.'; return; }
    if (pin !== pin2) { msg.textContent = '두 비밀번호가 달라요.'; return; }
    const ok = await confirmBox('번호 확인', `<p><b>${esc(t.className)} ${esc(t.teamNo)}모둠 ${sel}번</b>으로 들어갈까요?</p><p class="small muted">번호가 틀리면 다른 친구 자리를 차지하게 돼요.</p>`, '들어가기');
    if (!ok) return;
    msg.textContent = '들어가는 중…';
    const seat = `${code}-${sel}`;
    try {
      const pinHash = await sha256hex(`${seat}:${pin}:stat-project`);
      const b = writeBatch(db);
      b.set(doc(db, 'seats', seat), { uid: S.uid, pinHash, team: code, num: sel, classId: t.classId, at: serverTimestamp() });
      b.set(doc(db, 'members', S.uid), { team: code, num: sel, seat, classId: t.classId, at: serverTimestamp() });
      await b.commit();
      touch();
      startSession({ team: code, num: sel, seat, classId: t.classId });
    } catch (e) {
      console.error(e);
      msg.innerHTML = e && e.code === 'permission-denied'
        ? '<b style="color:var(--bad)">이 번호는 이미 다른 비밀번호로 등록되어 있어요.</b> 비밀번호를 다시 확인하고, 모르겠으면 선생님께 말해 주세요.'
        : '들어가지 못했어요. 인터넷 연결을 확인해 주세요.';
    }
  });
}

// ─────────────────────────────── 세션 시작과 실시간 구독
async function startSession(m) {
  stopSession();
  S.m = m; S.started = true;
  const code = m.team;
  tSaver = new DocSaver({
    key: 'td:' + code, delay: 4000, maxWait: 20000,
    write: (data, paths) => {
      const by = {};
      paths.forEach(p => { by[byKey(p)] = S.m.num; });
      return setDoc(doc(db, 'teamdocs', code), { ...data, by, updatedAt: serverTimestamp() }, { merge: true });
    },
    onChange: updateSaveState,
  });
  // 개인 노트는 혼자 쓰므로 실시간 구독 없이 저장만 한다(읽기 횟수 절약).
  nSaver = new DocSaver({
    key: 'nt:' + m.seat, delay: 6000, maxWait: 30000,
    write: async data => {
      try {
        await setDoc(doc(db, 'notes', m.seat), { ...data, classId: S.m.classId, team: code, num: S.m.num, updatedAt: serverTimestamp() }, { merge: true });
      } catch (e) {
        if (e && e.code === 'permission-denied') checkSeat();
        throw e;
      }
    },
    onChange: updateSaveState,
  });
  renderTop();
  main().innerHTML = `<div class="card">불러오는 중…</div>`;
  try {
    const ps = await getDoc(doc(db, 'pool', 'public'));
    S.pool = ps.exists() ? ps.data() : { topics: [], cards: [] };
  } catch (e) { S.pool = { topics: [], cards: [] }; }
  S.cardMap = Object.fromEntries((S.pool.cards || []).map(c => [c.id, c]));
  S.topicMap = Object.fromEntries((S.pool.topics || []).map(t => [t.code, t]));

  let gotTeam = false, gotDoc = false, gotNotes = false, restored = false;
  const maybeRestore = () => {
    if (restored || !gotDoc || !gotNotes) return;
    restored = true;
    const r1 = tSaver.restoreBackup(p => getPath(S.tdocRaw, p));
    const r2 = nSaver.restoreBackup(p => getPath(S.notesRaw, p));
    r1.forEach(p => setPath(S.tdoc, p, tSaver.pending[p]));
    r2.forEach(p => setPath(S.notes, p, nSaver.pending[p]));
    if (r1.length + r2.length) toast('저장하지 못했던 글을 다시 저장해요.');
  };
  S.unsub.push(onSnapshot(doc(db, 'teams', code), snap => {
    if (!snap.exists()) { showEntry({ lost: true }); return; }
    const t = snap.data();
    const clsChanged = !S.team || S.team.classId !== t.classId;
    const prevNS = S.team ? JSON.stringify((S.team.noteStatus || {})[S.m.num] || {}) : null;
    const reset = t.seatReset && t.seatReset.num === S.m.num ? t.seatReset.at : 0;
    if (S._seatReset === undefined) S._seatReset = reset;
    else if (reset !== S._seatReset) { S._seatReset = reset; checkSeat(); }
    S.team = t;
    // 선생님이 노트 잠금을 풀면(제출 표시가 바뀌면) 노트를 다시 읽는다.
    if (prevNS !== null && prevNS !== JSON.stringify((t.noteStatus || {})[S.m.num] || {})) loadNotes();
    if (clsChanged) subscribeClass(t.classId);
    gotTeam = true;
    loadReleased(snap.metadata && snap.metadata.hasPendingWrites);
    loadImages();
    scheduleRender();
  }, e => (e && e.code === 'permission-denied' ? showEntry({ lost: true, code }) : showFatal('모둠 정보를 불러오지 못했어요.', e))));
  S.unsub.push(onSnapshot(doc(db, 'teamdocs', code), snap => {
    onTeamDoc(snap.exists() ? snap.data() : {});
    gotDoc = true; maybeRestore();
    scheduleRender(true);
  }, e => (e && e.code === 'permission-denied' ? showEntry({ lost: true, code }) : showFatal('모둠 활동지를 불러오지 못했어요.', e))));
  S._afterNotes = () => { gotNotes = true; maybeRestore(); };
  loadNotes();
}
async function loadNotes() {
  try {
    const snap = await getDoc(doc(db, 'notes', S.m.seat));
    onNotes(snap.exists() ? snap.data() : {});
    if (S._afterNotes) { S._afterNotes(); S._afterNotes = null; }
    scheduleRender(true);
  } catch (e) {
    if (e && e.code === 'permission-denied') showEntry({ lost: true, code: S.m.team });
  }
}
// 이 기기의 자리가 아직 유효한지(선생님이 자리를 풀었거나 다른 기기로 옮겼는지)
async function checkSeat() {
  try { await getDoc(doc(db, 'notes', S.m.seat)); }
  catch (e) { if (e && e.code === 'permission-denied') showEntry({ lost: true, code: S.m.team }); }
}
function subscribeClass(classId) {
  if (classUnsub) classUnsub();
  classUnsub = onSnapshot(doc(db, 'classes', classId), snap => {
    S.cls = snap.exists() ? snap.data() : { stages: {} };
    scheduleRender();
  }, e => showFatal('반 정보를 불러오지 못했어요.', e));
  S.unsub.push(() => classUnsub && classUnsub());
}

function overlayPending(obj, saver) {
  if (!saver) return;
  for (const [p, v] of saver.inflight) setPath(obj, p, v);
  for (const [p, v] of Object.entries(saver.pending)) setPath(obj, p, v);
}
function onTeamDoc(raw) {
  const prev = S.tdocRaw || {};
  S.tdocRaw = raw;
  const local = JSON.parse(JSON.stringify(raw));
  overlayPending(local, tSaver);
  // 내가 쓰는 중인 칸을 다른 모둠원이 고쳤는지
  if (tSaver) {
    const dirty = [...Object.keys(tSaver.pending), ...tSaver.inflight.keys()];
    for (const p of dirty) {
      const rv = getPath(raw, p), pv = getPath(prev, p);
      const who = raw.by && raw.by[byKey(p)];
      if (rv !== pv && who && who !== S.m.num && rv !== getPath(local, p)) S.conflicts[p] = { v: rv, who };
    }
  }
  S.tdoc = local;
}
function onNotes(raw) {
  S.notesRaw = raw;
  const local = JSON.parse(JSON.stringify(raw));
  overlayPending(local, nSaver);
  S.notes = local;
}

// 구조가 바뀌면 다시 그리고, 글만 바뀌면 칸의 값만 맞춘다.
let renderTimer = null;
function scheduleRender(textOnly = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    const sig = structureSig();
    if (!textOnly || sig !== S.lastSig) {
      if (userIsTyping() && S.lastSig) { renderTimer = null; setTimeout(() => scheduleRender(textOnly), 900); return; }
      S.lastSig = sig;
      render();
    } else {
      syncValues(main());
      updateDynamic(main());
    }
  }, 60);
}
function structureSig() {
  const t = S.team || {}, n = S.notes || {}, td = S.tdoc || {};
  return JSON.stringify([
    S.cls && S.cls.stages, S.cls && S.cls.helper, S.cls && S.cls.teamsPublic,
    t.topic, t.size, t.released, t.excluded, !!t.request, !!t.rerequest, t.planReq, t.planCheck, t.choice && t.choice.at,
    t.images && Object.keys(t.images).sort(), t.tasks, t.noteStatus, t.n2picks, t.questions && t.questions.length, t.reportDone,
    C.NOTE_KEYS.map(k => n[k] && n[k].submitted), n.s6 && n.s6.submitted, n.s7 && n.s7.done,
    td.analysis && td.analysis.cls && td.analysis.cls.count, td.report && td.report.initAt,
    td.cand && Object.keys(td.cand).sort(), Object.keys(S.data).sort(), Object.keys(S.imgCache).sort(),
  ]);
}

// ─────────────────────────────── 상단·탭
function renderTop() {
  const t = S.team, m = S.m;
  const topic = t && t.topic && S.topicMap[t.topic];
  $('#top').innerHTML = `
    <span class="brand">통계 프로젝트</span>
    ${m && t ? `<span class="who">${esc(t.className)} ${esc(t.teamNo)}모둠 · <b>${esc(m.num)}번</b></span>` : ''}
    ${topic ? `<span class="who">주제 ${topic.no}. ${esc(topic.short)}</span>` : ''}
    <span class="spacer"></span>
    ${m ? `<span id="saveState" class="save-state">저장됨</span><button id="logoutBtn" title="이 기기에서 나가기">나가기</button>` : ''}`;
  const lb = $('#logoutBtn');
  if (lb) lb.addEventListener('click', logout);
  updateSaveState();
  setTopH();
}
// 상단 막대 높이에 맞춰 단계 탭이 붙는 위치를 정한다(좁은 화면에서 두 줄이 되어도 겹치지 않게).
function setTopH() { const t = $('#top'); if (t) document.documentElement.style.setProperty('--topH', t.offsetHeight + 'px'); }
window.addEventListener('resize', setTopH);
async function logout({ ask = true } = {}) {
  if (ask && !(await confirmBox('나가기', '<p>이 기기에서 나갈까요? 쓴 내용은 저장되어 있어요. 다시 들어올 때 모둠 코드, 번호, 비밀번호가 필요해요.</p>', '나가기'))) return;
  await Promise.race([flushAll(), new Promise(r => setTimeout(r, 6000))]);
  if ((tSaver && tSaver.busy) || (nSaver && nSaver.busy)) {
    if (ask) toast('아직 저장하지 못한 글이 있어요. 인터넷 연결을 확인한 뒤 다시 나가기를 눌러 주세요.', 'bad', 5000);
    return;
  }
  await leaveDevice();
}
// 이 기기에서 나가기: 세션 정리 → 로그아웃 → 기기에 남은 임시 저장본 지우기 → 새로 고침
async function leaveDevice() {
  S.loggingOut = true;
  stopSession();
  localStorage.removeItem('lastActive');
  Object.keys(localStorage).filter(k => k.startsWith('bk:') || k.startsWith('qseen:')).forEach(k => localStorage.removeItem(k));
  try { await signOut(auth); } catch (e) { /* 무시 */ }
  await clearLocalData(); // 함께 쓰는 기기에 내 글이 남지 않게
  location.reload();
}
// 켜 둔 채 3시간 넘게 쓰지 않으면 자동으로 나간다.
setInterval(() => {
  const last = +localStorage.getItem('lastActive') || 0;
  if (S.started && last && Date.now() - last > IDLE_LIMIT_MS) logout({ ask: false });
}, 5 * 60 * 1000);
async function flushAll() {
  try { await Promise.all([tSaver && tSaver.flush(), nSaver && nSaver.flush()]); } catch (e) { /* 다음에 다시 */ }
}
function updateSaveState() {
  const el = $('#saveState');
  if (!el) return;
  const busy = (tSaver && tSaver.busy) || (nSaver && nSaver.busy);
  const err = (tSaver && tSaver.error) || (nSaver && nSaver.error);
  el.className = 'save-state';
  if (!navigator.onLine) { el.textContent = busy ? '인터넷 끊김 · 연결되면 저장돼요' : '인터넷 끊김'; el.classList.add('offline'); }
  else if (err && err.code === 'permission-denied') { el.textContent = '저장할 수 없는 칸이 있어요'; el.classList.add('error'); }
  else if (busy) { el.textContent = '저장 중…'; el.classList.add('saving'); }
  else el.textContent = '저장됨 ✓';
}

function stState(id) { return (S.cls && S.cls.stages && S.cls.stages[id]) || 'hidden'; }
function visibleStages() { return C.STAGES.filter(s => stState(s.id) !== 'hidden'); }

function renderTabs() {
  const vis = visibleStages();
  const cur = S.view.stage;
  $('#tabs').innerHTML = vis.length ? `<div class="tabs">${vis.map(s => `
    <button class="tab ${s.id === cur ? 'active' : ''} ${stState(s.id) === 'done' ? 'done' : ''}" data-stage="${s.id}">
      <span class="dot bg-${s.color}"></span>${esc(s.tab)}${stState(s.id) === 'done' ? '<span class="lock">보기</span>' : ''}
    </button>`).join('')}</div><div class="tabline"></div>` : '';
  $$('#tabs .tab').forEach(b => b.addEventListener('click', () => { flushAll(); S.view.stage = b.dataset.stage; render(); window.scrollTo(0, 0); }));
}

function chooseStage() {
  const vis = visibleStages();
  const openNow = vis.filter(s => stState(s.id) === 'open').map(s => s.id);
  const prev = S.prevStages;
  if (prev) {
    const newly = openNow.filter(id => prev[id] !== 'open');
    if (newly.length) toast(`새 단계가 열렸어요: ${newly.map(id => C.STAGE_BY_ID[id].tab).join(', ')}`, 'good', 3500);
    if (newly.length && (!S.view.stage || stState(S.view.stage) !== 'open')) S.view.stage = newly[0];
  }
  S.prevStages = { ...(S.cls && S.cls.stages || {}) };
  if (!S.view.stage || stState(S.view.stage) === 'hidden') {
    S.view.stage = openNow.length ? openNow[0] : (vis.length ? vis[vis.length - 1].id : null);
  }
}

// ─────────────────────────────── 그리기
function render() {
  if (!S.team || !S.cls || !S.pool) return;
  renderTop();
  chooseStage();
  renderTabs();
  const f = captureFocus();
  const st = S.view.stage;
  let html = questionBanner();
  if (!st) {
    html += `<div class="card"><h2>기다려 주세요</h2><p>선생님이 활동을 열면 여기에 나타나요.</p></div>`;
  } else {
    const fn = { s0: renderS0, s1: renderS1, s2: renderS2, s3: renderS3, s4: renderS4, s5: renderS5, s6: renderS6, s7: renderS7 }[st];
    try { html += fn(); } catch (e) { console.error(e); html += `<div class="card">화면을 그리지 못했어요: ${esc(e.message)}</div>`; }
  }
  main().innerHTML = html;
  syncValues(main());
  updateDynamic(main());
  restoreFocus(f, main());
  afterRender();
  $$('textarea', main()).forEach(autoGrow);
}
// 글이 길어지면 칸도 따라 늘어난다(최대 420px).
function autoGrow(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.min(420, Math.max(el.scrollHeight + 2, parseInt(getComputedStyle(el).minHeight, 10) || 0)) + 'px';
}

function questionBanner() {
  const qs = (S.team.questions || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const seen = +localStorage.getItem('qseen:' + S.m.team) || 0;
  const fresh = qs.filter(q => (q.at || 0) > seen);
  if (!fresh.length) return '';
  return `<div class="qcard"><b>선생님 질문 카드</b>${fresh.map(q => `<div>“${esc(q.text)}”</div>`).join('')}
    <div class="btn-row"><button class="btn small" data-action="qseen" data-at="${esc(fresh[0].at || 0)}">생각해 볼게요</button></div></div>`;
}

function sub(stage, tabs) {
  // tabs: [[key, label, badge?]]
  let cur = S.view.sub[stage];
  if (!tabs.some(t => t[0] === cur)) cur = S.view.sub[stage] = tabs[0][0];
  return `<div class="subtabs">${tabs.map(([k, l, b]) => `<button class="subtab ${k === cur ? 'active' : ''}" data-sub="${stage}:${k}">${esc(l)}${b ? `<span class="badge">${esc(b)}</span>` : ''}</button>`).join('')}</div>`;
}
function curSub(stage) { return S.view.sub[stage]; }

function stageHead(id, extra = '') {
  const s = C.STAGE_BY_ID[id];
  const ro = stState(id) === 'done';
  return `<div class="row between" style="margin-bottom:8px"><h2 style="margin:0"><span class="stage-chip bg-${s.color}">${esc(s.tab)}</span> ${esc(s.title)}</h2>${extra}</div>
  ${ro ? `<div class="locked-note">이 단계는 지금 보기만 할 수 있어요.</div>` : ''}`;
}
function leaderOf(stage) {
  const r = (C.ROLES[C.sizeKey(S.team.size)] || C.ROLES[4])[stage] || {};
  const e = Object.entries(r).find(([, t]) => t.startsWith('진행'));
  return e ? +e[0] : null;
}
function roleBox(stage) {
  const k = C.sizeKey(S.team.size), num = S.m.num;
  const role = C.roleOf(k, stage, num);
  if (!role) return '';
  const lead = leaderOf(stage);
  const all = Object.entries((C.ROLES[k] || {})[stage] || {}).map(([n, t]) => `<li><b>${n}번</b> ${esc(t)}</li>`).join('');
  return `<div class="role-box" style="border-left-color:var(--${stage})"><b>나의 역할(${esc(num)}번)</b>${esc(role)}
    ${lead && lead !== num ? `<span class="hint"> · 이 단계 진행: ${lead}번</span>` : ''}
    <details><summary class="small muted">모둠원 역할 모두 보기</summary><ul class="small">${all}</ul></details></div>`;
}
function topicObj() { return S.team.topic ? S.topicMap[S.team.topic] : null; }
function sizeArr() { return Array.from({ length: S.team.size }, (_, i) => i + 1); }
function teamRO(stage) { return stState(stage) !== 'open'; }
function noteRO(nk) { return stState(C.NOTES[nk].stage) !== 'open' || !!(S.notes[nk] && S.notes[nk].submitted); }

// 입력 칸
function val(scope, path) { return getPath(scope === 't' ? S.tdoc : S.notes, path); }
// 프로그램이 칸을 채울 때: 상태·저장·화면을 함께 바꾼다.
function setField(scope, path, v) {
  setPath(scope === 't' ? S.tdoc : S.notes, path, v);
  (scope === 't' ? tSaver : nSaver).queue(path, v);
  const el = main().querySelector(`[data-b="${CSS.escape(scope + ':' + path)}"]`);
  if (el) { if (el.type === 'checkbox') el.checked = !!v; else { el.value = v ?? ''; autoGrow(el); } }
}
function meta(scope, path) { return scope === 't' ? `<div class="field-meta" data-meta="${esc(path)}"></div>` : ''; }
function ta(scope, path, { ro = false, ph = '', cls = '' } = {}) {
  return `<textarea data-b="${scope}:${esc(path)}" class="${cls}" placeholder="${esc(ph)}" ${ro ? 'disabled' : ''}>${esc(val(scope, path) ?? '')}</textarea>${meta(scope, path)}`;
}
function inp(scope, path, { ro = false, ph = '', type = 'text', cls = '', attrs = '' } = {}) {
  return `<input type="${type}" data-b="${scope}:${esc(path)}" class="${cls}" placeholder="${esc(ph)}" value="${esc(val(scope, path) ?? '')}" ${ro ? 'disabled' : ''} ${attrs}>`;
}
function sel(scope, path, options, { ro = false, empty = '고르기' } = {}) {
  const v = val(scope, path) ?? '';
  return `<select data-b="${scope}:${esc(path)}" ${ro ? 'disabled' : ''}><option value="">${esc(empty)}</option>${options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
}
function chk(scope, path, { ro = false, label = '' } = {}) {
  return `<label class="nowrap"><input type="checkbox" data-b="${scope}:${esc(path)}" ${val(scope, path) ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${esc(label)}</label>`;
}
function field(label, hint, html) {
  return `<label class="f">${label}${hint ? ` <span class="hint">${hint}</span>` : ''}</label>${html}`;
}
function cardOpts(ids) { return ids.filter(id => S.cardMap[id]).map(id => [id, `${id} · ${S.cardMap[id].title}`]); }
function allCardIds() { return (S.pool.cards || []).map(c => c.id); }
function released() { return (S.team.released || []).slice(); }
function usedCards() { const ex = S.team.excluded || []; return released().filter(id => !ex.includes(id)); }

// 값 맞추기
function readEl(el) {
  if (el.type === 'checkbox') return el.checked;
  return el.value;
}
function splitB(b) { const i = b.indexOf(':'); return [b.slice(0, i), b.slice(i + 1)]; }
function syncValues(root) {
  $$('[data-b]', root).forEach(el => {
    const [scope, path] = splitB(el.dataset.b);
    const saver = scope === 't' ? tSaver : nSaver;
    if (saver && saver.isDirty(path)) return;
    if (el === document.activeElement && userIsTyping()) return;
    const v = val(scope, path);
    if (el.type === 'checkbox') { if (el.checked !== !!v) el.checked = !!v; }
    else if (el.type === 'radio') { const on = String(v ?? '') === el.value; if (el.checked !== on) el.checked = on; }
    else { const s = v == null ? '' : String(v); if (el.value !== s) { el.value = s; autoGrow(el); } }
  });
  $$('[data-meta]', root).forEach(el => {
    const p = el.dataset.meta;
    const who = S.tdoc.by && S.tdoc.by[byKey(p)];
    const c = S.conflicts[p];
    el.innerHTML = (who ? `마지막 수정: ${esc(who)}번` : '') + (c ? `<div class="conflict">${esc(c.who)}번이 방금 이 칸을 고쳤어요.<button class="btn small" data-action="conflict" data-path="${esc(p)}">${esc(c.who)}번 글 보기</button></div>` : '');
  });
}

// 입력 이벤트(모든 칸 공통)
document.addEventListener('input', onEdit);
document.addEventListener('change', onEdit);
function onEdit(e) {
  const el = e.target.closest && e.target.closest('[data-b]');
  if (!el || !S.started) return;
  if (el.type === 'radio' && !el.checked) return;
  const [scope, path] = splitB(el.dataset.b);
  const v = readEl(el);
  if (scope === 't') { setPath(S.tdoc, path, v); tSaver.queue(path, v); delete S.conflicts[path]; }
  else { setPath(S.notes, path, v); nSaver.queue(path, v); }
  if (e.type === 'change') afterChange(scope, path, v, el);
  else autoGrow(el);
  updateDynamic(main());
}
document.addEventListener('focusout', e => {
  const el = e.target.closest && e.target.closest('[data-b]');
  if (!el || !S.started) return;
  const [scope] = splitB(el.dataset.b);
  setTimeout(() => (scope === 't' ? tSaver : nSaver).flush(), 250);
});
async function afterChange(scope, path, v, el) {
  if (scope === 'n' && path === 'n2.card2') {
    try { await updateDoc(doc(db, 'teams', S.m.team), { [`n2picks.${S.m.num}`]: v || deleteField() }); } catch (e) { console.error(e); }
  }
  if (el.dataset.rerender !== undefined) { tSaver.flush(); S.lastSig = ''; render(); }
}

// ─────────────────────────────── 0. 주제 고르기
function renderS0() {
  const ro = teamRO('s0');
  const t = S.team, topic = topicObj();
  const submitted = !!(t.choice && t.choice.at);
  const topics = (S.pool.topics || []).slice().sort((a, b) => a.no - b.no);
  const opts = topics.map(x => [x.code, `${x.no}. ${x.title}`]);
  let h = stageHead('s0');
  if (topic) h += `<div class="assigned"><div class="small">우리 모둠 주제</div><div class="tt">${topic.no}. ${esc(topic.title)}</div><div class="small">${esc(topic.sdg)} · ${esc(topic.kind)}</div></div>`;
  h += sub('s0', [['cards', '주제 카드 8장'], ['form', '주제 선택 신청서(모둠)', submitted || topic ? '' : '!']]);
  if (curSub('s0') === 'cards') {
    h += `<p class="small muted">주제 카드에는 탐구 문제가 없어요. '생각해 볼 질문'에 답하며 모둠의 탐구 문제를 직접 만들어요.</p><div class="topics">${topics.map(x => topicCard(x)).join('')}</div>`;
    return h;
  }
  const lock = ro || submitted || !!topic;
  h += `<div class="card"><h3 style="margin-top:0">주제 선택 신청서(모둠)</h3>
    <p class="small">주제 카드 8장을 읽고 모둠에서 의논해 1~3지망을 정해요. 1지망이 겹치면 제비뽑기로 정하고, 떨어진 모둠은 남은 주제 가운데 2지망, 3지망 순서로 정해요.</p>
    ${[1, 2, 3].map(i => `
      <div class="card tight"><div class="row"><b style="min-width:52px">${i}지망</b><div class="grow">${sel('t', `choice.c${i}`, opts, { ro: lock })}</div></div>
      ${field('고른 까닭', i === 1 ? '우리가 궁금한 점 — 1차시에 탐구 동기로 이어서 써요' : '(선택)', ta('t', `choice.r${i}`, { ro: lock, cls: 's' }))}</div>`).join('')}
    ${topic ? '' : submitted
      ? `<div class="submitted">제출했어요 (${fmtTime(t.choice.at)}). 추첨 결과를 기다려요.</div>${ro ? '' : `<button class="btn small" data-action="choiceCancel">제출 취소하고 고치기</button>`}`
      : ro ? '' : `<div class="btn-row"><button class="btn primary" data-action="choiceSubmit">지망 제출하기</button><span class="hint">모둠에서 한 번만 제출하면 돼요.</span></div>`}
  </div>`;
  return h;
}
function topicCard(x, mine = false) {
  return `<div class="topic ${mine ? 'mine' : ''}"><div class="no">주제 ${x.no} · ${esc(x.sdg)} · ${esc(x.kind)}</div><div class="tt">${esc(x.title)}</div>
    <p>${esc(x.hook)}</p><div class="small"><b>생각해 볼 질문</b></div><ul>${(x.think || []).map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>`;
}

// ─────────────────────────────── 1. 탐구 문제 설정
function renderS1() {
  const topic = topicObj();
  let h = stageHead('s1');
  if (!topic) return h + `<div class="card">주제가 아직 정해지지 않았어요. 선생님이 추첨 결과를 알려 주면 시작해요.</div>`;
  const n1 = S.notes.n1 || {};
  h += roleBox('s1');
  h += sub('s1', [['plan', '탐구 계획서(모둠)'], ['n1', '개인 노트 ①', n1.submitted ? '' : '!']]);
  if (curSub('s1') === 'n1') return h + renderN1();
  const ro = teamRO('s1');
  const t = S.team;
  const req = t.planReq, chkd = t.planCheck;
  const waiting = req && (!chkd || chkd.reqAt !== req.at);
  let status = '';
  if (waiting) status = `<div class="box warm">선생님 확인을 기다리는 중이에요 (${fmtTime(req.at)} 요청, ${esc(req.by)}번).</div>`;
  else if (chkd && chkd.state === 'pass') status = `<div class="box green"><b>선생님 확인: 통과 ✓</b>${chkd.comment ? `<div>${nl2br(chkd.comment)}</div>` : ''}</div>`;
  else if (chkd && chkd.state === 'revise') status = `<div class="box red"><b>선생님 확인: 보완해 주세요</b>${chkd.comment ? `<div>${nl2br(chkd.comment)}</div>` : ''}<div class="small">고친 뒤 다시 확인을 요청해요.</div></div>`;
  h += `<details class="card tight"><summary><b>주제 카드: ${topic.no}. ${esc(topic.title)}</b></summary>${topicCard(topic, true)}</details>`;
  h += `<div class="card"><h3 style="margin-top:0">탐구 계획서(모둠)</h3>${status}
    ${field('탐구 동기', '왜 이 주제가 궁금한가요?', ta('t', 'plan.motive', { ro }))}
    ${!ro && !val('t', 'plan.motive') && choiceReason() ? `<button class="btn small" data-action="copyMotive">주제를 고른 까닭 가져오기</button>` : ''}
    ${field('탐구 문제 — 주 질문', '누구의(조사 대상) 무엇을(변량) 무엇과 비교할지(또는 무엇을 기준으로 판단할지)가 드러나게', ta('t', 'plan.main', { ro, cls: 's' }))}
    ${field('세부 질문 1~2개', '', ta('t', 'plan.sub', { ro, cls: 's' }))}
    <label class="f">통계적 탐구 문제 체크리스트</label>
    <table class="t form"><tr><th style="width:44%">확인할 점</th><th>우리 탐구 문제에서</th></tr>
    ${C.PLAN_CHECK.map((q, i) => `<tr><td>${chk('t', `plan.chk.c${i + 1}.ok`, { ro, label: q })}</td><td>${inp('t', `plan.chk.c${i + 1}.text`, { ro })}</td></tr>`).join('')}</table>
    ${field('예상 결과와 그렇게 예상한 까닭', '', ta('t', 'plan.expect', { ro }))}
    ${field('필요한 자료 계획', '2단계에서 이 계획에 맞는 자료를 찾아요', '')}
    <div class="tscroll"><table class="t form"><tr><th></th><th>누구의(조사 대상)</th><th>무엇을(변량·단위)</th><th>언제·어떤 조건에서</th><th>어떤 방법으로 조사한 자료</th></tr>
    ${[['r1', '자료 1'], ['r2', '자료 2'], ['r3', '기준·보조']].map(([k, l]) => `<tr><th>${l}</th>${['who', 'what', 'when', 'how'].map(c => `<td>${ta('t', `plan.need.${k}.${c}`, { ro, cls: 's' })}</td>`).join('')}</tr>`).join('')}
    </table></div>
    ${ro ? '' : `<div class="btn-row"><button class="btn blue" data-action="planReq" ${waiting ? 'disabled' : ''}>선생님께 확인 요청</button><span class="hint">확인 역할(${C.CHECKER[C.sizeKey(S.team.size)]}번)이 눌러요.</span></div>`}
  </div>`;
  return h;
}
// 배정된 주제를 고를 때 쓴 까닭(1~3지망 가운데 배정된 주제의 까닭)
function choiceReason() {
  const ch = S.team.choice || {};
  const i = [1, 2, 3].find(k => ch['c' + k] && ch['c' + k] === S.team.topic);
  return i ? String(ch['r' + i] || '').trim() : '';
}
function noteHead(nk) {
  const n = S.notes[nk] || {};
  const note = C.NOTES[nk];
  return `<div class="card"><h3 style="margin-top:0">${esc(note.title)} <span class="hint">— 혼자 씁니다(모둠원에게 보이지 않아요)</span></h3>
    <div class="box blue small"><b>이렇게 쓰면 좋아요</b> ${esc(note.good)}</div>
    ${n.submitted ? `<div class="submitted">제출했어요 (${fmtTime(n.submittedAt)}). 고치려면 선생님께 말해 주세요.</div>` : ''}`;
}
function noteFoot(nk, extra = '') {
  const ro = noteRO(nk);
  return `${ro ? '' : `<div class="btn-row"><button class="btn primary" data-action="submitNote" data-note="${nk}">제출하기</button>${extra}<span class="hint">제출하면 고칠 수 없어요.</span></div>`}</div>`;
}
function renderN1() {
  const ro = noteRO('n1');
  return noteHead('n1') + `
    ${field('(1) 우리 모둠의 탐구 문제', '', ta('n', 'n1.q', { ro, cls: 's' }))}
    <label class="f">(2) 통계적 탐구 문제의 조건을 갖추었는지 확인하세요.</label>
    <table class="t form"><tr><th style="width:38%">조건</th><th>우리 탐구 문제에서는?</th></tr>
      <tr><td>조사 대상</td><td>${ta('n', 'n1.who', { ro, cls: 's' })}</td></tr>
      <tr><td>변량(단위)</td><td>${ta('n', 'n1.var', { ro, cls: 's' })}</td></tr>
      <tr><td>비교할 두 집단 또는 판단 기준</td><td>${ta('n', 'n1.cmp', { ro, cls: 's' })}</td></tr>
      <tr><td>자료를 모아서 답할 수 있나요? 그 까닭은?</td><td>${ta('n', 'n1.can', { ro, cls: 's' })}</td></tr>
    </table>
    ${field('(3) 예상 결과와 그렇게 예상한 까닭', '', ta('n', 'n1.expect', { ro }))}` + noteFoot('n1');
}

// ─────────────────────────────── 2. 자료 수집
function renderS2() {
  let h = stageHead('s2');
  if (!topicObj()) return h + `<div class="card">주제가 아직 정해지지 않았어요.</div>`;
  const t = S.team, n2 = S.notes.n2 || {};
  h += roleBox('s2');
  h += sub('s2', [['cat', '자료 목록'], ['req', '자료 신청서(모둠)', t.request ? '' : '!'], ['got', '받은 자료', ''], ['n2', '개인 노트 ②', n2.submitted ? '' : '!']]);
  const s = curSub('s2');
  if (s === 'cat') return h + renderCatalog();
  if (s === 'req') return h + renderRequest();
  if (s === 'got') return h + renderGot();
  return h + renderN2();
}
function renderCatalog() {
  const doms = ['all', ...C.DOMAINS];
  return `<div class="card"><p class="small">자료명만 보지 말고 <b>조사 대상, 조사 시기, 조사 방법, 변량</b>까지 꼼꼼히 읽고 탐구 문제에 맞는지 판단해요. 원자료는 신청서를 내면 받아요. 모든 수치 자료는 수업용 가상 자료예요.</p>
    <div class="filters">${doms.map(d => `<button class="subtab ${S.ui.catDomain === d ? 'active' : ''}" data-action="catDomain" data-d="${esc(d)}">${d === 'all' ? '전체' : esc(d)}</button>`).join('')}</div>
    <input type="search" id="catQuery" placeholder="찾기: 번호, 자료명, 조사 대상, 변량…" value="${esc(S.ui.catQuery)}">
    <div id="catList" style="margin-top:10px">${catalogList()}</div></div>`;
}
function catalogList() {
  const q = S.ui.catQuery.trim();
  const cards = (S.pool.cards || []).filter(c => (S.ui.catDomain === 'all' || c.domain === S.ui.catDomain)
    && (!q || [c.id, c.title, c.target, c.variable_text, c.provider, c.method, c.period].join(' ').includes(q)));
  if (!cards.length) return '<p class="muted">찾는 자료가 없어요.</p>';
  const ro = teamRO('s2');
  let out = '', dom = '';
  for (const c of cards) {
    if (c.domain !== dom) { dom = c.domain; out += `<div class="dom-title">${esc(dom)}</div>`; }
    const open = !!S.ui.catOpen[c.id];
    const cand = S.tdoc.cand && S.tdoc.cand[c.id];
    const got = (S.team.released || []).includes(c.id);
    out += `<div class="cat-item">
      <div class="cat-head" data-action="catToggle" data-id="${esc(c.id)}"><div class="id">${c.id}</div>
        <div class="grow"><div class="ttl">${esc(c.title)}</div><div class="meta">${esc(c.fmt)} · 자료 수 ${esc(c.n_text)} · ${esc(c.variable_text)}</div></div>
        <div data-dyn="cand-${c.id}">${candChip(c.id)}</div>${got ? '<span class="chip ok">받음</span>' : ''}<span class="muted small nowrap">${open ? '접기 ▴' : '자세히 ▾'}</span></div>
      ${open ? `<div class="cat-body">${cardKV(c)}
        <div class="btn-row">${ro ? '' : cand
          ? `<button class="btn small" data-action="candOff" data-id="${esc(c.id)}">후보에서 빼기</button>`
          : `<button class="btn small" data-action="candOn" data-id="${esc(c.id)}">후보로 표시</button>`}
        ${!ro && !S.team.request ? `<button class="btn small" data-action="toReq" data-id="${esc(c.id)}">신청서에 넣기</button><button class="btn small" data-action="toRej" data-id="${esc(c.id)}">'고르지 않은 자료'에 넣기</button>` : ''}</div>
        ${cand ? field('검토 메모', '대상·시기·조건·방법·변량이 탐구 문제와 맞나요?', ta('t', `cand.${c.id}.memo`, { ro, cls: 's' })) : ''}
      </div>` : ''}</div>`;
  }
  return out;
}
function candChip(id) {
  const cand = S.tdoc.cand && S.tdoc.cand[id];
  return cand ? `<span class="chip wait">후보 · ${esc(cand.by)}번</span>` : '';
}
function cardKV(c) {
  return `<div class="kv">
    <div>제공</div><div>${esc(c.provider)}</div>
    <div>조사 대상</div><div>${esc(c.target)}</div>
    <div>조사 시기</div><div>${esc(c.period)}</div>
    <div>조사 방법</div><div>${esc(c.method)}</div>
    <div>자료 수</div><div>${esc(c.n_text)}</div>
    <div>변량(단위)</div><div>${esc(c.variable_text)}</div>
    <div>형태</div><div>${esc(c.fmt)}</div>
    ${c.note ? `<div>참고</div><div>※ ${esc(c.note)}</div>` : ''}</div>`;
}
function renderRequest() {
  const t = S.team;
  const ro = teamRO('s2');
  const opts = cardOpts(allCardIds());
  const nums = sizeArr().map(n => [String(n), `${n}번`]);
  if (t.request) {
    const r = t.request;
    return `<div class="card"><h3 style="margin-top:0">자료 신청서(모둠)</h3>
      <div class="submitted">제출했어요 (${fmtTime(r.at)}, ${esc(r.by)}번). 원자료는 '받은 자료'에서 봐요.</div>
      <h4>① 신청한 자료</h4>${reqTable(r.rows, '고른 까닭')}
      <h4>② 비슷해 보이지만 고르지 않은 자료</h4>${reqTable(r.rejected, '고르지 않은 까닭')}
      ${t.rerequest ? `<h4>④ 계획 수정(재신청)</h4>${rereqTable(t.rerequest.rows)}` : ''}
    </div>`;
  }
  const row = (k, i, reasonLabel) => `<tr><td style="width:36%">${sel('t', `req.${k}${i}.card`, opts, { ro })}</td><td>${ta('t', `req.${k}${i}.reason`, { ro, cls: 's', ph: reasonLabel })}</td><td style="width:84px">${sel('t', `req.${k}${i}.by`, nums, { ro, empty: '누가' })}</td></tr>`;
  return `<div class="card"><h3 style="margin-top:0">자료 신청서(모둠)</h3>
    <p class="small">처음 신청은 <b>최대 ${C.REQ.firstMax}장</b>이에요. 자료마다 고른 까닭을 써요. <span class="hint">${esc(C.FIT_HINT)}</span></p>
    <h4>① 신청하는 자료</h4><div class="tscroll"><table class="t form"><tr><th>자료</th><th>고른 까닭(무엇이 탐구 문제와 맞나요?)</th><th>검토한 사람</th></tr>
      ${[1, 2, 3, 4].map(i => row('r', i, '고른 까닭')).join('')}</table></div>
    <h4>② 비슷해 보이지만 고르지 않은 자료(${C.REQ.rejectedMin}장 이상)</h4><div class="tscroll"><table class="t form"><tr><th>자료</th><th>고르지 않은 까닭(무엇이 탐구 문제와 다른가요?)</th><th>검토한 사람</th></tr>
      ${[1, 2, 3, 4].map(i => row('x', i, '고르지 않은 까닭')).join('')}</table></div>
    ${ro ? '' : `<div class="btn-row"><button class="btn primary" data-action="submitReq">신청서 제출하고 원자료 받기</button><span class="hint">진행(${leaderOf('s2') || 2}번)이 모둠과 확인한 뒤 눌러요. 제출하면 바로 원자료가 열려요.</span></div>`}
  </div>`;
}
function reqTable(rows, label) {
  if (!rows || !rows.length) return '<p class="muted">없음</p>';
  return `<table class="t"><tr><th style="width:36%">자료</th><th>${label}</th><th style="width:70px">검토</th></tr>${rows.map(r => `<tr><td><b>${esc(r.card)}</b> ${esc(S.cardMap[r.card] ? S.cardMap[r.card].title : '')}</td><td>${nl2br(r.reason)}</td><td>${r.by ? esc(r.by) + '번' : ''}</td></tr>`).join('')}</table>`;
}
function rereqTable(rows) {
  return `<table class="t"><tr><th style="width:36%">자료</th><th>방법</th><th>까닭</th></tr>${(rows || []).map(r => `<tr><td><b>${esc(r.card)}</b> ${esc(S.cardMap[r.card] ? S.cardMap[r.card].title : '')}</td><td>${r.mode === 'replace' ? `${esc(r.replaces)}번 대신` : '더하기'}</td><td>${nl2br(r.reason)}</td></tr>`).join('')}</table>`;
}
function renderGot() {
  const t = S.team;
  if (!t.request) return `<div class="card">자료 신청서를 제출하면 여기에서 원자료를 볼 수 있어요.</div>`;
  const ro = teamRO('s2');
  let h = released().map(id => dataView(id, { toggle: !ro })).join('');
  h += `<div class="card">${field('③ 받은 자료 점검', '자료 수, 단위, 눈에 띄게 크거나 작은 값, 조사 조건', ta('t', 'checkMemo', { ro }))}</div>`;
  if (t.rerequest) {
    h += `<div class="card"><h3 style="margin-top:0">④ 계획 수정(재신청)</h3><div class="submitted">재신청했어요 (${fmtTime(t.rerequest.at)}).</div>${rereqTable(t.rerequest.rows)}</div>`;
  } else if (!ro) {
    const notYet = allCardIds().filter(id => !released().includes(id));
    h += `<div class="card"><h3 style="margin-top:0">④ 계획 수정(바꾸거나 더하기) <span class="hint">— 필요할 때만, 1번, 최대 ${C.REQ.reMax}장</span></h3>
      <p class="small">받은 자료를 살펴보니 탐구 문제와 맞지 않거나 더 필요한 자료가 있으면 까닭을 쓰고 신청해요. 재신청은 좋은 판단의 증거예요.</p>
      ${[1, 2].map(i => `<div class="card tight"><div class="row"><b>자료</b><div class="grow">${sel('t', `rereq.r${i}.card`, cardOpts(notYet))}</div></div>
        <div class="row" style="margin-top:6px"><b>방법</b><div class="grow">${sel('t', `rereq.r${i}.mode`, [['add', '더하기'], ['replace', '바꾸기(받은 자료 하나 대신)']], { empty: '고르기' })}</div>
        <div class="grow">${sel('t', `rereq.r${i}.replaces`, cardOpts(released()), { empty: '(바꾸기일 때) 대신할 자료' })}</div></div>
        ${field('까닭', '', ta('t', `rereq.r${i}.reason`, { cls: 's' }))}</div>`).join('')}
      <div class="btn-row"><button class="btn blue" data-action="submitRereq">재신청하기(1번만)</button></div></div>`;
  }
  return h;
}
function renderN2() {
  const ro = noteRO('n2');
  const reqIds = S.team.request ? S.team.request.rows.map(r => r.card) : released();
  const others = allCardIds().filter(id => !released().includes(id));
  return noteHead('n2') + `
    ${field('(1) 우리 모둠이 신청한 자료 하나를 골라, 탐구 문제에 알맞은 까닭을 두 가지 이상 쓰세요.', '대상·시기·방법·변량 가운데', `<div style="max-width:520px">${sel('n', 'n2.card1', cardOpts(reqIds), { ro, empty: '자료 번호 고르기' })}</div>${ta('n', 'n2.why1', { ro })}`)}
    ${field('(2) 비슷해 보이지만 고르지 않은 자료 하나를 골라, 알맞지 않은 까닭을 쓰세요.', '가능하면 모둠원과 다른 자료로', `<div style="max-width:520px">${sel('n', 'n2.card2', cardOpts(others), { ro, empty: '자료 번호 고르기' })}</div><div data-dyn="n2dup"></div>${ta('n', 'n2.why2', { ro })}`)}
    ${field('(3) 받은 자료를 분석할 때 주의할 점 한 가지', '', ta('n', 'n2.caution', { ro, cls: 's' }))}` + noteFoot('n2');
}

// 원자료 보기
function dataView(id, { toggle = false, compact = false } = {}) {
  const c = S.cardMap[id];
  const d = S.data[id];
  const ex = (S.team.excluded || []).includes(id);
  let body;
  if (!d) body = `<p class="muted">원자료를 불러오는 중…</p>`;
  else body = dataBody(id, d);
  return `<div class="data-card ${ex ? 'excluded' : ''}">
    <div class="row between"><h3 style="margin:0">자료 ${esc(id)} · ${esc(c ? c.title : '')}</h3>
      ${ex ? '<span class="chip gray">분석에 쓰지 않음</span>' : ''}</div>
    ${compact ? `<div class="small muted">${esc(c ? c.variable_text : '')} · 자료 수 ${esc(c ? c.n_text : '')}</div>` : `<details><summary class="small">자료 정보(대상·시기·방법)</summary>${c ? cardKV(c) : ''}</details>`}
    ${body}
    ${toggle ? `<div class="btn-row">${ex ? `<button class="btn small" data-action="unexclude" data-id="${esc(id)}">다시 분석에 쓰기</button>` : `<button class="btn small red" data-action="exclude" data-id="${esc(id)}">이 자료는 분석에 쓰지 않기</button>`}</div>` : ''}
  </div>`;
}
function decimals(vals) { return Math.min(4, Math.max(0, ...vals.map(v => { const s = String(v); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }))); }
function fmtVals(vals) { const k = decimals(vals); return vals.map(v => (typeof v === 'number' ? v.toFixed(k) : String(v))); }
function dataBody(id, d) {
  let h = '';
  if (d.note) h += `<div class="data-note"><b>측정 조건 메모</b> ${esc(d.note)}</div>`;
  const copyBtns = (key, label) => `<div class="btn-row"><button class="btn small" data-action="copyVals" data-id="${esc(id)}" data-key="${key}" data-sep="line">${label ? esc(label) + ' ' : ''}값 복사(한 줄에 하나)</button><button class="btn small" data-action="copyVals" data-id="${esc(id)}" data-key="${key}" data-sep="comma">쉼표로 복사</button></div>`;
  if (d.values && d.values2) {
    const g = d.groups || ['집단 1', '집단 2'];
    h += `<h4>${esc(g[0])} (${d.values.length}개)</h4><div class="values">${fmtVals(d.values).map(v => `<span>${esc(v)}</span>`).join('')}</div>${copyBtns('values', g[0])}`;
    h += `<h4>${esc(g[1])} (${d.values2.length}개)</h4><div class="values">${fmtVals(d.values2).map(v => `<span>${esc(v)}</span>`).join('')}</div>${copyBtns('values2', g[1])}`;
  } else if (d.values && d.labels) {
    const fv = fmtVals(d.values);
    h += `<p class="small muted">값 ${d.values.length}개</p><div class="tscroll" style="max-height:340px;overflow-y:auto"><table class="t" style="max-width:420px"><tr><th>구분</th><th class="num">값</th></tr>${fv.map((v, i) => `<tr><td>${esc(d.labels[i])}</td><td class="num">${esc(v)}</td></tr>`).join('')}</table></div>
      ${copyBtns('values')}<div class="btn-row"><button class="btn small" data-action="copyTable" data-id="${esc(id)}">구분과 값 함께 복사(표)</button></div>`;
  } else if (d.values) {
    h += `<p class="small muted">값 ${d.values.length}개</p><div class="values">${fmtVals(d.values).map(v => `<span>${esc(v)}</span>`).join('')}</div>${copyBtns('values')}`;
  }
  if (d.categories) {
    const g = d.groups;
    h += `<div class="tscroll"><table class="t"><tr><th>${d.groups && d.categories[0] && String(d.categories[0][0]).includes('이상') ? '계급' : '항목'}</th>${g ? g.map(x => `<th class="num">${esc(x)}</th>`).join('') : '<th class="num">수</th>'}</tr>
      ${d.categories.map(r => `<tr><td>${esc(r[0])}</td>${r.slice(1).map(v => `<td class="num">${esc(v)}</td>`).join('')}</tr>`).join('')}</table></div>
      <div class="btn-row"><button class="btn small" data-action="copyTable" data-id="${esc(id)}">표 복사</button></div>`;
  }
  if (d.table) {
    h += `<div class="tscroll"><table class="t"><tr>${d.table.columns.map(x => `<th>${esc(x)}</th>`).join('')}</tr>${d.table.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></div>
      <div class="btn-row"><button class="btn small" data-action="copyTable" data-id="${esc(id)}">표 복사</button></div>`;
  }
  if (d.image) h += `<img src="${esc(d.image)}" alt="자료 ${esc(id)} 그래프" style="max-width:100%;border:1px solid var(--line);border-radius:8px">`;
  return h;
}

// ─────────────────────────────── 3. 자료 분석
function renderS3() {
  let h = stageHead('s3');
  if (!S.team.request) return h + `<div class="card">2단계에서 자료를 신청하면 분석을 시작할 수 있어요.</div>`;
  const n3 = S.notes.n3 || {};
  h += roleBox('s3');
  h += taskChecklist();
  const tabs = [['raw', '원자료'], ['ft', '계급·도수분포표'], ['rep', '대푯값·기준·보조'], ['img', '그래프 올리기', ''], ['sent', '분석 문장'], ['n3', '개인 노트 ③', n3.submitted ? '' : '!']];
  if (S.cls.helper) tabs.splice(1, 0, ['help', '도수 세기 도우미']);
  h += sub('s3', tabs);
  const s = curSub('s3');
  if (s === 'raw') return h + `<p class="small muted">값 복사 버튼을 누른 뒤 이지통계·통그라미에 붙여 넣어요.</p>` + usedCards().map(id => dataView(id, { compact: true })).join('') + ((S.team.excluded || []).length ? `<details><summary class="small">분석에 쓰지 않기로 한 자료</summary>${(S.team.excluded || []).map(id => dataView(id, { compact: true })).join('')}</details>` : '');
  if (s === 'help') return h + renderHelper();
  if (s === 'ft') return h + renderFT();
  if (s === 'rep') return h + renderRep();
  if (s === 'img') return h + renderImages();
  if (s === 'sent') return h + renderSent();
  return h + renderN3();
}
function taskChecklist() {
  const size = S.team.size, me = S.m.num, ro = teamRO('s3');
  const tasks = C.tasksFor(size);
  const done = S.team.tasks || {};
  const mine = tasks.filter(tk => C.taskWho(tk, size).includes(me));
  const myDone = mine.filter(tk => done[me] && done[me][tk.id]).length;
  return `<details class="card tight" id="taskBox" ${S.ui.taskOpen ? 'open' : ''}><summary><b>과업 확인</b> <span class="chip ${myDone === mine.length ? 'ok' : 'wait'}">내 과업 ${myDone}/${mine.length}</span> <span class="hint">끝낸 과업은 내 번호 칸에 표시해요</span></summary>
    <table class="t"><tr><th>과업</th><th style="width:40%">담당·완료</th></tr>
    ${tasks.map(tk => `<tr><td>${esc(tk.text)}</td><td>${C.taskWho(tk, size).map(n => `<label class="nowrap" style="margin-right:10px"><input type="checkbox" data-action="task" data-task="${tk.id}" data-n="${n}" ${done[n] && done[n][tk.id] ? 'checked' : ''} ${n !== me || ro ? 'disabled' : ''}> ${n}번</label>`).join('')}</td></tr>`).join('')}
    </table></details>`;
}
function groupOpts() { return cardOpts(usedCards()); }
function renderFT() {
  const ro = teamRO('s3');
  const a = (S.tdoc.analysis || {});
  const count = Math.max(3, Math.min(15, parseInt((a.cls || {}).count, 10) || 8));
  return `<div class="card"><h3 style="margin-top:0">비교할 두 집단</h3>
    <div class="tscroll"><table class="t form"><tr><th></th><th>이름(예: 30분 이상 사용)</th><th>자료</th></tr>
      <tr><th>집단 1</th><td>${inp('t', 'analysis.g1.name', { ro })}</td><td>${sel('t', 'analysis.g1.card', groupOpts(), { ro })}</td></tr>
      <tr><th>집단 2</th><td>${inp('t', 'analysis.g2.name', { ro })}</td><td>${sel('t', 'analysis.g2.card', groupOpts(), { ro })}</td></tr></table></div>
    <h3>계급 정하기 <span class="hint">두 집단의 계급은 똑같이</span></h3>
    <div class="tscroll"><table class="t form center"><tr><th>가장 작은 값</th><th>가장 큰 값</th><th>계급의 시작값</th><th>계급의 크기</th><th>계급의 개수</th></tr>
      <tr><td>${inp('t', 'analysis.cls.min', { ro })}</td><td>${inp('t', 'analysis.cls.max', { ro })}</td><td>${inp('t', 'analysis.cls.start', { ro })}</td><td>${inp('t', 'analysis.cls.width', { ro })}</td>
      <td>${inp('t', 'analysis.cls.count', { ro, type: 'number', attrs: 'min="3" max="15" data-rerender' })}</td></tr></table></div>
    ${field('이렇게 정한 까닭', '계급의 개수 5~15개, 기준값이 계급의 경계가 되는지 등', ta('t', 'analysis.cls.why', { ro, cls: 's' }))}
    <h3>도수분포표와 상대도수의 분포표</h3>
    <p class="small muted">공학 도구로 만든 결과를 옮겨 적어요. 합계는 자동으로 더해 보여 줘요(확인용).</p>
    ${ro ? '' : `<div class="btn-row" style="margin-top:0"><button class="btn small" data-action="fillClasses">시작값·크기로 계급 칸 채우기</button></div>`}
    <div class="tscroll"><table class="t form center"><tr><th>계급</th><th>집단 1 도수</th><th>상대도수</th><th>집단 2 도수</th><th>상대도수</th></tr>
      ${Array.from({ length: count }, (_, i) => `<tr><td style="min-width:130px">${inp('t', `analysis.ft.r${i + 1}.cls`, { ro })}</td>${['f1', 'rf1', 'f2', 'rf2'].map(k => `<td>${inp('t', `analysis.ft.r${i + 1}.${k}`, { ro, attrs: 'inputmode="decimal"' })}</td>`).join('')}</tr>`).join('')}
      <tr><th>합계</th>${['f1', 'rf1', 'f2', 'rf2'].map(k => `<th data-dyn="ftsum-${k}"></th>`).join('')}</tr></table></div>
    <p class="hint">상대도수의 합이 1인지 확인해요(반올림하면 1이 아닐 수 있어요).</p></div>`;
}
function renderRep() {
  const ro = teamRO('s3');
  const g1 = val('t', 'analysis.g1.name') || '집단 1', g2 = val('t', 'analysis.g2.name') || '집단 2';
  return `<div class="card"><h3 style="margin-top:0">대푯값</h3>
    <div class="tscroll"><table class="t form center"><tr><th></th><th>평균</th><th>중앙값</th><th>최빈값</th></tr>
      <tr><th>${esc(g1)}</th><td>${inp('t', 'analysis.rep.mean1', { ro })}</td><td>${inp('t', 'analysis.rep.med1', { ro })}</td><td>${inp('t', 'analysis.rep.mode1', { ro })}</td></tr>
      <tr><th>${esc(g2)}</th><td>${inp('t', 'analysis.rep.mean2', { ro })}</td><td>${inp('t', 'analysis.rep.med2', { ro })}</td><td>${inp('t', 'analysis.rep.mode2', { ro })}</td></tr></table></div>
    ${field('알맞은 대푯값과 그 까닭', '극단값이 있는지, 같은 값이 여러 번 나오는지', ta('t', 'analysis.rep.pick', { ro, cls: 's' }))}
    <h3>기준 비율</h3>
    <div class="tscroll"><table class="t form center"><tr><th>기준(값과 뜻)</th><th>${esc(g1)}</th><th>${esc(g2)}</th></tr>
      <tr><td>${inp('t', 'analysis.thr.value', { ro, ph: '예: 8시간 미만' })}</td><td>${inp('t', 'analysis.thr.p1', { ro, ph: '%' })}</td><td>${inp('t', 'analysis.thr.p2', { ro, ph: '%' })}</td></tr></table></div>
    ${field('보조 자료에서 알게 된 점', '자료 번호, 최빈값이나 비율 등', ta('t', 'analysis.sup', { ro, cls: 's' }))}</div>`;
}
function renderSent() {
  const ro = teamRO('s3');
  return `<div class="card"><h3 style="margin-top:0">분석 결과 문장 <span class="hint">사실만, 수치와 함께 3개 이상 · 주장은 4단계에서</span></h3>
    <p class="small muted">예: “~계급의 상대도수가 가장 크다”, “~의 그래프가 오른쪽으로 치우쳐 있다”</p>
    ${[1, 2, 3, 4, 5, 6].map(i => field(`문장 ${i}`, i > 3 ? '(선택)' : '', ta('t', `analysis.sent.s${i}`, { ro, cls: 's' }))).join('')}</div>`;
}
function renderHelper() {
  const ids = usedCards().filter(id => S.data[id] && S.data[id].values);
  const hs = S.ui.helper;
  const opts = [];
  ids.forEach(id => {
    const d = S.data[id];
    opts.push([`${id}|values`, `${id} ${d.values2 ? (d.groups || [])[0] || '집단 1' : S.cardMap[id].title}`]);
    if (d.values2) opts.push([`${id}|values2`, `${id} ${(d.groups || [])[1] || '집단 2'}`]);
  });
  let table = '';
  if (hs.src && hs.start !== '' && hs.width) {
    const [id, key] = hs.src.split('|');
    const vals = (S.data[id] || {})[key] || [];
    const st = parseFloat(hs.start), w = parseFloat(hs.width), n = Math.max(1, Math.min(20, parseInt(hs.count, 10) || 8));
    if (isFinite(st) && isFinite(w) && w > 0) {
      const eps = 1e-9;
      const counts = Array(n).fill(0); let out = 0;
      vals.forEach(v => { const k = Math.floor((v - st) / w + eps); if (k >= 0 && k < n) counts[k]++; else out++; });
      const fmt = x => String(Math.round(x * 1000) / 1000);
      table = `<table class="t center" style="max-width:420px"><tr><th>계급</th><th>도수</th></tr>${counts.map((c, i) => `<tr><td>${fmt(st + i * w)} 이상 ~ ${fmt(st + (i + 1) * w)} 미만</td><td>${c}</td></tr>`).join('')}
        <tr><th>합계</th><th>${counts.reduce((a, b) => a + b, 0)}</th></tr></table>${out ? `<p style="color:var(--bad)">계급 밖에 있는 값이 ${out}개 있어요. 시작값·크기·개수를 다시 정해요.</p>` : ''}`;
    }
  }
  return `<div class="card"><h3 style="margin-top:0">도수 세기 도우미</h3>
    <p class="small muted">공학 도구를 쓸 수 없을 때만 써요. 계급을 정하는 것과 상대도수를 구하는 것은 우리가 해요.</p>
    <div class="row"><div class="grow"><label class="f">자료</label><select id="hSrc"><option value="">고르기</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${hs.src === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div><label class="f">시작값</label><input id="hStart" type="text" value="${esc(hs.start ?? '')}" style="width:90px"></div>
    <div><label class="f">크기</label><input id="hWidth" type="text" value="${esc(hs.width ?? '')}" style="width:90px"></div>
    <div><label class="f">개수</label><input id="hCount" type="number" value="${esc(hs.count ?? 8)}" style="width:80px"></div></div>
    <div class="btn-row"><button class="btn" data-action="helperRun">도수 세기</button></div>${table}</div>`;
}
function renderN3() {
  const ro = noteRO('n3');
  const p = C.pairOf(S.team.size, S.m.num);
  const pRole = p ? C.roleOf(C.sizeKey(S.team.size), 's3', p) : '';
  const imgs = teamImages().filter(im => im.num === p);
  return noteHead('n3') + `
    ${field('(1) 우리 자료를 도수가 아니라 상대도수로 비교해야 하는 까닭을 우리 자료의 수치를 넣어 설명하세요.', '', ta('n', 'n3.rel', { ro }))}
    <label class="f">(2) 짝 과업 설명 — ${p}번의 분석 결과를 보고 알 수 있는 사실 두 가지를 수치와 함께 쓰세요.</label>
    <div class="box small"><b>${p}번이 맡은 분석</b> ${esc(pRole)}</div>
    ${imgs.length ? `<div class="gallery">${imgs.map(im => imgFigure(im)).join('')}</div>` : `<p class="hint">${p}번이 아직 그래프를 올리지 않았어요. ${p}번의 화면을 함께 보거나, 올릴 때까지 기다려요.</p>`}
    ${ta('n', 'n3.pair', { ro, cls: 'l' })}
    ${field('(3) 우리 자료에 알맞은 대푯값과 그 까닭', '극단값, 같은 값이 여러 번 나오는지 등 자료의 특징과 연결', ta('n', 'n3.rep', { ro }))}
    <p class="hint">(선택) 두 집단의 상대도수 분포를 나타낸 그래프를 종이에 손으로 그려 보세요.</p>` + noteFoot('n3');
}

// 그림
function teamImages() {
  const imgs = S.team.images || {};
  return Object.entries(imgs).map(([id, x]) => ({ id, ...x })).sort((a, b) => (a.at || 0) - (b.at || 0));
}
function imgFigure(im, { controls = false } = {}) {
  const c = S.imgCache[im.id];
  return `<div class="gimg"><div class="ph">${c ? `<img src="${c.url}" alt="${esc((C.IMG_KIND_LABEL[im.kind] || '그림') + ' · ' + im.num + '번 ' + (im.caption || ''))}" title="누르면 크게 보여요" style="cursor:zoom-in">` : '<span class="muted small">불러오는 중…</span>'}</div>
    <div class="cap"><span class="chip">${esc(C.IMG_KIND_LABEL[im.kind] || '그림')}</span> <b>${esc(im.num)}번</b> ${esc(im.caption || '')}
    ${controls ? `<div class="btn-row" style="margin-top:6px">${c ? `<button class="btn small" data-action="imgDown" data-id="${esc(im.id)}">내려받기</button>` : ''}${im.num === S.m.num && !teamRO('s3') ? `<button class="btn small red" data-action="imgDel" data-id="${esc(im.id)}">지우기</button>` : ''}</div>` : ''}</div></div>`;
}
function renderImages() {
  const ro = teamRO('s3');
  const imgs = teamImages();
  const def = (C.DEFAULT_IMG_KIND[C.sizeKey(S.team.size)] || {})[S.m.num] || 'etc';
  return `<div class="card"><h3 style="margin-top:0">분석 결과 그림 올리기</h3>
    <p class="small">공학 도구에서 만든 <b>표·그래프 화면을 캡처</b>해서 올려요. 올린 그림은 짝 과업 설명(노트 ③)과 보고서에 자동으로 들어가고, 마지막에 캔바 슬라이드에 넣을 때 내려받을 수 있어요.</p>
    <div class="box small">크롬북: <b>Ctrl + Shift + 창 표시 키(□||)</b>로 부분 캡처 → 아래 상자를 누르고 <b>Ctrl + V</b> · 윈도우: <b>Windows + Shift + S</b> → Ctrl + V</div>
    ${ro ? '' : `<div class="row"><div class="grow"><label class="f">무엇을 나타낸 그림인가요?</label><select id="imgKind">${C.IMG_KINDS.map(k => `<option value="${k.id}" ${k.id === def ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></div>
      <div class="grow"><label class="f">설명(선택)</label><input id="imgCap" type="text" placeholder="예: 두 집단의 상대도수 분포 비교"></div></div>
      <div class="drop" id="drop" tabindex="0" style="margin-top:10px"><b>여기를 누르고 Ctrl + V</b>로 붙여 넣거나, 그림 파일을 끌어다 놓거나, <u>눌러서 파일 고르기</u><input type="file" id="imgFile" accept="image/*" hidden></div>
      <p class="hint">모둠당 ${C.MAX_IMAGES_PER_TEAM}장까지(지금 ${imgs.length}장). 그림은 자동으로 알맞은 크기로 줄여서 저장해요.</p>`}
    <div class="gallery">${imgs.map(im => imgFigure(im, { controls: true })).join('') || '<p class="muted">아직 올린 그림이 없어요.</p>'}</div></div>`;
}

// ─────────────────────────────── 4. 결과 해석
function renderS4() {
  let h = stageHead('s4');
  if (!S.team.request) return h + `<div class="card">앞 단계를 먼저 해요.</div>`;
  const n4 = S.notes.n4 || {};
  h += roleBox('s4');
  h += sub('s4', [['n4', '개인 노트 ④(먼저)', n4.submitted ? '' : '!'], ['concl', '모둠 결론'], ['sum', '분석 결과 모아 보기']]);
  const s = curSub('s4');
  if (s === 'n4') return h + renderN4();
  if (s === 'sum') return h + analysisSummary();
  const ro = teamRO('s4') || !n4.submitted;
  const ns = S.team.noteStatus || {};
  return h + `<div class="card"><h3 style="margin-top:0">모둠 결론</h3>
    ${!n4.submitted && !teamRO('s4') ? `<div class="box warm">개인 노트 ④를 먼저 제출하면 모둠 결론을 함께 쓸 수 있어요.</div>` : ''}
    <p class="small">개인 노트 ④ 제출: ${sizeArr().map(n => `<span class="mini ${ns[n] && ns[n].n4 ? 'on' : ''}">${n}</span>`).join('')} · 진행(${leaderOf('s4') || 4}번)이 모둠원의 결론을 모아 합의를 이끌어요.</p>
    <div class="box small">${esc(C.INTERPRET_TIP)}</div>
    ${C.CONCL.map(b => field(b.t, b.h, ta('t', `concl.${b.k}`, { ro }))).join('')}</div>`;
}
function renderN4() {
  const ro = noteRO('n4');
  return noteHead('n4') + `<div class="box small"><b>해석할 때 주의</b> ${esc(C.INTERPRET_TIP)}</div>
    ${C.CONCL.map(b => field(b.t, b.h.replace('탐구 문제에 대한 답', '탐구 문제에 대한 나의 답'), ta('n', `n4.${b.k}`, { ro }))).join('')}` + noteFoot('n4');
}
function analysisSummary() {
  const a = S.tdoc.analysis || {};
  const rep = a.rep || {}, thr = a.thr || {};
  const g1 = (a.g1 && a.g1.name) || '집단 1', g2 = (a.g2 && a.g2.name) || '집단 2';
  const sents = [1, 2, 3, 4, 5, 6].map(i => a.sent && a.sent['s' + i]).filter(Boolean);
  return `<div class="card"><h3 style="margin-top:0">분석 결과 모아 보기</h3>
    <table class="t center"><tr><th></th><th>평균</th><th>중앙값</th><th>최빈값</th><th>기준 비율 ${esc(thr.value || '')}</th></tr>
    <tr><th>${esc(g1)}</th><td>${esc(rep.mean1 || '')}</td><td>${esc(rep.med1 || '')}</td><td>${esc(rep.mode1 || '')}</td><td>${esc(thr.p1 || '')}</td></tr>
    <tr><th>${esc(g2)}</th><td>${esc(rep.mean2 || '')}</td><td>${esc(rep.med2 || '')}</td><td>${esc(rep.mode2 || '')}</td><td>${esc(thr.p2 || '')}</td></tr></table>
    ${rep.pick ? `<p><b>알맞은 대푯값</b> ${nl2br(rep.pick)}</p>` : ''}
    ${a.sup ? `<p><b>보조 자료</b> ${nl2br(a.sup)}</p>` : ''}
    <h4>분석 결과 문장</h4>${sents.length ? `<ul>${sents.map(s => `<li>${nl2br(s)}</li>`).join('')}</ul>` : '<p class="muted">아직 없어요.</p>'}
    <div class="gallery">${teamImages().map(im => imgFigure(im)).join('')}</div></div>`;
}

// ─────────────────────────────── 5. 보고서
function composeReport() {
  const td = S.tdoc, plan = td.plan || {}, a = td.analysis || {}, cc = td.concl || {};
  const used = usedCards();
  const g1 = (a.g1 && a.g1.name) || '집단 1', g2 = (a.g2 && a.g2.name) || '집단 2';
  const rep = a.rep || {}, thr = a.thr || {};
  const lines = [];
  [1, 2, 3, 4, 5, 6].forEach(i => { const s = a.sent && a.sent['s' + i]; if (s) lines.push('- ' + s.trim()); });
  if (rep.mean1 || rep.med1 || rep.mean2 || rep.med2) lines.push(`- 대푯값: ${g1} 평균 ${rep.mean1 || '-'}, 중앙값 ${rep.med1 || '-'}, 최빈값 ${rep.mode1 || '-'} / ${g2} 평균 ${rep.mean2 || '-'}, 중앙값 ${rep.med2 || '-'}, 최빈값 ${rep.mode2 || '-'}`);
  if (rep.pick) lines.push('- 알맞은 대푯값: ' + rep.pick.trim());
  if (thr.value) lines.push(`- 기준(${thr.value})에 해당하는 비율: ${g1} ${thr.p1 || '-'}, ${g2} ${thr.p2 || '-'}`);
  if (a.sup) lines.push('- 보조 자료: ' + a.sup.trim());
  return {
    motive: plan.motive || '',
    question: [plan.main, plan.sub ? '세부 질문: ' + plan.sub : ''].filter(Boolean).join('\n'),
    collect: used.map(id => { const c = S.cardMap[id]; return c ? `자료 ${id}: ${c.title}\n  조사 대상: ${c.target} / 조사 시기: ${c.period}\n  조사 방법: ${c.method} / 자료 수: ${c.n_text}` : ''; }).filter(Boolean).join('\n'),
    sources: '출처: 통계 프로젝트 자료 도서관 ' + used.map(id => C.sourceText(S.cardMap[id])).join(', '),
    analysis: lines.join('\n'),
    conclusion: [cc.c1, cc.c2 ? '근거 1: ' + cc.c2 : '', cc.c3 ? '근거 2: ' + cc.c3 : '', cc.c4 ? '예상과 비교: ' + cc.c4 : ''].filter(Boolean).join('\n'),
    limits: [cc.c5 ? '한계: ' + cc.c5 : '', cc.c6 ? '제언: ' + cc.c6 : ''].filter(Boolean).join('\n'),
  };
}
const REPORT_FIELDS = [
  ['motive', '탐구 동기', 's1'], ['question', '탐구 문제', 's1'],
  ['collect', '조사 대상·조사 방법·조사 내용', 's2'], ['sources', '사용한 자료 번호와 출처', 's2'],
  ['analysis', '분석 결과(표·그래프 설명, 대푯값, 기준 비율, 보조 자료)', 's3'],
  ['conclusion', '결론과 근거', 's4'], ['limits', '한계와 제언', 's4'], ['feel', '느낀 점', 's4'],
];
function renderS5() {
  let h = stageHead('s5');
  if (!S.team.request) return h + `<div class="card">앞 단계를 먼저 해요.</div>`;
  const ro = teamRO('s5');
  const r = S.tdoc.report || {};
  if (!r.initAt && !ro) setTimeout(initReport, 0);
  h += sub('s5', [['form', '보고서(모둠)'], ['slides', '슬라이드용 문장·그림']]);
  if (curSub('s5') === 'slides') return h + renderSlides();
  const topic = topicObj();
  const imgs = teamImages();
  const skip = r.skip || {};
  const stageLabel = { s1: '탐구 문제 설정', s2: '자료 수집', s3: '자료 분석', s4: '결과 해석' };
  let last = '';
  let rows = '';
  REPORT_FIELDS.forEach(([k, label, st]) => {
    const head = st !== last ? `<tr><th colspan="2" style="background:var(--${st});color:#fff">${stageLabel[st]}</th></tr>` : '';
    last = st;
    rows += head + `<tr><th>${esc(label)}</th><td>${ta('t', `report.${k}`, { ro, cls: k === 'analysis' || k === 'collect' ? 'l' : '' })}
      ${!ro && k !== 'feel' ? `<button class="btn small" data-action="reCompose" data-k="${k}">앞 단계에서 다시 가져오기</button>` : ''}
      ${k === 'analysis' ? `<div style="margin-top:8px"><b class="small">보고서에 넣을 그림</b>${imgs.length ? imgs.map(im => `<div><label><input type="checkbox" data-action="imgSkip" data-id="${esc(im.id)}" ${skip[im.id] ? '' : 'checked'} ${ro ? 'disabled' : ''}> ${esc(C.IMG_KIND_LABEL[im.kind] || '')} (${esc(im.num)}번) ${esc(im.caption || '')}</label></div>`).join('') : '<p class="hint">3단계에서 올린 그림이 없어요.</p>'}</div>` : ''}</td></tr>`;
  });
  h += `<div class="card"><h3 style="margin-top:0">통계 보고서 — ${esc(topic ? topic.title : '')}</h3>
    <p class="small muted">앞 단계에서 쓴 내용이 모여 있어요. 문장을 다듬어 완성해요(지도서 259쪽 양식). 느낀 점은 ${C.FEEL_WRITER}번이 정리해요.</p>
    <div class="report"><table class="rt">${rows}</table></div>
    <div class="btn-row"><button class="btn primary" data-action="print">보고서 인쇄·PDF로 저장</button>
    ${ro ? '' : S.team.reportDone ? `<span class="chip ok">완성 표시함 (${esc(S.team.reportDone.by)}번)</span><button class="btn small" data-action="reportUndone">완성 표시 취소</button>` : `<button class="btn green" data-action="reportDone">보고서 완성 표시</button>`}</div></div>`;
  return h;
}
function initReport() {
  const r = S.tdoc.report || {};
  if (r.initAt || teamRO('s5')) return;
  const c = composeReport();
  Object.entries(c).forEach(([k, v]) => { if (!r[k]) { setPath(S.tdoc, `report.${k}`, v); tSaver.queue(`report.${k}`, v); } });
  setPath(S.tdoc, 'report.initAt', Date.now());
  tSaver.queue('report.initAt', Date.now());
  tSaver.flush();
  S.lastSig = '';
  render();
}
function slideList() {
  const r = S.tdoc.report || {};
  const topic = topicObj();
  const label = `${S.team.className} ${S.team.teamNo}모둠`;
  const firstQ = (r.question || '').split('\n')[0];
  return [
    ['1. 표지', `${topic ? topic.title : ''}\n${label}\n탐구 문제: ${firstQ}`],
    ['2. 탐구 동기와 탐구 문제', `탐구 동기: ${r.motive || ''}\n\n탐구 문제: ${r.question || ''}`],
    ['3. 자료 수집', `${r.collect || ''}\n\n${r.sources || ''}`],
    ['4. 자료 분석', `${r.analysis || ''}\n\n(그래프: 아래 그림을 내려받아 넣어요)`],
    ['5. 결론', r.conclusion || ''],
    ['6. 한계와 제언, 느낀 점', `${r.limits || ''}\n\n느낀 점: ${r.feel || ''}`],
  ];
}
function renderSlides() {
  const imgs = reportImages();
  return `<div class="card"><h3 style="margin-top:0">슬라이드용 문장(6장 구성안)</h3>
    <p class="small">보고서를 다듬은 뒤, 장마다 '복사'를 눌러 캔바에 붙여 넣어요. 슬라이드에는 문장을 줄이고 그래프를 크게 넣어요.</p>
    ${slideList().map(([t, x], i) => `<div class="slide"><div class="sh"><b>${esc(t)}</b><button class="btn small" data-action="copySlide" data-i="${i}">복사</button></div><pre>${esc(x)}</pre></div>`).join('')}
    <h3>그림 내려받기</h3>${imgs.length ? `<div class="gallery">${imgs.map(im => imgFigure(im, { controls: true })).join('')}</div>` : '<p class="muted">올린 그림이 없어요.</p>'}</div>`;
}
function reportImages() { const skip = (S.tdoc.report || {}).skip || {}; return teamImages().filter(im => !skip[im.id]); }

function printReport() {
  const r = S.tdoc.report || {};
  const topic = topicObj();
  const imgs = reportImages();
  const nums = sizeArr().map(n => n + '번').join(', ');
  const cell = k => nl2br(r[k] || '');
  $('#printArea').innerHTML = `<div class="report">
    <h1>통계 보고서: ${esc(topic ? topic.title : '')}</h1>
    <p>${esc(S.team.className)} ${esc(S.team.teamNo)}모둠 (${nums})</p>
    <table class="rt">
      <tr><th>탐구 문제 설정</th><td><b>탐구 동기</b><br>${cell('motive')}<br><br><b>탐구 문제</b><br>${cell('question')}</td></tr>
      <tr><th>자료 수집</th><td>${cell('collect')}<br><br>${cell('sources')}</td></tr>
      <tr><th>자료 분석</th><td>${imgs.length ? `<div class="imgs">${imgs.map(im => { const c = S.imgCache[im.id]; return c ? `<figure><img src="${c.url}"><figcaption>${esc(C.IMG_KIND_LABEL[im.kind] || '')} ${esc(im.caption || '')}</figcaption></figure>` : ''; }).join('')}</div>` : ''}${cell('analysis')}</td></tr>
      <tr><th>결과 해석</th><td><b>결론과 근거</b><br>${cell('conclusion')}<br><br><b>한계와 제언</b><br>${cell('limits')}</td></tr>
      <tr><th>느낀 점</th><td>${cell('feel')}</td></tr>
    </table></div>`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 300);
}

// ─────────────────────────────── 6. 되돌아보기 / 7. 발표
function renderS6() {
  const ro = stState('s6') !== 'open' || !!(S.notes.s6 && S.notes.s6.submitted);
  const s6 = S.notes.s6 || {};
  const mates = sizeArr().filter(n => n !== S.m.num);
  return stageHead('s6') + `<div class="card"><h3 style="margin-top:0">과정 되돌아보기 <span class="hint">— 혼자 씁니다</span></h3>
    ${s6.submitted ? `<div class="submitted">제출했어요 (${fmtTime(s6.submittedAt)}).</div>` : ''}
    <h4>자기 평가(지도서 259쪽)</h4>
    <div class="tscroll"><table class="t"><tr><th>질문</th>${C.SELF_SCALE.map(x => `<th class="center" style="width:80px">${x}</th>`).join('')}</tr>
    ${C.SELF_Q.map((q, i) => `<tr><td>${esc(q)}</td>${C.SELF_SCALE.map(x => `<td class="center"><input type="radio" name="self${i}" value="${x}" data-b="n:s6.self.q${i + 1}" ${ro ? 'disabled' : ''} ${(s6.self || {})['q' + (i + 1)] === x ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}</table></div>
    <h4>모둠원 평가 — 모둠원이 한 일 가운데 도움이 된 점을 구체적으로 써 주세요.</h4>
    ${mates.map(n => `<div class="card tight"><b>${n}번</b>${field('맡은 역할에서 잘한 점', '', ta('n', `s6.peer.${n}.role`, { ro, cls: 's' }))}${field('모둠에 도움이 된 점', '', ta('n', `s6.peer.${n}.help`, { ro, cls: 's' }))}</div>`).join('')}
    ${field('이번 프로젝트에서 새로 알게 된 점과 더 알아보고 싶은 점', '', ta('n', 's6.learn', { ro, cls: 'l' }))}
    ${ro ? '' : `<div class="btn-row"><button class="btn primary" data-action="submitNote" data-note="s6">제출하기</button><span class="hint">제출하면 고칠 수 없어요.</span></div>`}</div>`;
}
function renderS7() {
  const ro = stState('s7') !== 'open';
  const tp = (S.cls && S.cls.teamsPublic) || {};
  const others = Object.entries(tp).map(([no, x]) => ({ no: +no, ...x })).filter(x => x.no !== +S.team.teamNo).sort((a, b) => a.no - b.no);
  const done = S.notes.s7 && S.notes.s7.done;
  return stageHead('s7') + `<div class="card"><h3 style="margin-top:0">다른 모둠 발표 듣고 쓰기</h3>
    <p class="small">발표를 들으며 모둠마다 <b>잘한 점</b>과 <b>질문 1개</b>를 써요. 근거(수치·그래프)를 잘 들었는지, 결론이 자료가 말하는 것보다 크지 않은지 생각해요.</p>
    ${others.length ? others.map(o => { const tt = S.topicMap[o.topic]; return `<div class="card tight"><b>${o.no}모둠</b> ${tt ? `· ${esc(tt.short)}` : ''}
      ${field('잘한 점', '', ta('n', `s7.t${o.no}.good`, { ro, cls: 's' }))}${field('질문', '', ta('n', `s7.t${o.no}.q`, { ro, cls: 's' }))}</div>`; }).join('') : '<p class="muted">모둠 목록을 기다리는 중이에요.</p>'}
    ${ro ? '' : done ? '<div class="submitted">다 썼다고 표시했어요.</div>' : `<div class="btn-row"><button class="btn primary" data-action="s7done">다 썼어요</button></div>`}</div>`;
}

// ─────────────────────────────── 화면 속 수치(합계, 겹침 알림)
function updateDynamic(root) {
  if (!S.team) return;
  const a = S.tdoc.analysis || {};
  ['f1', 'rf1', 'f2', 'rf2'].forEach(k => {
    const el = root.querySelector(`[data-dyn="ftsum-${k}"]`);
    if (!el) return;
    let sum = 0, any = false;
    Object.values(a.ft || {}).forEach(r => { const x = parseFloat(String((r || {})[k] ?? '').replace(',', '.')); if (isFinite(x)) { sum += x; any = true; } });
    el.textContent = any ? String(Math.round(sum * 1000) / 1000) : '';
  });
  const dup = root.querySelector('[data-dyn="n2dup"]');
  if (dup) {
    const mine = (S.notes.n2 || {}).card2;
    const picks = S.team.n2picks || {};
    const same = Object.entries(picks).filter(([n, c]) => +n !== S.m.num && c && c === mine).map(([n]) => n + '번');
    dup.innerHTML = mine && same.length ? `<div class="conflict">${esc(same.join(', '))}도 이 자료를 골랐어요. 가능하면 다른 자료로 써 보세요.</div>` : '';
  }
  $$('[data-dyn^="cand-"]', root).forEach(el => { el.innerHTML = candChip(el.dataset.dyn.slice(5)); });
}

// ─────────────────────────────── 그린 뒤 연결할 것
function afterRender() {
  const q = $('#catQuery');
  if (q) q.addEventListener('input', () => { S.ui.catQuery = q.value; $('#catList').innerHTML = catalogList(); syncValues($('#catList')); });
  const drop = $('#drop');
  if (drop) {
    const fileEl = $('#imgFile');
    drop.addEventListener('click', () => fileEl.click());
    drop.addEventListener('paste', e => { const f = [...(e.clipboardData || {}).files || []].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); uploadImage(f); } });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f) uploadImage(f); });
    fileEl.addEventListener('change', () => { if (fileEl.files[0]) uploadImage(fileEl.files[0]); fileEl.value = ''; });
  }
  ['hSrc', 'hStart', 'hWidth', 'hCount'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('change', () => { S.ui.helper = { src: $('#hSrc').value, start: $('#hStart').value, width: $('#hWidth').value, count: $('#hCount').value }; });
  });
}
document.addEventListener('toggle', e => { if (e.target && e.target.id === 'taskBox') S.ui.taskOpen = e.target.open; }, true);
// 그림 붙여 넣기는 그림 올리기 화면이면 상자를 누르지 않아도 된다.
document.addEventListener('paste', e => {
  if (!S.started || S.view.stage !== 's3' || curSub('s3') !== 'img' || teamRO('s3')) return;
  if (e.target.closest && e.target.closest('#drop')) return;
  if (e.target.matches && e.target.matches('input, textarea')) return;
  const f = [...((e.clipboardData || {}).files || [])].find(x => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); uploadImage(f); }
});

// ─────────────────────────────── 버튼 동작
document.addEventListener('click', async e => {
  if (e.target.matches && e.target.matches('.gimg img, .data-card img')) { // 그림 크게 보기
    modal(`<div class="row between"><b>${esc(e.target.alt || '그림')}</b><button class="btn small" data-act="close">닫기</button></div><img src="${esc(e.target.src)}" style="width:100%;margin-top:8px;border:1px solid var(--line);border-radius:8px">`, { wide: true });
    return;
  }
  const st = e.target.closest('[data-sub]');
  if (st) { const [stg, k] = st.dataset.sub.split(':'); flushAll(); S.view.sub[stg] = k; render(); return; }
  const b = e.target.closest('[data-action]');
  if (!b || !S.started) return;
  const act = b.dataset.action;
  try {
    if (actions[act]) await actions[act](b, e);
  } catch (err) {
    console.error(err);
    toast(err && err.code === 'permission-denied' ? '할 수 없는 동작이에요(단계가 닫혔거나 이미 제출했어요).' : '문제가 생겼어요: ' + (err.message || err), 'bad', 4000);
  }
});
const teamRef = () => doc(db, 'teams', S.m.team);
const actions = {
  qseen(b) { localStorage.setItem('qseen:' + S.m.team, b.dataset.at); render(); },
  conflict(b) {
    const p = b.dataset.path, c = S.conflicts[p];
    if (!c) return;
    modal(`<h2>${esc(c.who)}번이 쓴 글</h2><div class="rec"><div class="qa">${esc(c.v ?? '')}</div></div>
      <p class="small muted">내 글을 그대로 두면 내 글로 저장돼요.</p>
      <div class="btn-row"><button class="btn primary" data-act="take">${esc(c.who)}번 글로 바꾸기</button><button class="btn" data-act="keep">내 글 그대로 두기</button></div>`).then(r => {
      if (r.act === 'take') {
        delete tSaver.pending[p]; tSaver.inflight.delete(p); tSaver.unbackup(p);
        setPath(S.tdoc, p, c.v);
      }
      delete S.conflicts[p];
      syncValues(main());
    });
  },
  async choiceSubmit() {
    const c = S.tdoc.choice || {};
    const picks = [c.c1, c.c2, c.c3].filter(Boolean);
    if (!c.c1) return toast('1지망을 골라 주세요.', 'bad');
    if (!String(c.r1 || '').trim()) return toast('1지망을 고른 까닭을 써 주세요.', 'bad');
    if (new Set(picks).size !== picks.length) return toast('같은 주제를 두 번 고를 수 없어요.', 'bad');
    const names = [1, 2, 3].map(i => c['c' + i] ? `${i}지망: ${S.topicMap[c['c' + i]].no}. ${S.topicMap[c['c' + i]].title}` : '').filter(Boolean);
    if (!(await confirmBox('지망 제출', `<ul>${names.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`, '제출하기'))) return;
    await tSaver.flush();
    await updateDoc(teamRef(), { choice: { c1: c.c1 || '', c2: c.c2 || '', c3: c.c3 || '', r1: c.r1 || '', r2: c.r2 || '', r3: c.r3 || '', at: Date.now(), by: S.m.num } });
    toast('제출했어요.', 'good');
  },
  async choiceCancel() {
    if (S.team.topic) return;
    await updateDoc(teamRef(), { choice: deleteField() });
  },
  copyMotive() { setField('t', 'plan.motive', choiceReason()); },
  async planReq() {
    const p = S.tdoc.plan || {};
    if (!String(p.main || '').trim()) return toast('탐구 문제(주 질문)를 먼저 써 주세요.', 'bad');
    await tSaver.flush();
    await updateDoc(teamRef(), { planReq: { at: Date.now(), by: S.m.num } });
    toast('선생님께 확인을 요청했어요.', 'good');
  },
  async submitNote(b) {
    const nk = b.dataset.note;
    const n = S.notes[nk] || {};
    const need = {
      n1: [['q', '(1)'], ['who', '(2) 조사 대상'], ['var', '(2) 변량'], ['cmp', '(2) 비교 집단·기준'], ['can', '(2) 답할 수 있나요'], ['expect', '(3)']],
      n2: [['card1', '(1) 자료 번호'], ['why1', '(1)'], ['card2', '(2) 자료 번호'], ['why2', '(2)'], ['caution', '(3)']],
      n3: [['rel', '(1)'], ['pair', '(2)'], ['rep', '(3)']],
      n4: C.CONCL.map(x => [x.k, x.t]),
      s6: [['learn', '새로 알게 된 점']],
    }[nk] || [];
    const empty = need.filter(([k]) => !String(n[k] || '').trim()).map(([, l]) => l);
    if (nk === 's6' && Object.keys(n.self || {}).length < C.SELF_Q.length) empty.unshift('자기 평가');
    const msg = empty.length ? `<p>비어 있는 칸이 있어요: <b>${esc(empty.join(', '))}</b></p><p>그래도 제출할까요?</p>` : '<p>제출하면 고칠 수 없어요. 제출할까요?</p>';
    if (!(await confirmBox('제출하기', msg, '제출하기'))) return;
    if (!navigator.onLine) return toast('인터넷이 끊겨 있어요. 연결된 뒤 다시 눌러 주세요.', 'bad');
    await nSaver.flush();
    // 노트 잠금과 제출 표시를 한 번에(둘 중 하나만 저장되는 일이 없게)
    const bt = writeBatch(db);
    bt.set(doc(db, 'notes', S.m.seat), { [nk]: { submitted: true, submittedAt: serverTimestamp() }, classId: S.m.classId, team: S.m.team, num: S.m.num }, { merge: true });
    bt.update(teamRef(), { [`noteStatus.${S.m.num}.${nk}`]: Date.now() });
    await bt.commit();
    setPath(S.notes, `${nk}.submitted`, true);
    if (!getPath(S.notes, `${nk}.submittedAt`)) setPath(S.notes, `${nk}.submittedAt`, Date.now());
    S.lastSig = ''; render();
    toast('제출했어요.', 'good');
  },
  catDomain(b) { S.ui.catDomain = b.dataset.d; render(); },
  catToggle(b, e) { if (e.target.closest('button')) return; S.ui.catOpen[b.dataset.id] = !S.ui.catOpen[b.dataset.id]; $('#catList').innerHTML = catalogList(); syncValues($('#catList')); },
  async candOn(b) {
    const id = b.dataset.id;
    setPath(S.tdoc, `cand.${id}`, { by: S.m.num, memo: '' });
    await setDoc(doc(db, 'teamdocs', S.m.team), { cand: { [id]: { by: S.m.num, memo: '', at: Date.now() } } }, { merge: true });
    $('#catList').innerHTML = catalogList(); syncValues($('#catList'));
  },
  async candOff(b) {
    const id = b.dataset.id;
    if (S.tdoc.cand) delete S.tdoc.cand[id];
    delete tSaver.pending[`cand.${id}.memo`];
    await setDoc(doc(db, 'teamdocs', S.m.team), { cand: { [id]: deleteField() } }, { merge: true });
    $('#catList').innerHTML = catalogList(); syncValues($('#catList'));
  },
  toReq(b) { putIntoForm('r', b.dataset.id); },
  toRej(b) { putIntoForm('x', b.dataset.id); },
  async submitReq() {
    const q = S.tdoc.req || {};
    const rows = [1, 2, 3, 4].map(i => q['r' + i]).filter(r => r && r.card);
    const rej = [1, 2, 3, 4].map(i => q['x' + i]).filter(r => r && r.card);
    const ids = rows.map(r => r.card), xids = rej.map(r => r.card);
    const errs = [];
    if (!rows.length) errs.push('신청할 자료를 1장 이상 골라요.');
    if (rows.some(r => !String(r.reason || '').trim())) errs.push('신청하는 자료마다 고른 까닭을 써요.');
    if (rej.length < C.REQ.rejectedMin) errs.push(`고르지 않은 자료를 ${C.REQ.rejectedMin}장 이상 써요.`);
    if (rej.some(r => !String(r.reason || '').trim())) errs.push('고르지 않은 자료마다 까닭을 써요.');
    if (new Set(ids).size !== ids.length || new Set(xids).size !== xids.length) errs.push('같은 자료를 두 번 쓸 수 없어요.');
    if (ids.some(id => xids.includes(id))) errs.push('신청한 자료와 고르지 않은 자료가 겹쳐요.');
    if (errs.length) return modal(`<h2>아직 제출할 수 없어요</h2><ul>${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="btn-row"><button class="btn primary" data-act="ok">확인</button></div>`);
    if (!(await confirmBox('신청서 제출', `<p>신청: <b>${esc(ids.join(', '))}</b>번 / 고르지 않음: ${esc(xids.join(', '))}번</p><p>제출하면 바로 원자료가 열려요. 처음 신청은 한 번뿐이고, 나중에 1번(최대 ${C.REQ.reMax}장) 바꾸거나 더할 수 있어요.</p>`, '제출하기'))) return;
    await tSaver.flush();
    const clean = r => ({ card: r.card, reason: String(r.reason || ''), by: r.by ? +r.by : null });
    await updateDoc(teamRef(), { request: { rows: rows.map(clean), rejected: rej.map(clean), at: Date.now(), by: S.m.num }, released: ids });
    S.view.sub.s2 = 'got';
    refetchCards(ids);
    toast('원자료가 열렸어요.', 'good');
  },
  async submitRereq() {
    const q = S.tdoc.rereq || {};
    const rows = [1, 2].map(i => q['r' + i]).filter(r => r && r.card);
    const rel = released(), errs = [];
    if (!rows.length) errs.push('바꾸거나 더할 자료를 골라요.');
    rows.forEach(r => {
      if (!String(r.reason || '').trim()) errs.push(`자료 ${r.card}: 까닭을 써요.`);
      if (!r.mode) errs.push(`자료 ${r.card}: 방법(더하기/바꾸기)을 골라요.`);
      if (r.mode === 'replace' && !rel.includes(r.replaces)) errs.push(`자료 ${r.card}: 대신할 자료를 골라요.`);
      if (rel.includes(r.card)) errs.push(`자료 ${r.card}는 이미 받았어요.`);
    });
    const newIds = [...new Set(rows.map(r => r.card))];
    if (newIds.length !== rows.length) errs.push('같은 자료를 두 번 고를 수 없어요.');
    if (rel.length + newIds.length > C.REQ.releasedMax) errs.push(`받을 수 있는 자료는 모두 ${C.REQ.releasedMax}장까지예요.`);
    if (errs.length) return modal(`<h2>아직 신청할 수 없어요</h2><ul>${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="btn-row"><button class="btn primary" data-act="ok">확인</button></div>`);
    if (!(await confirmBox('재신청', `<p>${esc(rows.map(r => `${r.card}번 ${r.mode === 'replace' ? `(${r.replaces}번 대신)` : '(더하기)'}`).join(', '))}</p><p>재신청은 한 번뿐이에요.</p>`, '재신청하기'))) return;
    await tSaver.flush();
    const excluded = [...new Set([...(S.team.excluded || []), ...rows.filter(r => r.mode === 'replace').map(r => r.replaces)])];
    await updateDoc(teamRef(), {
      rerequest: { rows: rows.map(r => ({ card: r.card, mode: r.mode, replaces: r.mode === 'replace' ? r.replaces : '', reason: String(r.reason || '') })), at: Date.now(), by: S.m.num },
      released: [...rel, ...newIds], excluded,
    });
    refetchCards(newIds);
    toast('재신청한 자료가 열렸어요.', 'good');
  },
  async exclude(b) { await updateDoc(teamRef(), { excluded: arrayUnion(b.dataset.id) }); },
  async unexclude(b) { await updateDoc(teamRef(), { excluded: arrayRemove(b.dataset.id) }); },
  async copyVals(b) {
    const d = S.data[b.dataset.id]; if (!d) return;
    const vals = fmtVals(d[b.dataset.key] || []);
    const ok = await copyText(vals.join(b.dataset.sep === 'comma' ? ', ' : '\n'));
    toast(ok ? `값 ${vals.length}개를 복사했어요. 공학 도구에 붙여 넣어요.` : '복사하지 못했어요. 값을 직접 선택해 복사해 주세요.', ok ? 'good' : 'bad');
  },
  async copyTable(b) {
    const d = S.data[b.dataset.id]; if (!d) return;
    let rows = [];
    if (d.values && d.labels) { const fv = fmtVals(d.values); rows = [['구분', '값'], ...fv.map((v, i) => [d.labels[i], v])]; }
    else if (d.categories) rows = [[d.groups && String(d.categories[0][0]).includes('이상') ? '계급' : '항목', ...(d.groups || ['수'])], ...d.categories];
    else if (d.table) rows = [d.table.columns, ...d.table.rows];
    const ok = await copyText(rows.map(r => r.join('\t')).join('\n'));
    toast(ok ? '표를 복사했어요(스프레드시트에 붙여 넣기).' : '복사하지 못했어요.', ok ? 'good' : 'bad');
  },
  async task(b) {
    const v = b.checked;
    await updateDoc(teamRef(), { [`tasks.${S.m.num}.${b.dataset.task}`]: v });
  },
  fillClasses() {
    const a = S.tdoc.analysis || {}, c = a.cls || {};
    const st = parseFloat(c.start), w = parseFloat(c.width), n = Math.max(3, Math.min(15, parseInt(c.count, 10) || 8));
    if (!isFinite(st) || !isFinite(w) || w <= 0) return toast('계급의 시작값과 크기를 먼저 써 주세요.', 'bad');
    const fmt = x => String(Math.round(x * 1000) / 1000);
    for (let i = 0; i < n; i++) setField('t', `analysis.ft.r${i + 1}.cls`, `${fmt(st + i * w)} 이상 ~ ${fmt(st + (i + 1) * w)} 미만`);
  },
  helperRun() { S.ui.helper = { src: $('#hSrc').value, start: $('#hStart').value, width: $('#hWidth').value, count: $('#hCount').value }; render(); },
  async imgDel(b) {
    if (!(await confirmBox('그림 지우기', '<p>이 그림을 지울까요?</p>', '지우기'))) return;
    const id = b.dataset.id;
    const bt = writeBatch(db);
    bt.delete(doc(db, 'images', id));
    bt.update(teamRef(), { [`images.${id}`]: deleteField() });
    await bt.commit();
  },
  imgDown(b) {
    const im = teamImages().find(x => x.id === b.dataset.id); const c = S.imgCache[b.dataset.id];
    if (!im || !c) return;
    const ext = c.mime === 'image/jpeg' ? 'jpg' : 'png';
    downloadBlob(`${S.team.className}_${S.team.teamNo}모둠_${(C.IMG_KIND_LABEL[im.kind] || '그림').replace(/[·\s]/g, '')}_${im.num}번.${ext}`, c.blob);
  },
  imgSkip(b) { const v = !b.checked; setPath(S.tdoc, `report.skip.${b.dataset.id}`, v); tSaver.queue(`report.skip.${b.dataset.id}`, v); },
  async reCompose(b) {
    const k = b.dataset.k;
    const v = composeReport()[k] || '';
    if ((val('t', `report.${k}`) || '').trim() && !(await confirmBox('다시 가져오기', '<p>지금 칸의 내용을 앞 단계 내용으로 바꿀까요? 다듬은 문장은 사라져요.</p>', '바꾸기'))) return;
    setField('t', `report.${k}`, v);
  },
  print() { flushAll(); printReport(); },
  async reportDone() { await tSaver.flush(); await updateDoc(teamRef(), { reportDone: { at: Date.now(), by: S.m.num } }); toast('보고서를 완성으로 표시했어요.', 'good'); },
  async reportUndone() { await updateDoc(teamRef(), { reportDone: deleteField() }); },
  async copySlide(b) { const [, x] = slideList()[+b.dataset.i]; const ok = await copyText(x); toast(ok ? '복사했어요. 캔바에 붙여 넣어요.' : '복사하지 못했어요.', ok ? 'good' : 'bad'); },
  async s7done() {
    await nSaver.flush();
    const bt = writeBatch(db);
    bt.set(doc(db, 'notes', S.m.seat), { s7: { done: true, doneAt: serverTimestamp() }, classId: S.m.classId, team: S.m.team, num: S.m.num }, { merge: true });
    bt.update(teamRef(), { [`noteStatus.${S.m.num}.s7`]: Date.now() });
    await bt.commit();
    setPath(S.notes, 's7.done', true); S.lastSig = ''; render();
  },
};
function putIntoForm(kind, id) {
  const q = S.tdoc.req || {};
  const all = [1, 2, 3, 4].flatMap(i => [q['r' + i], q['x' + i]]).filter(Boolean).map(r => r.card);
  if (all.includes(id)) return toast('이미 신청서에 있어요.');
  const slot = [1, 2, 3, 4].find(i => !(q[kind + i] && q[kind + i].card));
  if (!slot) return toast(kind === 'r' ? `신청은 ${C.REQ.firstMax}장까지예요.` : '칸이 모두 찼어요.', 'bad');
  const p = `req.${kind}${slot}`;
  setField('t', p + '.card', id);
  setField('t', p + '.by', String(S.m.num));
  toast(`자료 ${id}를 ${kind === 'r' ? '신청 자료' : '고르지 않은 자료'} ${slot}번째 칸에 넣었어요. 까닭은 신청서에서 써요.`);
}

// ─────────────────────────────── 원자료·그림 불러오기
// 서버가 신청을 받아들인 뒤(쓰기 확인 뒤) 원자료를 다시 읽는다.
function refetchCards(ids) {
  ids.forEach(id => { if (!S.data[id]) { S.dataLoading[id] = false; fetchCard(id, 0); } });
}
function loadReleased(pending) {
  const ids = released();
  ids.forEach(id => { if (!S.data[id] && !S.dataLoading[id]) fetchCard(id, pending ? 1 : 0); });
}
async function fetchCard(id, attempt) {
  S.dataLoading[id] = true;
  if (attempt) await new Promise(r => setTimeout(r, 700 * attempt));
  try {
    const s = await getDoc(doc(db, 'carddata', id));
    if (s.exists()) { const x = s.data(); S.data[id] = x.json ? JSON.parse(x.json) : x; scheduleRender(); }
    S.dataLoading[id] = false;
  } catch (e) {
    S.dataLoading[id] = false;
    if (attempt < 6) fetchCard(id, attempt + 1);
    else console.error('원자료를 불러오지 못함', id, e);
  }
}
function loadImages() {
  teamImages().forEach(im => { if (!S.imgCache[im.id] && !S.imgLoading[im.id]) fetchImage(im.id, 0); });
}
async function fetchImage(id, attempt) {
  S.imgLoading[id] = true;
  if (attempt) await new Promise(r => setTimeout(r, 800 * attempt));
  try {
    const s = await getDoc(doc(db, 'images', id));
    if (s.exists()) {
      const d = s.data();
      const blob = new Blob([d.bytes.toUint8Array()], { type: d.mime || 'image/png' });
      S.imgCache[id] = { url: URL.createObjectURL(blob), blob, mime: d.mime };
      scheduleRender();
    }
    S.imgLoading[id] = false;
  } catch (e) {
    S.imgLoading[id] = false;
    if (attempt < 3) fetchImage(id, attempt + 1);
  }
}
let uploading = false;
async function uploadImage(file) {
  if (uploading) return;
  if (teamImages().length >= C.MAX_IMAGES_PER_TEAM) return toast(`그림은 모둠당 ${C.MAX_IMAGES_PER_TEAM}장까지예요. 필요 없는 그림을 지워 주세요.`, 'bad');
  uploading = true;
  const drop = $('#drop');
  if (drop) drop.innerHTML = '<b>올리는 중…</b>';
  try {
    const { blob, mime, w, h } = await compressImage(file);
    const bytes = Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer()));
    const ref = doc(collection(db, 'images'));
    const kind = ($('#imgKind') || {}).value || 'etc';
    const caption = (($('#imgCap') || {}).value || '').trim().slice(0, 80);
    const bt = writeBatch(db);
    bt.set(ref, { team: S.m.team, classId: S.m.classId, seat: S.m.seat, num: S.m.num, kind, caption, mime, w, h, size: blob.size, bytes, at: serverTimestamp() });
    bt.update(teamRef(), { [`images.${ref.id}`]: { num: S.m.num, kind, caption, w, h, at: Date.now() } });
    await bt.commit();
    S.imgCache[ref.id] = { url: URL.createObjectURL(blob), blob, mime };
    toast('그림을 올렸어요.', 'good');
  } catch (e) {
    console.error(e);
    toast(e.message && !e.code ? e.message : '그림을 올리지 못했어요. 다시 해 주세요.', 'bad', 4000);
  } finally {
    uploading = false;
    S.lastSig = ''; render();
  }
}
