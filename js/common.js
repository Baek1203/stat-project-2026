// 학생·교사 화면이 함께 쓰는 설정과 문구

export const STAGES = [
  { id: 's0', tab: '주제 고르기', title: '주제 고르기', color: 's0' },
  { id: 's1', tab: '1 탐구 문제', title: '1단계 · 탐구 문제 설정', color: 's1' },
  { id: 's2', tab: '2 자료 수집', title: '2단계 · 자료 수집', color: 's2' },
  { id: 's3', tab: '3 자료 분석', title: '3단계 · 자료 분석', color: 's3' },
  { id: 's4', tab: '4 결과 해석', title: '4단계 · 결과 해석', color: 's4' },
  { id: 's5', tab: '보고서', title: '보고서 완성', color: 's5' },
  { id: 's6', tab: '되돌아보기', title: '과정 되돌아보기', color: 's6' },
  { id: 's7', tab: '발표', title: '발표 듣고 평가하기', color: 's7' },
];
export const STAGE_BY_ID = Object.fromEntries(STAGES.map(s => [s.id, s]));
export const STAGE_STATE_LABEL = { hidden: '닫힘', open: '열림', done: '보기만' };

// 차시 안: 차시마다 어떤 단계를 열고(open) 어떤 단계를 보기만(done) 하게 할지
const ALL = STAGES.map(s => s.id);
function preset(open, done) {
  const st = {};
  ALL.forEach(id => { st[id] = open.includes(id) ? 'open' : done.includes(id) ? 'done' : 'hidden'; });
  return st;
}
export const PLANS = {
  '45': {
    name: '4~5차시 안',
    desc: '사전 10분 + 4차시(보고서까지) + 5차시(선택: 캔바 슬라이드·발표)',
    periods: [
      { key: 'pre', label: '사전 10분', sub: '주제 지망 → 추첨', stages: preset(['s0'], []) },
      { key: 'p1', label: '1차시', sub: '탐구 문제 설정', stages: preset(['s1'], ['s0']) },
      { key: 'p2', label: '2차시', sub: '자료 수집', stages: preset(['s2'], ['s0', 's1']) },
      { key: 'p3', label: '3차시', sub: '자료 분석', stages: preset(['s3'], ['s0', 's1', 's2']) },
      { key: 'p4', label: '4차시', sub: '결과 해석·보고서·되돌아보기', stages: preset(['s4', 's5', 's6'], ['s0', 's1', 's2', 's3']) },
      { key: 'p5', label: '5차시(선택)', sub: '캔바 슬라이드·발표', stages: preset(['s5', 's6', 's7'], ['s0', 's1', 's2', 's3', 's4']) },
    ],
  },
  '6': {
    name: '6차시 안',
    desc: '사전 10분 + 6차시(분석과 슬라이드·발표에 시간을 더 씀)',
    periods: [
      { key: 'pre', label: '사전 10분', sub: '주제 지망 → 추첨', stages: preset(['s0'], []) },
      { key: 'p1', label: '1차시', sub: '탐구 문제 설정', stages: preset(['s1'], ['s0']) },
      { key: 'p2', label: '2차시', sub: '자료 수집', stages: preset(['s2'], ['s0', 's1']) },
      { key: 'p3', label: '3차시', sub: '자료 분석(역할별 과업)', stages: preset(['s3'], ['s0', 's1', 's2']) },
      { key: 'p4', label: '4차시', sub: '분석 공유·노트 ③ → 개인 결론(노트 ④)', stages: preset(['s3', 's4'], ['s0', 's1', 's2']) },
      { key: 'p5', label: '5차시', sub: '모둠 결론·보고서 → 캔바 슬라이드', stages: preset(['s4', 's5'], ['s0', 's1', 's2', 's3']) },
      { key: 'p6', label: '6차시', sub: '발표·되돌아보기', stages: preset(['s6', 's7'], ['s0', 's1', 's2', 's3', 's4', 's5']) },
    ],
  },
};

