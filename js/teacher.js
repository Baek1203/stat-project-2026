// 교사 화면
import {
  db, auth, configured, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  writeBatch, serverTimestamp, arrayUnion, deleteField
} from './fb.js';
import * as C from './common.js';
import {
  $, $$, esc, nl2br, getPath, fmtTime, tsMillis, toast, modal, confirmBox, randCode,
  toCSV, downloadText, downloadBlob, copyText
} from './util.js';

const T = {
  user: null, pool: null, info: null, cardMap: {}, topicMap: {},
  classes: [], clsId: localStorage.getItem('t:cls') || null, cls: null,
  teams: [], seats: [], view: localStorage.getItem('t:view') || 'run',
  drawer: null, drawerTab: 'sum', drawerDoc: null, drawerImgs: {},
  lottery: null, unsub: {},
};
const main = () => $('#main');

if (!configured) {
  document.body.innerHTML = `<div class="wrap narrow"><div class="card"><h1>설정이 필요해요</h1>
  <p><b>js/firebase-config.js</b> 파일에 Firebase 설정값을 붙여 넣어 주세요. 설치 안내서 2단계를 보세요.</p></div></div>`;
} else {
  onAuthStateChanged(auth, async user => {
    T.user = user;
    if (!user || user.isAnonymous) { showLogin(); return; }
    try {
      const s = await getDoc(doc(db, 'teacherinfo', 'cards'));
      T.info = s.exists() ? s.data() : null;
    } catch (e) {
      showLogin(`<div class="box red"><b>${esc(user.email)}</b>은(는) 교사 계정으로 등록되어 있지 않아요.<br>
        Firebase 콘솔 → Firestore → 규칙에서 <code>teacherEmails()</code>의 이메일을 이 주소로 바꾸고 '게시'했는지 확인해 주세요.</div>`);
      return;
    }
    await loadPool();
    subscribeClasses();
  });
}

function showLogin(msg = '') {
  $('#top').innerHTML = `<span class="brand">통계 프로젝트 · 교사</span>`;
  main().innerHTML = `<div class="wrap narrow"><div class="card"><h1>교사 로그인</h1>${msg}
    <p>규칙에 등록한 구글 계정으로 로그인해요.</p>
    <div class="btn-row"><button class="btn primary" id="loginBtn">구글 계정으로 로그인</button>
    ${T.user ? `<button class="btn" id="outBtn">다른 계정으로</button>` : ''}</div></div></div>`;
  $('#loginBtn').addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) {
      const c = e && e.code;
      const msg = c === 'auth/unauthorized-domain' ? `이 주소(${location.hostname})가 승인된 도메인에 없어요. 설치 안내서 6단계를 해 주세요.`
        : c === 'auth/popup-blocked' ? '팝업이 막혔어요. 주소창 오른쪽에서 팝업을 허용해 주세요.'
        : c === 'auth/operation-not-allowed' ? 'Firebase 콘솔에서 Google 로그인을 켜 주세요(설치 안내서 3단계).'
        : c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' ? '로그인 창이 닫혔어요. 다시 눌러 주세요.'
        : '로그인하지 못했어요: ' + (c || e.message);
      toast(msg, 'bad', 7000);
    }
  });
  const ob = $('#outBtn');
  if (ob) ob.addEventListener('click', () => signOut(auth));
}

async function loadPool() {
  try {
    const s = await getDoc(doc(db, 'pool', 'public'));
    T.pool = s.exists() ? s.data() : null;
  } catch (e) { T.pool = null; }
  T.cardMap = Object.fromEntries(((T.pool && T.pool.cards) || []).map(c => [c.id, c]));
  T.topicMap = Object.fromEntries(((T.pool && T.pool.topics) || []).map(t => [t.code, t]));
}

function subscribeClasses() {
  if (T.unsub.classes) T.unsub.classes();
  T.unsub.classes = onSnapshot(collection(db, 'classes'), qs => {
    T.classes = qs.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
    if (T.clsId && !T.classes.some(c => c.id === T.clsId)) T.clsId = null;
    if (!T.clsId && T.classes.length) T.clsId = T.classes[0].id;
    selectClass(T.clsId, true);
  }, e => toast('반 목록을 불러오지 못했어요: ' + e.code, 'bad'));
}

function selectClass(id, keep = false) {
  const changed = id !== (T.cls && T.cls.id);
  T.clsId = id;
  if (id) localStorage.setItem('t:cls', id);
  T.cls = T.classes.find(c => c.id === id) || null;
  if (changed || !keep) {
    ['teams', 'seats'].forEach(k => { if (T.unsub[k]) { T.unsub[k](); T.unsub[k] = null; } });
    T.teams = []; T.seats = []; T.lottery = null;
    if (id) {
      T.unsub.teams = onSnapshot(query(collection(db, 'teams'), where('classId', '==', id)), qs => {
        T.teams = qs.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.teamNo - b.teamNo);
        render();
        if (T.drawer) renderDrawer();
      }, e => toast('모둠을 불러오지 못했어요: ' + e.code, 'bad'));
      T.unsub.seats = onSnapshot(query(collection(db, 'seats'), where('classId', '==', id)), qs => {
        T.seats = qs.docs.map(d => ({ id: d.id, ...d.data() }));
        render();
        if (T.drawer) renderDrawer();
      }, e => console.error(e));
    }
  }
  render();
}

// ─────────────────────────────── 그리기
function renderTop() {
  $('#top').innerHTML = `
    <span class="brand">통계 프로젝트 · 교사</span>
    <select id="clsSel" style="width:auto;padding:3px 8px;color:#1d1d1b">${T.classes.length ? T.classes.map(c => `<option value="${c.id}" ${c.id === T.clsId ? 'selected' : ''}>${esc(c.name)}</option>`).join('') : '<option>반 없음</option>'}</select>
    ${[['run', '수업 진행'], ['lottery', '주제 추첨'], ['records', '기록·내려받기'], ['setup', '준비']].map(([k, l]) => `<button data-view="${k}" style="${T.view === k ? 'background:#fff;color:#1d1d1b' : ''}">${l}</button>`).join('')}
    <span class="spacer"></span><span class="who">${esc(T.user && T.user.email || '')}</span><button id="outBtn">로그아웃</button>`;
  $('#clsSel').addEventListener('change', e => selectClass(e.target.value));
  $$('#top [data-view]').forEach(b => b.addEventListener('click', () => { T.view = b.dataset.view; localStorage.setItem('t:view', T.view); render(); }));
  $('#outBtn').addEventListener('click', () => signOut(auth));
}

let renderQueued = false, lastKey = 0;
document.addEventListener('keydown', () => { lastKey = Date.now(); }, true);
function typingIn(root) {
  const a = document.activeElement;
  return a && root && root.contains(a) && a.matches('input[type=text], input[type=number], input:not([type]), textarea') && Date.now() - lastKey < 2500;
}
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!T.user) return;
    if (typingIn(main())) { setTimeout(render, 1500); return; } // 입력하는 중에는 잠깐 미룸
    renderTop();
    const active = document.activeElement;
    const focusKey = active && active.dataset && active.closest && active.closest('#main') ? active.dataset.keep : null;
    let h;
    if (!T.pool || !T.info) h = setupNeeded();
    else if (T.view === 'setup') h = renderSetup();
    else if (!T.cls) h = `<div class="card"><h2>반이 없어요</h2><p>'준비'에서 반을 먼저 만들어 주세요.</p><button class="btn primary" data-go="setup">준비로 가기</button></div>`;
    else if (T.view === 'lottery') h = renderLottery();
    else if (T.view === 'records') h = renderRecords();
    else h = renderRun();
    const keep = captureInputs();
    main().innerHTML = `<div class="wrap">${h}</div>`;
    restoreInputs(keep);
    if (focusKey) { const el = $(`#main [data-keep="${focusKey}"]`); if (el) el.focus(); }
  });
}
function captureInputs() {
  const o = {};
  $$('#main [data-keep]').forEach(el => { o[el.dataset.keep] = el.type === 'checkbox' ? el.checked : el.value; });
  return o;
}
function restoreInputs(o) {
  $$('#main [data-keep]').forEach(el => { if (el.dataset.keep in o) { if (el.type === 'checkbox') el.checked = o[el.dataset.keep]; else el.value = o[el.dataset.keep]; } });
}
function setupNeeded() {
  if (T.view !== 'setup') { T.view = 'setup'; }
  return renderSetup();
}