// 역할(모둠 인원별). 번호는 교사가 정해 준 1~5번.
export const ROLES = {
  4: {
    s1: { 1: '진행 · 탐구 문제 문장 다듬기', 2: '기록 · 탐구 계획서 쓰기', 3: '점검 · 통계적 탐구 문제 체크리스트 확인', 4: '확인 · 선생님 확인 받기, 필요한 자료 계획 정리' },
    s2: { 1: '기준·보조 자료 후보 검토', 2: '진행 · 자료 신청서 쓰기, 재신청 판단', 3: '핵심 자료 후보 검토', 4: '핵심 자료 후보 검토(3번과 나누어)' },
    s3: { 1: '집단 1의 도수분포표와 히스토그램(또는 도수분포다각형)', 2: '집단 2의 도수분포표와 히스토그램(또는 도수분포다각형)', 3: '진행 · 두 집단의 상대도수 분포표와 그래프(한 좌표평면), 모둠 공유 이끌기', 4: '대푯값(평균·중앙값·최빈값), 기준 비율, 보조 자료 그래프' },
    s4: { 1: "보고서의 '자료 분석' 정리", 2: "보고서의 '결론·한계' 정리", 3: "발표 준비, '느낀 점' 정리", 4: '진행 · 모둠 결론 합의 이끌기' },
  },
  3: {
    s1: { 1: '진행 · 탐구 문제 문장 다듬기', 2: '기록 · 탐구 계획서 쓰기', 3: '점검·확인 · 체크리스트 확인, 선생님 확인 받기' },
    s2: { 1: '기준·보조 자료 후보 검토', 2: '진행 · 자료 신청서 쓰기, 재신청 판단', 3: '핵심 자료 후보 검토' },
    s3: { 1: '집단 1의 도수분포표와 그래프, 대푯값(평균·중앙값·최빈값)', 2: '집단 2의 도수분포표와 그래프, 기준 비율, 보조 자료 그래프', 3: '진행 · 두 집단의 상대도수 분포표와 그래프(한 좌표평면), 모둠 공유 이끌기' },
    s4: { 1: "진행 · 모둠 결론 합의 이끌기, 보고서의 '자료 분석' 정리", 2: "보고서의 '결론·한계' 정리", 3: "발표 준비, '느낀 점' 정리" },
  },
  5: {
    s1: { 1: '진행 · 탐구 문제 문장 다듬기', 2: '기록 · 탐구 계획서 쓰기', 3: '점검 · 통계적 탐구 문제 체크리스트 확인', 4: '확인 · 선생님 확인 받기, 필요한 자료 계획 정리', 5: '예상 결과와 그 까닭 정리' },
    s2: { 1: '기준·보조 자료 후보 검토', 2: '진행 · 자료 신청서 쓰기, 재신청 판단', 3: '핵심 자료 후보 검토', 4: '핵심 자료 후보 검토(3번과 나누어)', 5: '기준·보조 자료 후보 검토(1번과 나누어)' },
    s3: { 1: '집단 1의 도수분포표와 히스토그램(또는 도수분포다각형)', 2: '집단 2의 도수분포표와 히스토그램(또는 도수분포다각형)', 3: '진행 · 두 집단의 상대도수 분포표와 그래프(한 좌표평면), 모둠 공유 이끌기', 4: '대푯값(평균·중앙값·최빈값), 기준 비율', 5: '보조 자료 그래프, 분석 결과 문장 정리' },
    s4: { 1: "보고서의 '자료 분석' 정리", 2: "보고서의 '결론·한계' 정리", 3: "발표 준비, '느낀 점' 정리", 4: '진행 · 모둠 결론 합의 이끌기', 5: '슬라이드 구성안 정리' },
  },
};
export function roleOf(size, stage, num) {
  const r = ROLES[size] || ROLES[4];
  return (r[stage] && r[stage][num]) || '';
}
export function sizeKey(size) { return size <= 3 ? 3 : size >= 5 ? 5 : 4; }

// 선생님께 탐구 계획서 확인을 요청하는 번호, 보고서 '느낀 점'을 정리하는 번호
export const CHECKER = { 3: 3, 4: 4, 5: 4 };
export const FEEL_WRITER = 3;

// 개인 노트 ③ 짝 과업: 내가 맡지 않은 분석 하나
export const PAIRS = { 3: { 1: 3, 2: 1, 3: 2 }, 4: { 1: 3, 2: 4, 3: 1, 4: 2 }, 5: { 1: 3, 2: 4, 3: 1, 4: 2, 5: 3 } };
export function pairOf(size, num) { return (PAIRS[sizeKey(size)] || PAIRS[4])[num] || null; }

// 3단계 분석 과업
export const TASKS = {
  4: [
    { id: 't1', text: '두 집단의 도수분포표', who: [1, 2] },
    { id: 't2', text: '히스토그램 또는 도수분포다각형', who: [1, 2] },
    { id: 't3', text: '상대도수의 분포표와 그래프(두 집단을 한 좌표평면에)', who: [3] },
    { id: 't4', text: '평균·중앙값·최빈값', who: [4] },
    { id: 't5', text: '기준 비율, 보조 자료 그래프', who: [4] },
    { id: 't6', text: '분석 결과 문장 3개 이상', who: 'all' },
  ],
  3: [
    { id: 't1', text: '두 집단의 도수분포표', who: [1, 2] },
    { id: 't2', text: '히스토그램 또는 도수분포다각형', who: [1, 2] },
    { id: 't3', text: '상대도수의 분포표와 그래프(두 집단을 한 좌표평면에)', who: [3] },
    { id: 't4', text: '평균·중앙값·최빈값', who: [1] },
    { id: 't5', text: '기준 비율, 보조 자료 그래프', who: [2] },
    { id: 't6', text: '분석 결과 문장 3개 이상', who: 'all' },
  ],
  5: [
    { id: 't1', text: '두 집단의 도수분포표', who: [1, 2] },
    { id: 't2', text: '히스토그램 또는 도수분포다각형', who: [1, 2] },
    { id: 't3', text: '상대도수의 분포표와 그래프(두 집단을 한 좌표평면에)', who: [3] },
    { id: 't4', text: '평균·중앙값·최빈값', who: [4] },
    { id: 't5', text: '기준 비율', who: [4] },
    { id: 't7', text: '보조 자료 그래프', who: [5] },
    { id: 't6', text: '분석 결과 문장 3개 이상', who: 'all' },
  ],
};
export function tasksFor(size) { return TASKS[sizeKey(size)]; }
export function taskWho(task, size) { return task.who === 'all' ? Array.from({ length: size }, (_, i) => i + 1) : task.who; }

// 올린 그림의 종류
export const IMG_KINDS = [
  { id: 'g1', label: '집단 1의 표·그래프' },
  { id: 'g2', label: '집단 2의 표·그래프' },
  { id: 'rel', label: '상대도수의 분포표·그래프' },
  { id: 'rep', label: '대푯값·기준 비율' },
  { id: 'sup', label: '보조 자료 그래프' },
  { id: 'etc', label: '그 밖의 표·그래프' },
];
export const IMG_KIND_LABEL = Object.fromEntries(IMG_KINDS.map(k => [k.id, k.label]));
export const DEFAULT_IMG_KIND = { 3: { 1: 'g1', 2: 'g2', 3: 'rel' }, 4: { 1: 'g1', 2: 'g2', 3: 'rel', 4: 'rep' }, 5: { 1: 'g1', 2: 'g2', 3: 'rel', 4: 'rep', 5: 'sup' } };
export const MAX_IMAGES_PER_TEAM = 12;

// 탐구 계획서 체크리스트
export const PLAN_CHECK = [
  '조사 대상이 분명하다',
  '수량으로 조사할 변량과 단위가 분명하다',
  '비교할 두 집단 또는 판단 기준이 분명하다',
  '자료를 모아서 답할 수 있는 질문이다',
];