// ─────────────────────────────── 준비
function renderSetup() {
  const pool = T.pool;
  let h = `<h1>준비</h1>
  <div class="card"><h2>1. 자료 불러오기</h2>
    ${pool && T.info ? `<div class="box green">자료 카드 <b>${(pool.cards || []).length}장</b>, 주제 <b>${(pool.topics || []).length}개</b>를 불러왔어요 (${fmtTime(pool.importedAt)}).</div>` : `<div class="box warm">아직 자료를 불러오지 않았어요.</div>`}
    <p class="small">받은 파일 <b>통계프로젝트_자료풀_웹앱용.json</b>을 고르세요. 원자료는 Firestore에만 저장되고 GitHub에는 올라가지 않아요. 다시 불러오면 자료만 새것으로 바뀌고 학생 기록은 그대로예요.</p>
    <input type="file" id="poolFile" accept=".json,application/json"> <button class="btn primary" data-act="importPool">불러오기</button>
  </div>
  <div class="card"><h2>2. 반 만들기</h2>
    <div class="row">
      <div class="grow"><label class="f">반 이름</label><input type="text" id="newName" data-keep="newName" placeholder="예: 1학년 3반"></div>
      <div><label class="f">모둠 수</label><input type="number" id="newTeams" data-keep="newTeams" value="7" min="1" max="10" style="width:90px"></div>
      <div><label class="f">모둠 인원</label><select id="newSize" data-keep="newSize" style="width:100px"><option value="4">4명</option><option value="3">3명</option><option value="5">5명</option></select></div>
      <div><label class="f">차시 안</label><select id="newPlan" data-keep="newPlan" style="width:130px"><option value="45">4~5차시 안</option><option value="6">6차시 안</option></select></div>
    </div>
    <div class="btn-row"><button class="btn primary" data-act="createClass">반 만들기</button><span class="hint">모둠마다 입장 코드(6글자)가 만들어져요. 인원은 모둠별로 나중에 바꿀 수 있어요.</span></div>
  </div>`;
  if (T.cls) {
    const seatsOf = code => T.seats.filter(s => s.team === code);
    h += `<div class="card"><h2>3. ${esc(T.cls.name)} 모둠과 입장 코드</h2>
      <div class="tscroll"><table class="t"><tr><th>모둠</th><th>입장 코드</th><th>인원</th><th>들어온 번호</th><th></th></tr>
      ${T.teams.map(t => `<tr><td>${t.teamNo}모둠</td><td style="font-size:18px;letter-spacing:2px"><b>${t.id}</b></td>
        <td><select data-size="${t.id}" style="width:90px">${[3, 4, 5].map(n => `<option value="${n}" ${t.size === n ? 'selected' : ''}>${n}명</option>`).join('')}</select></td>
        <td>${Array.from({ length: t.size }, (_, i) => i + 1).map(n => `<span class="mini ${seatsOf(t.id).some(s => s.num === n) ? 'on' : ''}">${n}</span>`).join('')}</td>
        <td><button class="btn small red" data-act="delTeam" data-id="${t.id}">모둠 지우기</button></td></tr>`).join('')}</table></div>
      <div class="btn-row"><button class="btn" data-act="addTeam">모둠 하나 더</button><button class="btn primary" data-act="printCodes">입장 카드 인쇄</button>
        <span class="grow"></span><button class="btn small red" data-act="delClass">이 반 지우기</button></div>
      <p class="hint">학생 주소: <b>${esc(studentUrl())}</b></p></div>`;
  }
  h += `<div class="card"><h2>자료 카드 58장(교사용)</h2><p class="small muted">유형과 함정 까닭은 교사 화면에서만 보여요.</p>${cardTable()}</div>`;
  return h;
}
function studentUrl() { return new URL('./', location.href).href; }
function roleChip(id, teamTopic) {
  const inf = T.info && T.info.cards && T.info.cards[id];
  if (!inf) return `<span class="chip">${esc(id)}</span>`;
  const other = teamTopic && inf.topic !== teamTopic;
  const cls = other ? 'other' : { 핵심: 'core', 보조: 'sup', 기준: 'ref', 함정: 'trap' }[inf.role] || '';
  const label = other ? `${id} 다른 주제(${inf.topic_no})` : `${id} ${inf.role}${inf.role === '함정' ? '·' + inf.trap_type : ''}`;
  return `<span class="chip ${cls}" title="${esc(inf.note || '')}">${esc(label)}</span>`;
}
function cardTable() {
  const cards = (T.pool && T.pool.cards) || [];
  if (!cards.length) return '<p class="muted">자료를 먼저 불러와 주세요.</p>';
  return `<div class="tscroll"><table class="t"><tr><th>번호</th><th>자료명</th><th>주제</th><th>유형</th><th>교사용 메모</th></tr>
    ${cards.map(c => { const inf = T.info.cards[c.id] || {}; const tp = T.topicMap[inf.topic]; return `<tr><td><button class="btn small" data-act="cardView" data-id="${c.id}">${c.id}</button></td><td>${esc(c.title)}</td><td>${tp ? tp.no + '. ' + esc(tp.short) : ''}</td><td>${roleChip(c.id)}</td><td class="small">${esc(inf.note || '')}</td></tr>`; }).join('')}</table></div>`;
}