// 결론 쓰기 틀(개인 노트 ④, 모둠 결론)
export const CONCL = [
  { k: 'c1', t: '① 답', h: '탐구 문제에 대한 답(한 문장)' },
  { k: 'c2', t: '② 근거 1', h: '그래프의 위치·모양 또는 상대도수(수치 포함)' },
  { k: 'c3', t: '③ 근거 2', h: '대푯값 또는 기준을 넘는(못 미치는) 비율(수치 포함)' },
  { k: 'c4', t: '④ 예상과 비교', h: '예상과 같았나요, 달랐나요? 다르다면 보조 자료에서 까닭을 찾아보세요.' },
  { k: 'c5', t: '⑤ 한계', h: '결론을 그대로 믿기 어려운 점(조사 대상, 자료 수, 기간, 조사 방법)' },
  { k: 'c6', t: '⑥ 제언', h: '실천 방안 또는 새로 생긴 탐구 문제' },
];
export const INTERPRET_TIP = "자료가 말하는 것보다 크게 말하지 않기 · 두 집단의 차이를 곧바로 원인이라고 단정하지 않기('~와 관련이 있어 보인다') · 비율의 차이는 '%p'로 쓸 수 있음 · 예상과 다른 결과도 훌륭한 결론!";

// 자기 평가(지도서 259쪽)
export const SELF_Q = [
  '흥미로운 통계적 탐구 문제를 설정하였는가?',
  '탐구 문제에 적합한 자료를 수집하였는가?',
  '자료를 탐구 목적에 맞게 분석하였는가?',
  '분석한 결과를 탐구 문제와 연결하여 해석하였는가?',
  '통계적 문제해결 과정에 주도적으로 참여하였는가?',
];
export const SELF_SCALE = ['잘함', '보통', '노력 필요'];

// 교사 질문 카드(미리 만든 것)
export const QUESTION_CARDS = [
  '이 자료의 조사 대상은 너희 탐구 문제의 대상과 같니?',
  '이 자료는 언제, 어떤 조건에서 조사했니?',
  '이 자료의 변량은 너희가 재려는 것과 같니?',
];

// 개인 노트 제목과 '좋은 답의 모습'
export const NOTES = {
  n1: { stage: 's1', title: '개인 탐구 노트 ① 탐구 문제 설정', good: '조사 대상, 변량(단위), 비교할 두 집단이나 판단 기준이 분명하고, 자료로 답할 수 있는 질문이에요. 예상과 그 까닭이 있어요.' },
  n2: { stage: 's2', title: '개인 탐구 노트 ② 자료 수집', good: '고른 자료가 알맞은 까닭을 대상·시기·방법·변량 가운데 두 가지 이상으로 설명하고, 맞지 않는 자료의 문제를 정확히 짚으며, 분석할 때 주의할 점을 자료에서 찾아 써요.' },
  n3: { stage: 's3', title: '개인 탐구 노트 ③ 자료 분석', good: '상대도수로 비교하는 까닭과 알맞은 대푯값을 자료의 특징과 연결해 설명하고, 모둠원의 분석 결과도 수치와 함께 해석해요.' },
  n4: { stage: 's4', title: '개인 탐구 노트 ④ 결과 해석(나의 결론)', good: '탐구 문제에 답하는 결론을 수치가 있는 근거 두 가지 이상으로 뒷받침하고, 예상과 비교하며, 한계와 제언을 써요.' },
};
export const NOTE_KEYS = ['n1', 'n2', 'n3', 'n4'];

export const REQ = { firstMax: 4, rejectedMin: 2, reMax: 2, releasedMax: 6 };
export const FIT_HINT = '대상 · 시기 · 조건 · 방법 · 변량 · 자료 수 · 출처가 탐구 문제와 맞는지 확인!';

export const DOMAINS = ['건강·생활습관', '학교 환경', '환경·기후', '소비·기술'];

// 자료 출처 문장(보고서)
export function sourceText(card) {
  if (!card) return '';
  return card.real
    ? `자료 ${card.id}번(${card.provider}, 실제 기준)`
    : `자료 ${card.id}번(가상 자료)`;
}