// ─────────────────────────────── 수업 진행
function planStatus(t) {
  const r = t.planReq, c = t.planCheck;
  if (r && (!c || c.reqAt !== r.at)) return { k: 'wait', label: '확인 요청' };
  if (c && c.state === 'pass') return { k: 'ok', label: '통과' };
  if (c && c.state === 'revise') return { k: 'no', label: '보완' };
  return { k: 'gray', label: '-' };
}
function renderRun() {
  const cls = T.cls;
  const planKey = cls.plan || '45';
  const plan = C.PLANS[planKey];
  const st = cls.stages || {};
  const waiting = T.teams.filter(t => planStatus(t).k === 'wait');
  let h = `<div class="row between"><h1 style="margin:0">${esc(cls.name)} 수업 진행</h1>
    <div class="row"><label class="small">차시 안</label><select id="planSel" style="width:auto">${Object.entries(C.PLANS).map(([k, p]) => `<option value="${k}" ${k === planKey ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
  <div class="card"><h3 style="margin-top:0">차시 시작 <span class="hint">— 누르면 그 차시에 맞게 단계가 열리고 닫혀요</span></h3>
    <div class="periods">${plan.periods.map(p => `<button class="btn ${cls.period === p.key ? 'on' : ''}" data-act="period" data-key="${p.key}"><b>${esc(p.label)}</b> <span class="small">${esc(p.sub)}</span></button>`).join('')}</div>
    <details id="stageCtl" style="margin-top:10px" ${T.stageCtlOpen ? 'open' : ''}><summary class="small">단계를 하나씩 열고 닫기</summary>
    <div class="stagectl" style="margin-top:8px">${C.STAGES.map(s => `<div class="sc"><span class="stage-chip bg-${s.color}">${esc(s.tab)}</span>
      <div class="seg">${['hidden', 'open', 'done'].map(v => `<button class="${(st[s.id] || 'hidden') === v ? 'on' : ''}" data-act="stage" data-id="${s.id}" data-v="${v}">${C.STAGE_STATE_LABEL[v]}</button>`).join('')}</div></div>`).join('')}</div>
    <label class="small" style="display:block;margin-top:8px"><input type="checkbox" data-act="helper" ${cls.helper ? 'checked' : ''}> 3단계 '도수 세기 도우미' 켜기(공학 도구를 쓸 수 없을 때만)</label></details>
  </div>`;
  if (waiting.length) {
    h += `<div class="card" style="border-color:#e8cf6a;background:#fffbea"><h3 style="margin-top:0">탐구 계획서 확인 요청 ${waiting.length}</h3>
      ${waiting.map(t => `<div class="row" style="margin:4px 0"><b>${t.teamNo}모둠</b> <span class="small muted">${fmtTime(t.planReq.at)}</span>
        <button class="btn small" data-act="open" data-id="${t.id}" data-tab="plan">계획서 보기</button>
        <button class="btn small green" data-act="planPass" data-id="${t.id}">통과</button></div>`).join('')}</div>`;
  }
  h += `<div class="card tight"><div class="row between"><h3 style="margin:0">모둠 현황</h3><span class="hint">줄을 누르면 자세히 볼 수 있어요. 자료 칩 색: <span class="chip core">핵심</span> <span class="chip sup">보조</span> <span class="chip ref">기준</span> <span class="chip trap">함정</span> <span class="chip other">다른 주제</span></span></div>
    <div class="tscroll" style="margin-top:8px"><table class="dash"><tr><th>모둠</th><th>주제</th><th class="nowrap">입장</th><th class="nowrap">계획서</th><th>받은 자료</th><th>과업·그림</th><th>개인 노트 ①②③④ · 되돌아보기</th><th>보고서</th></tr>
    ${T.teams.map(t => dashRow(t)).join('')}</table></div></div>`;
  return h;
}
function dashRow(t) {
  const topic = t.topic && T.topicMap[t.topic];
  const ps = planStatus(t);
  const seats = T.seats.filter(s => s.team === t.id);
  const nums = Array.from({ length: t.size }, (_, i) => i + 1);
  const tasks = C.tasksFor(t.size);
  const ns = t.noteStatus || {};
  const imgs = Object.values(t.images || {});
  const rel = t.released || [], ex = t.excluded || [];
  return `<tr class="clickable" data-act="open" data-id="${t.id}">
    <td class="nowrap"><b>${t.teamNo}모둠</b><div class="small muted">${t.id}</div></td>
    <td>${topic ? `${topic.no}. ${esc(topic.short)}` : t.choice && t.choice.at ? '<span class="chip wait">지망 제출</span>' : '<span class="muted">-</span>'}</td>
    <td>${seats.length}/${t.size}</td>
    <td><span class="chip ${ps.k}">${ps.label}</span></td>
    <td>${rel.map(id => `<span style="${ex.includes(id) ? 'text-decoration:line-through;opacity:.6' : ''}">${roleChip(id, t.topic)}</span>`).join(' ')}${t.rerequest ? ' <span class="chip wait">재신청</span>' : ''}</td>
    <td>${nums.map(n => { const mine = tasks.filter(tk => C.taskWho(tk, t.size).includes(n)); const d = mine.filter(tk => t.tasks && t.tasks[n] && t.tasks[n][tk.id]).length; return `<span class="mini ${d && d === mine.length ? 'on' : d ? 'half' : ''}" title="${n}번 과업 ${d}/${mine.length}">${n}</span>`; }).join('')} <span class="small">그림 ${imgs.length}</span></td>
    <td>${nums.map(n => `<div class="nowrap"><span class="small">${n}번</span> ${['n1', 'n2', 'n3', 'n4', 's6'].map((k, i) => `<span class="mini ${ns[n] && ns[n][k] ? 'on' : ''}">${['①', '②', '③', '④', '되'][i]}</span>`).join('')}</div>`).join('')}</td>
    <td>${t.reportDone ? '<span class="chip ok">완성</span>' : '<span class="muted">-</span>'}</td></tr>`;
}

// ─────────────────────────────── 모둠 자세히 보기(서랍)
function openDrawer(id, tab = 'sum') {
  T.drawer = id; T.drawerTab = tab; T.drawerDoc = null;
  if (T.unsub.drawer) T.unsub.drawer();
  T.unsub.drawer = onSnapshot(doc(db, 'teamdocs', id), s => { T.drawerDoc = s.exists() ? s.data() : {}; renderDrawer(); });
  renderDrawer();
}
function closeDrawer() {
  T.drawer = null;
  if (T.unsub.drawer) { T.unsub.drawer(); T.unsub.drawer = null; }
  const d = $('#drawer'); if (d) d.remove();
}
function renderDrawer() {
  const t = T.teams.find(x => x.id === T.drawer);
  if (!t) { closeDrawer(); return; }
  let d = $('#drawer');
  if (!d) { d = document.createElement('div'); d.id = 'drawer'; d.className = 'drawer'; document.body.appendChild(d); }
  if (typingIn(d)) { clearTimeout(renderDrawer._t); renderDrawer._t = setTimeout(renderDrawer, 1500); return; } // 쓰는 중에는 잠깐 미룸
  const keep = {};
  $$('input[id], textarea[id]', d).forEach(el => { keep[el.id] = el.value; });
  const topic = t.topic && T.topicMap[t.topic];
  const tabs = [['sum', '요약·질문 카드'], ['plan', '탐구 계획서'], ['data', '자료'], ['ana', '분석'], ['concl', '결론·보고서'], ['seat', '자리·노트']];
  d.innerHTML = `<div class="dh"><b>${esc(t.className)} ${t.teamNo}모둠</b> <span class="small muted">${t.id}</span> ${topic ? `<span class="chip">${topic.no}. ${esc(topic.short)}</span>` : ''}
      <span class="grow"></span><button class="btn small" data-act="present" data-id="${t.id}">보고서 크게 보기</button><button class="btn small" data-act="closeDrawer">닫기</button></div>
    <div class="db"><div class="subtabs">${tabs.map(([k, l]) => `<button class="subtab ${T.drawerTab === k ? 'active' : ''}" data-act="dtab" data-k="${k}">${l}</button>`).join('')}</div>
    ${T.drawerDoc ? drawerBody(t, T.drawerDoc) : '<p class="muted">불러오는 중…</p>'}</div>`;
  Object.entries(keep).forEach(([id, v]) => { const el = d.querySelector('#' + id); if (el && v) el.value = v; });
}
function qa(label, v) { return `<h4>${esc(label)}</h4><div class="qa">${esc(v == null || v === '' ? '(비어 있음)' : v)}</div>`; }
function drawerBody(t, td) {
  const tab = T.drawerTab;
  if (tab === 'sum') {
    const ps = planStatus(t);
    const ch = t.choice;
    return `<div class="rec">
      <h4>주제 지망</h4>${ch && ch.at ? `<div class="qa">${esc([1, 2, 3].map(i => ch['c' + i] ? `${i}지망 ${T.topicMap[ch['c' + i]] ? T.topicMap[ch['c' + i]].no + '. ' + T.topicMap[ch['c' + i]].short : ''}: ${ch['r' + i] || ''}` : '').filter(Boolean).join('\n'))}</div>` : '<p class="muted">아직 제출하지 않음</p>'}
      <h4>탐구 계획서 확인</h4><p><span class="chip ${ps.k}">${ps.label}</span> ${t.planCheck && t.planCheck.comment ? esc(t.planCheck.comment) : ''}</p>
      ${planCheckForm(t)}
      <h4>질문 카드 보내기</h4>
      <div class="stack">${C.QUESTION_CARDS.map((q, i) => `<div><button class="btn small" data-act="sendQ" data-id="${t.id}" data-i="${i}">보내기</button> ${esc(q)}</div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><input type="text" id="qCustom" class="grow" placeholder="직접 쓴 질문"><button class="btn small" data-act="sendQ" data-id="${t.id}" data-i="custom">보내기</button></div>
      ${(t.questions || []).length ? `<h4>보낸 질문</h4><ul class="small">${t.questions.map(q => `<li>${esc(q.text)} <span class="muted">${fmtTime(q.at)}</span></li>`).join('')}</ul>` : ''}
    </div>`;
  }
  if (tab === 'plan') {
    const p = td.plan || {};
    return `<div class="rec">${planCheckForm(t)}
      ${qa('탐구 동기', p.motive)}${qa('탐구 문제 — 주 질문', p.main)}${qa('세부 질문', p.sub)}
      <h4>체크리스트</h4><table class="t">${C.PLAN_CHECK.map((q, i) => { const c = (p.chk || {})['c' + (i + 1)] || {}; return `<tr><td>${c.ok ? '☑' : '☐'} ${esc(q)}</td><td>${esc(c.text || '')}</td></tr>`; }).join('')}</table>
      ${qa('예상 결과와 까닭', p.expect)}
      <h4>필요한 자료 계획</h4><table class="t"><tr><th></th><th>누구의</th><th>무엇을</th><th>언제·조건</th><th>방법</th></tr>${[['r1', '자료 1'], ['r2', '자료 2'], ['r3', '기준·보조']].map(([k, l]) => { const r = (p.need || {})[k] || {}; return `<tr><th>${l}</th><td>${esc(r.who || '')}</td><td>${esc(r.what || '')}</td><td>${esc(r.when || '')}</td><td>${esc(r.how || '')}</td></tr>`; }).join('')}</table></div>`;
  }
  if (tab === 'data') {
    const r = t.request;
    const cand = td.cand || {};
    const rows = (list, label) => list && list.length ? `<table class="t"><tr><th>자료</th><th>${label}</th><th>검토</th></tr>${list.map(x => `<tr><td>${roleChip(x.card, t.topic)}<div class="small">${esc((T.cardMap[x.card] || {}).title || '')}</div></td><td>${nl2br(x.reason)}</td><td>${x.by ? esc(x.by) + '번' : ''}</td></tr>`).join('')}</table>` : '<p class="muted">없음</p>';
    return `<div class="rec">
      <h4>후보로 검토한 자료</h4>${Object.keys(cand).length ? `<table class="t">${Object.entries(cand).map(([id, c]) => `<tr><td>${roleChip(id, t.topic)}</td><td>${esc(c.by)}번</td><td>${esc(c.memo || '')}</td></tr>`).join('')}</table>` : '<p class="muted">없음</p>'}
      <h4>① 신청한 자료 ${r ? `<span class="small muted">${fmtTime(r.at)} · ${esc(r.by)}번 제출</span>` : ''}</h4>${r ? rows(r.rows, '고른 까닭') : '<p class="muted">아직 제출하지 않음</p>'}
      <h4>② 고르지 않은 자료</h4>${r ? rows(r.rejected, '고르지 않은 까닭') : ''}
      ${qa('③ 받은 자료 점검', td.checkMemo)}
      <h4>④ 재신청</h4>${t.rerequest ? `<table class="t">${t.rerequest.rows.map(x => `<tr><td>${roleChip(x.card, t.topic)}</td><td>${x.mode === 'replace' ? `${esc(x.replaces)}번 대신` : '더하기'}</td><td>${nl2br(x.reason)}</td></tr>`).join('')}</table>` : '<p class="muted">없음</p>'}
      <h4>분석에 쓰지 않기로 한 자료</h4><p>${(t.excluded || []).map(id => roleChip(id, t.topic)).join(' ') || '<span class="muted">없음</span>'}</p>
      <h4>노트 ② '고르지 않은 자료' 고른 번호</h4><p class="small">${esc(Object.entries(t.n2picks || {}).map(([n, c]) => `${n}번: ${c}`).join(' · ')) || '-'}</p></div>`;
  }
  if (tab === 'ana') {
    const a = td.analysis || {};
    const cls = a.cls || {}, rep = a.rep || {}, thr = a.thr || {};
    const rowsN = Math.max(3, Math.min(15, parseInt(cls.count, 10) || 8));
    const imgs = Object.entries(t.images || {}).map(([id, x]) => ({ id, ...x }));
    loadDrawerImages(imgs.map(x => x.id));
    return `<div class="rec">
      <p>집단 1: <b>${esc((a.g1 || {}).name || '')}</b> (${esc((a.g1 || {}).card || '')}) · 집단 2: <b>${esc((a.g2 || {}).name || '')}</b> (${esc((a.g2 || {}).card || '')})</p>
      <table class="t center"><tr><th>가장 작은 값</th><th>가장 큰 값</th><th>시작값</th><th>크기</th><th>개수</th></tr><tr><td>${esc(cls.min || '')}</td><td>${esc(cls.max || '')}</td><td>${esc(cls.start || '')}</td><td>${esc(cls.width || '')}</td><td>${esc(cls.count || '')}</td></tr></table>
      ${qa('계급을 정한 까닭', cls.why)}
      <table class="t center"><tr><th>계급</th><th>집단 1</th><th>상대도수</th><th>집단 2</th><th>상대도수</th></tr>${Array.from({ length: rowsN }, (_, i) => { const r = (a.ft || {})['r' + (i + 1)] || {}; return `<tr><td>${esc(r.cls || '')}</td><td>${esc(r.f1 || '')}</td><td>${esc(r.rf1 || '')}</td><td>${esc(r.f2 || '')}</td><td>${esc(r.rf2 || '')}</td></tr>`; }).join('')}</table>
      <table class="t center"><tr><th></th><th>평균</th><th>중앙값</th><th>최빈값</th><th>기준 비율 ${esc(thr.value || '')}</th></tr><tr><th>집단 1</th><td>${esc(rep.mean1 || '')}</td><td>${esc(rep.med1 || '')}</td><td>${esc(rep.mode1 || '')}</td><td>${esc(thr.p1 || '')}</td></tr><tr><th>집단 2</th><td>${esc(rep.mean2 || '')}</td><td>${esc(rep.med2 || '')}</td><td>${esc(rep.mode2 || '')}</td><td>${esc(thr.p2 || '')}</td></tr></table>
      ${qa('알맞은 대푯값과 까닭', rep.pick)}${qa('보조 자료', a.sup)}
      <h4>분석 결과 문장</h4><ol>${[1, 2, 3, 4, 5, 6].map(i => { const s = (a.sent || {})['s' + i]; const by = td.by && td.by['analysis-sent-s' + i]; return s ? `<li>${esc(s)} <span class="small muted">(${esc(by || '?')}번)</span></li>` : ''; }).join('')}</ol>
      <h4>과업 확인</h4><table class="t">${C.tasksFor(t.size).map(tk => `<tr><td>${esc(tk.text)}</td><td>${C.taskWho(tk, t.size).map(n => `${n}번 ${t.tasks && t.tasks[n] && t.tasks[n][tk.id] ? '✓' : '·'}`).join(' ')}</td></tr>`).join('')}</table>
      <h4>올린 그림 ${imgs.length}장</h4><div class="gallery">${imgs.map(im => `<div class="gimg"><div class="ph">${T.drawerImgs[im.id] && T.drawerImgs[im.id].url ? `<img src="${T.drawerImgs[im.id].url}">` : '…'}</div><div class="cap">${esc(C.IMG_KIND_LABEL[im.kind] || '')} · <b>${esc(im.num)}번</b> ${esc(im.caption || '')}</div></div>`).join('')}</div></div>`;
  }
  if (tab === 'concl') {
    const c = td.concl || {}, r = td.report || {};
    return `<div class="rec"><h3>모둠 결론</h3>${C.CONCL.map(b => qa(b.t, c[b.k])).join('')}
      <h3>보고서</h3>${[['motive', '탐구 동기'], ['question', '탐구 문제'], ['collect', '자료 수집'], ['sources', '출처'], ['analysis', '분석 결과'], ['conclusion', '결론과 근거'], ['limits', '한계와 제언'], ['feel', '느낀 점']].map(([k, l]) => qa(l, r[k])).join('')}
      <p>${t.reportDone ? `<span class="chip ok">완성 표시 ${fmtTime(t.reportDone.at)} (${esc(t.reportDone.by)}번)</span>` : '<span class="muted">완성 표시 전</span>'}</p></div>`;
  }
  // 자리·노트
  const nums = Array.from({ length: t.size }, (_, i) => i + 1);
  const ns = t.noteStatus || {};
  return `<div class="rec"><p class="small">학생이 기기를 바꾸면 비밀번호로 다시 들어올 수 있어요. 비밀번호를 잊었거나 번호를 잘못 골랐다면 '자리 풀기'를 누르세요(쓴 내용은 그대로 남아요).</p>
    <table class="t"><tr><th>번호</th><th>자리</th><th>개인 노트(제출하면 잠김)</th></tr>
    ${nums.map(n => { const seat = T.seats.find(s => s.team === t.id && s.num === n); return `<tr><td><b>${n}번</b></td>
      <td>${seat ? `들어옴 <span class="small muted">${fmtTime(seat.at)}</span> <button class="btn small red" data-act="freeSeat" data-seat="${t.id}-${n}">자리 풀기</button>` : '<span class="muted">아직</span>'}</td>
      <td>${['n1', 'n2', 'n3', 'n4', 's6'].map(k => ns[n] && ns[n][k] ? `<button class="btn small" data-act="unlock" data-team="${t.id}" data-n="${n}" data-k="${k}" title="잠금 풀기">${k === 's6' ? '되돌아보기' : '노트 ' + k[1]} 잠금 풀기</button>` : '').join(' ') || '<span class="muted">제출한 노트 없음</span>'}</td></tr>`; }).join('')}
    </table><div class="btn-row"><button class="btn" data-act="goRecords">학생별 기록 보기</button></div></div>`;
}
function planCheckForm(t) {
  const ps = planStatus(t);
  return `<div class="box ${ps.k === 'wait' ? 'warm' : ''}"><b>탐구 계획서 확인</b> ${ps.k === 'wait' ? '— 확인을 요청했어요' : ''}
    <textarea id="pcComment" class="s" placeholder="한 줄 의견(보완할 점이나 칭찬)" style="margin-top:6px">${esc((t.planCheck && t.planCheck.comment) || '')}</textarea>
    <div class="btn-row"><button class="btn green small" data-act="planPass" data-id="${t.id}">통과</button><button class="btn small red" data-act="planRevise" data-id="${t.id}">보완 요청</button></div></div>`;
}
async function loadDrawerImages(ids) {
  let loaded = 0;
  for (const id of ids) {
    if (T.drawerImgs[id]) continue;
    T.drawerImgs[id] = { loading: true };
    try {
      const s = await getDoc(doc(db, 'images', id));
      if (s.exists()) { const d = s.data(); const blob = new Blob([d.bytes.toUint8Array()], { type: d.mime }); T.drawerImgs[id] = { url: URL.createObjectURL(blob), blob, mime: d.mime }; loaded++; }
    } catch (e) { delete T.drawerImgs[id]; }
  }
  if (loaded && T.drawer && T.drawerTab === 'ana') renderDrawer();
}

// 보고서 크게 보기(발표용)
async function present(id) {
  const t = T.teams.find(x => x.id === id);
  const td = (await getDoc(doc(db, 'teamdocs', id))).data() || {};
  const r = td.report || {};
  const skip = r.skip || {};
  const imgs = Object.entries(t.images || {}).map(([k, x]) => ({ id: k, ...x })).filter(x => !skip[x.id]).sort((a, b) => (a.at || 0) - (b.at || 0));
  await loadDrawerImages(imgs.map(x => x.id));
  const topic = t.topic && T.topicMap[t.topic];
  const cell = k => nl2br(r[k] || '');
  modal(`<div class="report" style="font-size:18px"><div class="row between"><h1>${esc(topic ? topic.title : '')}</h1><button class="btn" data-act="close">닫기</button></div>
    <p>${esc(t.className)} ${t.teamNo}모둠</p>
    <table class="rt"><tr><th>탐구 문제</th><td>${cell('question')}</td></tr><tr><th>자료 수집</th><td>${cell('collect')}<br>${cell('sources')}</td></tr>
    <tr><th>자료 분석</th><td><div class="imgs">${imgs.map(im => T.drawerImgs[im.id] && T.drawerImgs[im.id].url ? `<figure><img src="${T.drawerImgs[im.id].url}"><figcaption>${esc(C.IMG_KIND_LABEL[im.kind] || '')} ${esc(im.caption || '')}</figcaption></figure>` : '').join('')}</div>${cell('analysis')}</td></tr>
    <tr><th>결론</th><td>${cell('conclusion')}</td></tr><tr><th>한계와 제언</th><td>${cell('limits')}</td></tr><tr><th>느낀 점</th><td>${cell('feel')}</td></tr></table></div>`, { wide: true });
}

// ─────────────────────────────── 주제 추첨
function renderLottery() {
  const topics = ((T.pool && T.pool.topics) || []).slice().sort((a, b) => a.no - b.no);
  const assignedAny = T.teams.some(t => t.topic);
  const L = T.lottery;
  let h = `<h1>${esc(T.cls.name)} 주제 추첨</h1>
    <p class="small">규칙: 1지망이 겹치지 않으면 확정, 겹치면 제비뽑기. 떨어진 모둠은 남은 주제에서 2지망 → 3지망 순서로 같은 방법. 그래도 남으면 제비뽑기 순서대로 남은 주제를 골라요(아래에서 직접 바꿀 수 있어요). 한 반에서는 같은 주제를 두 모둠이 맡지 않아요.</p>
    <div class="card"><div class="tscroll"><table class="t"><tr><th>모둠</th><th>1지망(고른 까닭)</th><th>2지망</th><th>3지망</th><th>${L ? '추첨 결과' : '지금 주제'}</th></tr>
    ${T.teams.map(t => { const ch = t.choice || {}; const nm = c => c && T.topicMap[c] ? `${T.topicMap[c].no}. ${esc(T.topicMap[c].short)}` : '-';
      const cur = L ? L.assigned[t.id] : t.topic;
      return `<tr><td><b>${t.teamNo}모둠</b></td><td>${ch.at ? `${nm(ch.c1)}<div class="small muted">${esc(ch.r1 || '')}</div>` : '<span class="muted">미제출</span>'}</td><td>${ch.at ? nm(ch.c2) : ''}</td><td>${ch.at ? nm(ch.c3) : ''}</td>
      <td><select data-assign="${t.id}"><option value="">-</option>${topics.map(x => `<option value="${x.code}" ${cur === x.code ? 'selected' : ''}>${x.no}. ${esc(x.short)}</option>`).join('')}</select></td></tr>`; }).join('')}</table></div>
    <div class="btn-row"><button class="btn" data-act="runLottery">${L ? '다시 추첨하기' : '추첨하기'}</button>
      <button class="btn primary" data-act="publishTopics">${assignedAny ? '바꾼 주제 저장·공개' : '결과 공개'}</button>
      <span class="hint">공개하면 학생 화면에 주제가 나타나요.</span></div>
    ${L ? `<h3>추첨 기록</h3><ol class="small">${L.log.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}</div>`;
  return h;
}
function rnd(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
function runLottery() {
  const topics = ((T.pool && T.pool.topics) || []).map(t => t.code);
  const label = c => T.topicMap[c] ? `${T.topicMap[c].no}. ${T.topicMap[c].short}` : c;
  const log = [], assigned = {}, taken = new Set();
  let remaining = T.teams.slice();
  for (const round of [1, 2, 3]) {
    const groups = {};
    remaining.forEach(t => { const c = t.choice && t.choice.at && t.choice['c' + round]; if (c && !taken.has(c)) (groups[c] = groups[c] || []).push(t); });
    Object.keys(groups).sort((a, b) => (T.topicMap[a] || {}).no - (T.topicMap[b] || {}).no).forEach(code => {
      const ts = groups[code];
      const win = ts.length === 1 ? ts[0] : ts[rnd(ts.length)];
      log.push(ts.length === 1 ? `${round}지망 ${label(code)} → ${win.teamNo}모둠` : `${round}지망 ${label(code)}: ${ts.map(x => x.teamNo + '모둠').join(', ')} 겹침 → 제비뽑기로 ${win.teamNo}모둠`);
      assigned[win.id] = code; taken.add(code);
    });
    remaining = remaining.filter(t => !assigned[t.id]);
  }
  const order = remaining.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = rnd(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  if (order.length) log.push(`3지망까지 정해지지 않은 모둠의 제비뽑기 순서: ${order.map(t => t.teamNo + '모둠').join(' → ')} (이 순서대로 남은 주제를 고르게 하고, 표에서 바꿔 주세요)`);
  order.forEach(t => {
    const left = topics.filter(c => !taken.has(c));
    const pool = left.length ? left : topics;
    const code = pool[rnd(pool.length)];
    assigned[t.id] = code; taken.add(code);
    log.push(`${t.teamNo}모둠 → ${label(code)} (임시)`);
  });
  T.lottery = { assigned, log };
  render();
}

// ─────────────────────────────── 기록·내려받기
let REC = null; // { classId, rows: [...] }
function renderRecords() {
  const loaded = REC && REC.classId === T.clsId;
  let h = `<h1>${esc(T.cls.name)} 기록·내려받기</h1>
    <p class="small">학생별(반·모둠·번호) 기록을 모아 봐요. 이름은 앱에 없으니, 내려받은 뒤 번호와 이름을 맞춰 세특을 써요.</p>
    <div class="btn-row"><button class="btn primary" data-act="loadRecords">${loaded ? '다시 불러오기' : '기록 불러오기'}</button>
    ${loaded ? `<button class="btn" data-act="csv">이 반 CSV 내려받기</button>` : ''}<button class="btn" data-act="csvAll">모든 반 CSV 내려받기</button></div>`;
  if (!loaded) return h + `<p class="muted" style="margin-top:12px">'기록 불러오기'를 누르세요.</p>`;
  h += `<div class="card tight" style="margin-top:12px"><div class="tscroll"><table class="dash"><tr><th>모둠</th><th>번호</th><th>주제</th><th>①</th><th>②</th><th>③</th><th>④</th><th>되돌아보기</th><th>발표 평가</th><th></th></tr>
    ${REC.rows.map((r, i) => `<tr class="clickable" data-act="rec" data-i="${i}"><td>${r.teamNo}모둠</td><td>${r.num}번</td><td>${esc(r.topic)}</td>
      ${['n1', 'n2', 'n3', 'n4', 's6'].map(k => `<td>${r.note[k] && r.note[k].submitted ? '제출' : r.note[k] ? '<span class="muted">씀</span>' : ''}</td>`).join('')}<td>${r.note.s7 ? '씀' : ''}</td><td><button class="btn small">보기</button></td></tr>`).join('')}</table></div></div>`;
  return h;
}
async function loadRecords(classId) {
  const cls = T.classes.find(c => c.id === classId);
  const teams = (await getDocs(query(collection(db, 'teams'), where('classId', '==', classId)))).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.teamNo - b.teamNo);
  const notes = {};
  (await getDocs(query(collection(db, 'notes'), where('classId', '==', classId)))).docs.forEach(d => { notes[d.id] = d.data(); });
  const tdocs = {};
  await Promise.all(teams.map(async t => { const s = await getDoc(doc(db, 'teamdocs', t.id)); tdocs[t.id] = s.exists() ? s.data() : {}; }));
  const rows = [];
  teams.forEach(t => {
    for (let n = 1; n <= t.size; n++) {
      const seat = `${t.id}-${n}`;
      rows.push(recordRow(cls, t, tdocs[t.id], n, notes[seat] || {}, teams, notes));
    }
  });
  return { classId, rows };
}
function j(parts) { return parts.filter(x => x != null && String(x).trim() !== '').join('\n'); }
function recordRow(cls, t, td, n, note, teams, allNotes) {
  const topic = t.topic && T.topicMap[t.topic];
  const k = C.sizeKey(t.size);
  const n1 = note.n1 || {}, n2 = note.n2 || {}, n3 = note.n3 || {}, n4 = note.n4 || {}, s6 = note.s6 || {}, s7 = note.s7 || {};
  const cardName = id => id ? `${id}(${(T.cardMap[id] || {}).title || ''})` : '';
  const cardType = id => { const inf = (T.info.cards || {})[id]; if (!inf) return ''; return inf.topic !== t.topic ? '다른 주제' : inf.role + (inf.role === '함정' ? '·' + inf.trap_type : ''); };
  // 자료 선택 기록(본인)
  const cand = Object.entries(td.cand || {}).filter(([, c]) => c.by === n).map(([id, c]) => `후보 검토 ${id}${c.memo ? ': ' + c.memo : ''}`);
  const req = t.request || {};
  const reqMine = (req.rows || []).filter(r => r.by === n).map(r => `신청 ${r.card}: ${r.reason}`);
  const rejMine = (req.rejected || []).filter(r => r.by === n).map(r => `제외 ${r.card}: ${r.reason}`);
  const rere = t.rerequest ? t.rerequest.rows.map(r => `모둠 재신청 ${r.card}(${r.mode === 'replace' ? r.replaces + '번 대신' : '더하기'}): ${r.reason}`) : [];
  // 역할 과업
  const tasks = C.tasksFor(t.size).filter(tk => C.taskWho(tk, t.size).includes(n));
  const tdone = tasks.map(tk => `${tk.text} ${t.tasks && t.tasks[n] && t.tasks[n][tk.id] ? '완료' : '미완료'}`);
  const imgs = Object.values(t.images || {}).filter(x => x.num === n).map(x => `그림: ${C.IMG_KIND_LABEL[x.kind] || ''}${x.caption ? ' - ' + x.caption : ''}`);
  const by = td.by || {};
  const sents = [1, 2, 3, 4, 5, 6].filter(i => by['analysis-sent-s' + i] === n && td.analysis && td.analysis.sent && td.analysis.sent['s' + i]).map(i => `분석 문장: ${td.analysis.sent['s' + i]}`);
  const edited = Object.entries(by).filter(([p, who]) => who === n).map(([p]) => p);
  const areas = [...new Set(edited.map(p => ({ plan: '탐구 계획서', analysis: '분석 과업표', concl: '모둠 결론', report: '보고서', req: '자료 신청서', rereq: '재신청', checkMemo: '받은 자료 점검', cand: '후보 검토', choice: '주제 신청서' }[p.split('-')[0]] || '')).filter(Boolean))];
  // 받은 동료 평가
  const peers = [];
  for (let m = 1; m <= t.size; m++) {
    if (m === n) continue;
    const pn = (allNotes[`${t.id}-${m}`] || {}).s6;
    const pv = pn && pn.peer && pn.peer[n];
    if (pv && (pv.role || pv.help)) peers.push(`${m}번→ 잘한 점: ${pv.role || ''} / 도움: ${pv.help || ''}`);
  }
  const selfQ = C.SELF_Q.map((q, i) => `${i + 1}. ${(s6.self || {})['q' + (i + 1)] || '-'}`).join(' ');
  const s7lines = Object.entries(s7).filter(([key]) => /^t\d+$/.test(key)).map(([key, v]) => `${key.slice(1)}모둠 — 잘한 점: ${v.good || ''} / 질문: ${v.q || ''}`);
  return {
    teamNo: t.teamNo, num: n, topic: topic ? `${topic.no}. ${topic.short}` : '', note,
    cols: {
      반: cls ? cls.name : t.className, 모둠: t.teamNo, 번호: n, 주제: topic ? `${topic.no}. ${topic.title}` : '',
      '모둠 탐구 문제': (td.plan || {}).main || '',
      '역할(1~4단계)': ['s1', 's2', 's3', 's4'].map((s, i) => `${i + 1}단계: ${C.roleOf(k, s, n)}`).join('\n'),
      '노트① 탐구 문제 설정': j([n1.q && '(1) ' + n1.q, n1.who && '(2) 조사 대상: ' + n1.who, n1.var && '변량: ' + n1.var, n1.cmp && '비교·기준: ' + n1.cmp, n1.can && '답할 수 있나: ' + n1.can, n1.expect && '(3) 예상: ' + n1.expect]),
      '자료 선택 기록(본인)': j([...cand, ...reqMine, ...rejMine, ...rere]),
      '노트② 자료 수집': j([n2.card1 && `(1) ${cardName(n2.card1)}: ${n2.why1 || ''}`, n2.card2 && `(2) ${cardName(n2.card2)}: ${n2.why2 || ''}`, n2.caution && '(3) 주의할 점: ' + n2.caution]),
      '역할 과업(3단계)': j([`맡은 분석: ${C.roleOf(k, 's3', n)}`, ...tdone, ...imgs, ...sents, areas.length ? '직접 고친 모둠 활동지: ' + areas.join(', ') : '']),
      '노트③ 자료 분석': j([n3.rel && '(1) 상대도수: ' + n3.rel, n3.pair && `(2) 짝 과업(${C.pairOf(t.size, n)}번): ` + n3.pair, n3.rep && '(3) 대푯값: ' + n3.rep]),
      '노트④ 결과 해석': j(C.CONCL.map(b => n4[b.k] ? `${b.t}: ${n4[b.k]}` : '')),
      '모둠원에게 받은 평가': j(peers),
      '자기 평가(지도서 259쪽)': (s6.self ? selfQ : ''),
      '새로 알게 된 점': s6.learn || '',
      '다른 모둠 발표 평가(쓴 것)': j(s7lines),
      '모둠이 받은 자료(유형)': (t.released || []).map(id => `${id} ${cardType(id)}${(t.excluded || []).includes(id) ? '(분석 제외)' : ''}`).join(', '),
      '제출 시각': ['n1', 'n2', 'n3', 'n4', 's6'].map(x => note[x] && note[x].submitted ? `${x === 's6' ? '되돌아보기' : '노트' + x[1]} ${fmtTime(note[x].submittedAt)}` : '').filter(Boolean).join(', '),
    },
  };
}
function csvRows(rows) {
  if (!rows.length) return [];
  const heads = Object.keys(rows[0].cols);
  return [heads, ...rows.map(r => heads.map(h => r.cols[h]))];
}
function showRecord(r) {
  modal(`<div class="row between"><h2 style="margin:0">${esc(r.cols.반)} ${r.teamNo}모둠 ${r.num}번</h2><button class="btn" data-act="close">닫기</button></div>
    <div class="rec">${Object.entries(r.cols).slice(3).map(([k, v]) => qa(k, v)).join('')}</div>`, { wide: true });
}

// ─────────────────────────────── 자료 불러오기·반 만들기
async function importPool() {
  const f = $('#poolFile').files[0];
  if (!f) return toast('파일을 골라 주세요.', 'bad');
  let J;
  try { J = JSON.parse(await f.text()); } catch (e) { return toast('JSON 파일을 읽지 못했어요.', 'bad'); }
  if (!J || !Array.isArray(J.cards) || !Array.isArray(J.topics) || !J.cards.every(c => c.public && c.public.id && c.data && c.teacher)) return toast('자료 파일의 모양이 달라요. 받은 파일이 맞는지 확인해 주세요.', 'bad');
  if (!(J.meta && J.meta.version >= 2) || J.cards.some(c => c.data.image && !String(c.data.image).startsWith('data:image/'))) return toast('예전 자료 파일이에요. 함께 받은 새 파일(자료풀_웹앱용.json)을 골라 주세요.', 'bad', 6000);
  if (!(await confirmBox('자료 불러오기', `<p>자료 카드 ${J.cards.length}장, 주제 ${J.topics.length}개를 불러올까요?</p>`, '불러오기'))) return;
  const ops = [];
  ops.push(['set', doc(db, 'pool', 'public'), { meta: J.meta || {}, topics: J.topics, cards: J.cards.map(c => c.public), importedAt: serverTimestamp() }]);
  ops.push(['set', doc(db, 'teacherinfo', 'cards'), { cards: Object.fromEntries(J.cards.map(c => [c.public.id, c.teacher])), importedAt: serverTimestamp() }]);
  // 원자료는 JSON 글자로 저장(표 안의 표를 Firestore가 바로 담지 못하므로)
  J.cards.forEach(c => ops.push(['set', doc(db, 'carddata', c.public.id), { id: c.public.id, json: JSON.stringify(c.data) }]));
  await commitOps(ops);
  await loadPool();
  const s = await getDoc(doc(db, 'teacherinfo', 'cards'));
  T.info = s.exists() ? s.data() : null;
  toast('자료를 불러왔어요.', 'good');
  render();
}
async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(([k, ref, data]) => { if (k === 'set') b.set(ref, data); else if (k === 'update') b.update(ref, data); else b.delete(ref); });
    await b.commit();
  }
}
function allStages(v = 'hidden') { return Object.fromEntries(C.STAGES.map(s => [s.id, v])); }
async function newTeamCode() {
  for (let i = 0; i < 10; i++) {
    const code = randCode(6);
    const s = await getDoc(doc(db, 'teams', code));
    if (!s.exists()) return code;
  }
  throw new Error('코드를 만들지 못했어요.');
}
async function createClass() {
  const name = $('#newName').value.trim();
  const n = parseInt($('#newTeams').value, 10);
  const size = parseInt($('#newSize').value, 10);
  const plan = $('#newPlan').value;
  if (!name) return toast('반 이름을 써 주세요.', 'bad');
  if (!(n >= 1 && n <= 10)) return toast('모둠 수는 1~10이에요.', 'bad');
  if (T.classes.some(c => c.name === name) && !(await confirmBox('같은 이름', `<p>'${esc(name)}' 반이 이미 있어요. 그래도 만들까요?</p>`, '만들기'))) return;
  const classId = doc(collection(db, 'classes')).id;
  const ops = [['set', doc(db, 'classes', classId), { name, plan, period: '', stages: allStages(), helper: false, teamsPublic: {}, createdAt: serverTimestamp() }]];
  for (let i = 1; i <= n; i++) {
    const code = await newTeamCode();
    ops.push(['set', doc(db, 'teams', code), { classId, className: name, teamNo: i, size, topic: null, createdAt: serverTimestamp() }]);
    ops.push(['set', doc(db, 'teamdocs', code), { classId, team: code }]);
  }
  await commitOps(ops);
  T.clsId = classId;
  localStorage.setItem('t:cls', classId);
  $('#newName').value = '';
  toast(`${name}을(를) 만들었어요.`, 'good');
}
async function addTeam() {
  const code = await newTeamCode();
  const no = Math.max(0, ...T.teams.map(t => t.teamNo)) + 1;
  await commitOps([
    ['set', doc(db, 'teams', code), { classId: T.cls.id, className: T.cls.name, teamNo: no, size: 4, topic: null, createdAt: serverTimestamp() }],
    ['set', doc(db, 'teamdocs', code), { classId: T.cls.id, team: code }],
  ]);
}
async function deleteTeams(teamIds, classId) {
  const ops = [];
  for (const id of teamIds) { ops.push(['delete', doc(db, 'teams', id)]); ops.push(['delete', doc(db, 'teamdocs', id)]); }
  const byClass = async col => (await getDocs(query(collection(db, col), where('classId', '==', classId)))).docs;
  for (const col of ['seats', 'notes', 'images', 'members']) {
    (await byClass(col)).forEach(d => { if (teamIds.includes(d.data().team)) ops.push(['delete', d.ref]); });
  }
  await commitOps(ops);
}
function printCodes() {
  const url = studentUrl();
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 막혔어요. 팝업을 허용해 주세요.', 'bad');
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>입장 카드 ${esc(T.cls.name)}</title>
  <style>body{font-family:system-ui,"Malgun Gothic","Noto Sans KR",sans-serif;margin:10mm}.g{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.c{border:1.5px dashed #888;border-radius:4mm;padding:6mm;break-inside:avoid}
  .code{font-size:34pt;font-weight:800;letter-spacing:6px}.s{font-size:10.5pt;line-height:1.6}</style></head><body><div class="g">
  ${T.teams.map(t => `<div class="c"><div><b>${esc(T.cls.name)} ${t.teamNo}모둠</b> (${t.size}명)</div><div class="code">${t.id}</div>
    <div class="s">① 주소: ${esc(url)}<br>② 모둠 입장 코드를 넣고 내 번호를 골라요.<br>③ 비밀번호 숫자 4자리를 정해요(다른 기기에서 다시 들어올 때 필요).<br>※ 이름은 쓰지 않아요. 코드는 우리 모둠만 알아요.</div></div>`).join('')}
  </div><script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}

// ─────────────────────────────── 버튼 동작
document.addEventListener('click', async e => {
  if (e.target.matches && e.target.matches('#drawer .gimg img')) { // 그림 크게 보기
    modal(`<div class="row between"><b>그림</b><button class="btn small" data-act="close">닫기</button></div><img src="${esc(e.target.src)}" style="width:100%;margin-top:8px">`, { wide: true });
    return;
  }
  const g = e.target.closest('[data-go]');
  if (g) { T.view = g.dataset.go; render(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (!ACT[act]) return;
  try { await ACT[act](b, e); }
  catch (err) { console.error(err); toast('문제가 생겼어요: ' + (err.code || err.message), 'bad', 5000); }
});
document.addEventListener('change', async e => {
  const el = e.target;
  try {
    if (el.id === 'planSel') { await updateDoc(doc(db, 'classes', T.cls.id), { plan: el.value, period: '' }); }
    else if (el.dataset.size) { await updateDoc(doc(db, 'teams', el.dataset.size), { size: +el.value }); toast('인원을 바꿨어요.'); }
    else if (el.dataset.act === 'helper') { await updateDoc(doc(db, 'classes', T.cls.id), { helper: el.checked }); }
    else if (el.dataset.assign) {
      if (!T.lottery) T.lottery = { assigned: Object.fromEntries(T.teams.map(t => [t.id, t.topic || ''])), log: [] };
      T.lottery.assigned[el.dataset.assign] = el.value;
    }
  } catch (err) { toast('저장하지 못했어요: ' + (err.code || err.message), 'bad'); }
});
document.addEventListener('toggle', e => { if (e.target && e.target.id === 'stageCtl') T.stageCtlOpen = e.target.open; }, true);
const ACT = {
  async importPool() { await importPool(); },
  async createClass() { await createClass(); },
  async addTeam() { await addTeam(); toast('모둠을 더했어요.', 'good'); },
  async delTeam(b) {
    const t = T.teams.find(x => x.id === b.dataset.id);
    if (!(await confirmBox('모둠 지우기', `<p>${t.teamNo}모둠(${t.id})과 그 모둠의 모든 기록을 지울까요? 되돌릴 수 없어요.</p>`, '지우기'))) return;
    await deleteTeams([t.id], T.cls.id); toast('지웠어요.');
  },
  async delClass() {
    const r = await modal(`<h2>이 반 지우기</h2><p><b>${esc(T.cls.name)}</b>의 모둠, 개인 노트, 그림, 기록을 모두 지워요. 되돌릴 수 없어요. 먼저 CSV를 내려받아 두세요.</p>
      <p>지우려면 반 이름을 똑같이 쓰세요.</p><input type="text" id="delName"><div class="btn-row"><button class="btn red" data-act="ok">지우기</button><button class="btn" data-act="cancel">취소</button></div>`);
    if (r.act !== 'ok' || $('#delName', r.root).value.trim() !== T.cls.name) { if (r.act === 'ok') toast('반 이름이 달라요.', 'bad'); return; }
    const id = T.cls.id;
    await deleteTeams(T.teams.map(t => t.id), id);
    await deleteDoc(doc(db, 'classes', id));
    T.clsId = null; localStorage.removeItem('t:cls'); toast('지웠어요.');
  },
  printCodes() { printCodes(); },
  cardView(b) { cardView(b.dataset.id); },
  async period(b) {
    const plan = C.PLANS[T.cls.plan || '45'];
    const p = plan.periods.find(x => x.key === b.dataset.key);
    if (!(await confirmBox(`${p.label} 시작`, `<p>${esc(p.sub)}</p><p class="small">${C.STAGES.map(s => `${s.tab}: <b>${C.STAGE_STATE_LABEL[p.stages[s.id]]}</b>`).join(' · ')}</p>`, '시작'))) return;
    await updateDoc(doc(db, 'classes', T.cls.id), { stages: p.stages, period: p.key });
    toast(`${p.label}을(를) 시작했어요.`, 'good');
  },
  async stage(b) { await updateDoc(doc(db, 'classes', T.cls.id), { [`stages.${b.dataset.id}`]: b.dataset.v }); },
  helper() { /* change 이벤트에서 처리 */ },
  open(b) { openDrawer(b.dataset.id, b.dataset.tab || 'sum'); },
  closeDrawer() { closeDrawer(); },
  dtab(b) { T.drawerTab = b.dataset.k; renderDrawer(); },
  async planPass(b) { await planDecision(b.dataset.id, 'pass'); },
  async planRevise(b) { await planDecision(b.dataset.id, 'revise'); },
  async sendQ(b) {
    const text = b.dataset.i === 'custom' ? ($('#qCustom') || {}).value || '' : C.QUESTION_CARDS[+b.dataset.i];
    if (!text.trim()) return toast('질문을 써 주세요.', 'bad');
    await updateDoc(doc(db, 'teams', b.dataset.id), { questions: arrayUnion({ text: text.trim(), at: Date.now() }) });
    if ($('#qCustom')) $('#qCustom').value = '';
    toast('질문 카드를 보냈어요.', 'good');
  },
  async freeSeat(b) {
    if (!(await confirmBox('자리 풀기', `<p>${esc(b.dataset.seat)} 자리를 풀까요? 학생은 새 비밀번호로 다시 들어올 수 있고, 쓴 내용은 그대로예요.</p>`, '자리 풀기'))) return;
    const [team, n] = b.dataset.seat.split('-');
    await deleteDoc(doc(db, 'seats', b.dataset.seat));
    await updateDoc(doc(db, 'teams', team), { seatReset: { num: +n, at: Date.now() } });
    toast('자리를 풀었어요.');
  },
  async unlock(b) {
    const { team, n, k } = b.dataset;
    if (!(await confirmBox('잠금 풀기', `<p>${n}번의 ${k === 's6' ? '되돌아보기' : '개인 노트 ' + k[1]}를 다시 고칠 수 있게 할까요?</p>`, '잠금 풀기'))) return;
    await setDoc(doc(db, 'notes', `${team}-${n}`), { [k]: { submitted: false } }, { merge: true });
    await updateDoc(doc(db, 'teams', team), { [`noteStatus.${n}.${k}`]: deleteField() });
    toast('잠금을 풀었어요.');
  },
  goRecords() { closeDrawer(); T.view = 'records'; render(); },
  async present(b) { await present(b.dataset.id); },
  runLottery() { runLottery(); },
  async publishTopics() {
    const a = T.lottery ? T.lottery.assigned : Object.fromEntries(T.teams.map(t => [t.id, t.topic || '']));
    const vals = Object.values(a).filter(Boolean);
    const dup = vals.filter((v, i) => vals.indexOf(v) !== i);
    const missing = T.teams.filter(t => !a[t.id]);
    let warn = '';
    if (missing.length) warn += `<p style="color:var(--bad)">주제가 없는 모둠: ${missing.map(t => t.teamNo + '모둠').join(', ')}</p>`;
    if (dup.length && T.teams.length <= ((T.pool && T.pool.topics) || []).length) warn += `<p style="color:var(--bad)">같은 주제를 맡은 모둠이 있어요.</p>`;
    if (!(await confirmBox('주제 공개', `${warn}<p>학생 화면에 주제를 공개할까요?</p>`, '공개'))) return;
    const ops = T.teams.map(t => ['update', doc(db, 'teams', t.id), { topic: a[t.id] || null }]);
    const tp = {};
    T.teams.forEach(t => { tp[t.teamNo] = { topic: a[t.id] || '' }; });
    ops.push(['update', doc(db, 'classes', T.cls.id), { teamsPublic: tp }]);
    await commitOps(ops);
    T.lottery = null;
    toast('주제를 공개했어요.', 'good');
  },
  async loadRecords() { toast('불러오는 중…'); REC = await loadRecords(T.clsId); render(); },
  rec(b) { showRecord(REC.rows[+b.dataset.i]); },
  csv() { downloadText(`통계프로젝트_기록_${T.cls.name}.csv`, toCSV(csvRows(REC.rows))); },
  async csvAll() {
    toast('모든 반을 불러오는 중…');
    let rows = [];
    for (const c of T.classes) rows = rows.concat((await loadRecords(c.id)).rows);
    downloadText(`통계프로젝트_기록_전체.csv`, toCSV(csvRows(rows)));
  },
  close(b) { const bg = b.closest('.modal-bg'); if (bg) bg.remove(); },
};
async function planDecision(id, state) {
  const t = T.teams.find(x => x.id === id);
  const box = $('#pcComment');
  const comment = T.drawer === id && box ? box.value.trim() : '';
  await updateDoc(doc(db, 'teams', id), { planCheck: { state, comment, at: Date.now(), reqAt: t.planReq ? t.planReq.at : 0 } });
  toast(state === 'pass' ? '통과로 표시했어요.' : '보완을 요청했어요.', 'good');
}
async function cardView(id) {
  const c = T.cardMap[id], inf = T.info.cards[id] || {};
  let data = null;
  try { const s = await getDoc(doc(db, 'carddata', id)); data = s.exists() ? JSON.parse(s.data().json) : null; } catch (e) { data = null; }
  const body = data ? (data.values ? `<p class="small">값 ${data.values.length}개${data.values2 ? ` / ${data.values2.length}개` : ''}</p><div class="values">${data.values.map(v => `<span>${esc(v)}</span>`).join('')}</div>${data.values2 ? `<div class="values" style="margin-top:6px">${data.values2.map(v => `<span>${esc(v)}</span>`).join('')}</div>` : ''}`
    : data.categories ? `<table class="t">${data.categories.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`
    : data.table ? `<table class="t"><tr>${data.table.columns.map(v => `<th>${esc(v)}</th>`).join('')}</tr>${data.table.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`
    : data.image ? `<img src="${esc(data.image)}" style="max-width:100%">` : '') + (data.note ? `<div class="data-note">${esc(data.note)}</div>` : '') : '<p class="muted">원자료 없음</p>';
  const st = inf.stats ? `<p class="small">자료 수 ${inf.stats.n}, 평균 ${inf.stats.mean}, 중앙값 ${inf.stats.median}, 최빈값 ${(inf.stats.modes || []).join(', ') || '없음'}, 가장 작은 값 ${inf.stats.min}, 가장 큰 값 ${inf.stats.max}</p>` : '';
  modal(`<div class="row between"><h2 style="margin:0">자료 ${id} · ${esc(c.title)}</h2><button class="btn" data-act="close">닫기</button></div>
    <p>${roleChip(id)} ${esc(inf.note || '')}</p>${st}<div class="kv small" style="margin-bottom:10px"><div>조사 대상</div><div>${esc(c.target)}</div><div>조사 시기</div><div>${esc(c.period)}</div><div>조사 방법</div><div>${esc(c.method)}</div><div>변량</div><div>${esc(c.variable_text)}</div></div>${body}`, { wide: true });
}
