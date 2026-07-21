'use strict';
import { DB } from './db.js';
import { analyzeCard, getApiKey, setApiKey, hasApiKey } from './gemini.js';
import { getRoom, setRoom, subscribeRoom, unsubscribeRoom, migrateLegacyIfNeeded } from './firebase.js';

// ── Service Worker ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

// ── 라우터 ──
const screens = {};
let currentTournamentId = null;
let currentScoreId = null;
let currentParticipantName = '';
let currentTeam = null;          // 현재 입력 중인 조 번호 (0 = 미배정)

let currentScreenName = 'home';
function showScreen(name, data = {}) {
  currentScreenName = name;
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (screens[name]) screens[name](data);
}

// 다른 기기에서 변경이 오면 현재 화면만 다시 그림 (입력 중인 화면은 건드리지 않음)
function refreshCurrentScreen() {
  const refreshers = {
    'home': () => screens.home(),
    'roster': () => renderRoster(),
    'score-list': () => renderScoreList(),
    'ranking': () => screens.ranking(),
  };
  const fn = refreshers[currentScreenName];
  if (fn) { try { fn(); } catch {} }
}

// ── 기기 연동(동기화) 모달 ──
document.getElementById('btn-sync').onclick = () => {
  document.getElementById('sync-code').textContent = getRoom();
  document.getElementById('input-sync-code').value = '';
  document.getElementById('modal-sync').classList.add('show');
};
document.getElementById('btn-close-sync').onclick = () =>
  document.getElementById('modal-sync').classList.remove('show');
document.getElementById('btn-copy-code').onclick = async () => {
  try { await navigator.clipboard.writeText(getRoom()); toast('연결 코드를 복사했어요'); }
  catch { toast('복사 실패 — 코드를 직접 적어주세요'); }
};
document.getElementById('btn-join-sync').onclick = async () => {
  const code = document.getElementById('input-sync-code').value.trim();
  if (!code) return;
  const ok = await confirm(`'${code}' 코드의 데이터로 연결할까요?\n이 기기 화면이 그 데이터로 바뀝니다.`);
  if (!ok) return;
  const clean = setRoom(code);
  unsubscribeRoom();
  subscribeRoom(refreshCurrentScreen);
  document.getElementById('modal-sync').classList.remove('show');
  toast(`${clean} 에 연결되었습니다`);
  showScreen('home');
};

// ── 토스트 ──
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ── 확인 다이얼로그 ──
function confirm(msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('modal-confirm');
    document.getElementById('modal-msg').textContent = msg;
    modal.classList.add('show');
    const yes = document.getElementById('modal-yes');
    const no = document.getElementById('modal-no');
    const cleanup = result => {
      modal.classList.remove('show');
      yes.onclick = null; no.onclick = null;
      resolve(result);
    };
    yes.onclick = () => cleanup(true);
    no.onclick = () => cleanup(false);
  });
}

// ── 알림 다이얼로그 (확인 버튼만) ──
function alertBox(msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('modal-confirm');
    document.getElementById('modal-msg').textContent = msg;
    const yes = document.getElementById('modal-yes');
    const no = document.getElementById('modal-no');
    no.style.display = 'none';
    modal.classList.add('show');
    yes.onclick = () => {
      modal.classList.remove('show');
      no.style.display = '';   // confirm() 재사용 위해 복원
      yes.onclick = null;
      resolve();
    };
  });
}

// ── 성별 공통 헬퍼 ──
function setToggleActive(container, g) {
  container.querySelectorAll('.gender-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.g === g));
}
function genderBadge(g) {
  const gg = g || '미지정';
  const cls = gg === '남' ? 'g-m' : gg === '여' ? 'g-f' : 'g-u';
  return `<span class="gender-badge ${cls}">${gg}</span>`;
}

// ── 이름·성별 수정 다이얼로그 ──
let _editResolve = null;
const editToggle = document.getElementById('edit-gender-toggle');
editToggle.querySelectorAll('.gender-opt').forEach(b => {
  b.onclick = () => setToggleActive(editToggle, b.dataset.g);
});
document.getElementById('modal-edit-save').onclick = () => {
  const val = document.getElementById('input-edit-name').value.trim();
  const g = editToggle.querySelector('.gender-opt.active')?.dataset.g || '미지정';
  document.getElementById('modal-edit-name').classList.remove('show');
  if (_editResolve) { _editResolve(val ? { name: val, gender: g } : null); _editResolve = null; }
};
document.getElementById('modal-edit-cancel').onclick = () => {
  document.getElementById('modal-edit-name').classList.remove('show');
  if (_editResolve) { _editResolve(null); _editResolve = null; }
};
document.getElementById('input-edit-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('modal-edit-save').click();
});

function promptEditParticipant(currentName, currentGender) {
  return new Promise(resolve => {
    _editResolve = resolve;
    const inp = document.getElementById('input-edit-name');
    inp.value = currentName;
    setToggleActive(editToggle, currentGender || '미지정');
    document.getElementById('modal-edit-name').classList.add('show');
    setTimeout(() => inp.focus(), 50);
  });
}

// ── 명단 정렬 · 참가자 추가 성별 상태 ──
let rosterSort = 'registered';   // 'registered' | 'name'
let addGender = '남';
const addToggle = document.getElementById('add-gender-toggle');
addToggle.querySelectorAll('.gender-opt').forEach(b => {
  b.onclick = () => { addGender = b.dataset.g; setToggleActive(addToggle, addGender); };
});
document.getElementById('btn-sort-roster').onclick = () => {
  rosterSort = rosterSort === 'registered' ? 'name' : 'registered';
  document.getElementById('btn-sort-roster').textContent =
    rosterSort === 'name' ? '등록순 ↓' : '가나다순 ↓';
  renderRoster();
};

// ── 진행 오버레이 ──
const ocrOverlay = document.getElementById('ocr-overlay');
function showOcrOverlay(msg = '준비 중...') {
  document.getElementById('ocr-status').textContent = msg;
  ocrOverlay.style.display = 'flex';
}
function setOcrStatus(msg) { document.getElementById('ocr-status').textContent = msg; }
function hideOcrOverlay() { ocrOverlay.style.display = 'none'; }

// ── 설정 (Gemini API 키) ──
// [수동 전환] OCR 비활성화로 설정 버튼(#btn-settings) 숨김. 재활성화 시 아래 주석 해제.
/*
function openSettings() {
  document.getElementById('input-api-key').value = getApiKey();
  document.getElementById('modal-settings').classList.add('show');
}
document.getElementById('btn-settings').onclick = openSettings;
document.getElementById('modal-settings-cancel').onclick = () =>
  document.getElementById('modal-settings').classList.remove('show');
document.getElementById('modal-settings-save').onclick = () => {
  const v = document.getElementById('input-api-key').value.trim();
  setApiKey(v);
  document.getElementById('modal-settings').classList.remove('show');
  toast(v ? 'API 키를 저장했습니다' : '키를 비웠습니다');
};
document.getElementById('modal-settings-clear').onclick = () => {
  setApiKey('');
  document.getElementById('input-api-key').value = '';
  toast('저장된 키를 삭제했습니다');
};
*/

// ────────────────────────────────
// 화면 1: 홈
// ────────────────────────────────
screens.home = async () => {
  const list = document.getElementById('tournament-list');
  list.innerHTML = '<p class="loading">불러오는 중...</p>';
  const tournaments = await DB.tournament.getAll();
  tournaments.sort((a, b) => b.date.localeCompare(a.date));
  if (tournaments.length === 0) {
    list.innerHTML = '<p class="empty-msg">등록된 대회가 없습니다.<br>아래 버튼으로 첫 대회를 만들어보세요!</p>';
    return;
  }
  list.innerHTML = tournaments.map(t => `
    <div class="tournament-card" data-id="${t.id}">
      <div class="tc-info">
        <div class="tc-name">${escHtml(t.name)}</div>
        <div class="tc-date">${formatDate(t.date)}</div>
      </div>
      <div class="tc-actions">
        <button class="btn-icon btn-enter" data-id="${t.id}" title="입장">▶</button>
        <button class="btn-icon btn-del" data-id="${t.id}" title="삭제">🗑</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.btn-enter').forEach(btn => {
    btn.onclick = () => { currentTournamentId = Number(btn.dataset.id); showScreen('roster'); };
  });
  list.querySelectorAll('.btn-del').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirm('대회를 삭제할까요?\n관련 성적도 함께 삭제됩니다.');
      if (!ok) return;
      // 해당 대회의 점수도 모두 삭제
      const tid = Number(btn.dataset.id);
      const scores = await DB.score.getByTournament(tid);
      await Promise.all(scores.map(s => DB.score.delete(s.id)));
      await DB.tournament.delete(tid);
      toast('삭제했습니다');
      showScreen('home');
    };
  });
};

document.getElementById('btn-new-tournament').onclick = () => showScreen('new-tournament');

screens['new-tournament'] = async () => {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('input-tournament-date').value = today;
  document.getElementById('input-tournament-name').value = '';

  // 기존 대회 명단 불러오기 목록 채우기
  const sel = document.getElementById('import-roster');
  const tournaments = await DB.tournament.getAll();
  tournaments.sort((a, b) => b.date.localeCompare(a.date));
  sel.innerHTML = '<option value="">불러오지 않음</option>' +
    tournaments.map(t => `<option value="${t.id}">${escHtml(t.name)} (${formatDate(t.date)})</option>`).join('');

  document.getElementById('input-tournament-name').focus();
};
document.getElementById('form-new-tournament').onsubmit = async e => {
  e.preventDefault();
  const name = document.getElementById('input-tournament-name').value.trim();
  const date = document.getElementById('input-tournament-date').value;
  if (!name) return;
  const importId = Number(document.getElementById('import-roster').value) || null;

  const tid = await DB.tournament.add({ name, date, par: 132 });

  // 선택한 대회의 참가자 '이름만' 불러오기 (참석 체크 해제 · 조 빈칸 · 점수 빈칸)
  if (importId) {
    const src = await DB.score.getByTournament(importId);
    const seen = new Set();
    let n = 0;
    for (const s of src) {
      if (seen.has(s.participantId)) continue;
      seen.add(s.participantId);
      await DB.score.add({
        tournamentId: tid, participantId: s.participantId, attend: false, team: null,
        A: null, B: null, C: null, D: null, total: null
      });
      n++;
    }
    toast(`대회 생성 · 명단 ${n}명 불러옴 (참석·조는 직접 선택)`);
  } else {
    toast('대회를 만들었습니다');
  }
  showScreen('home');
};
document.getElementById('btn-cancel-tournament').onclick = () => showScreen('home');

// ────────────────────────────────
// 화면 2: 명단 관리
// ────────────────────────────────
screens.roster = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  document.getElementById('roster-title').textContent = tournament.name;
  document.getElementById('roster-date').textContent = formatDate(tournament.date);
  document.getElementById('input-participant-name').value = '';
  document.getElementById('add-team-select').innerHTML = teamOptionsHtml(lastTeam);
  await renderRoster();
};

const TEAM_MAX = 50;   // 조 선택 최대 개수 (최대 50조 / 약 200명)
let lastTeam = 1;      // 직전 배정 조 (연속 체크 편의)

function teamOptionsHtml(selected) {
  const blank = `<option value="" ${selected == null ? 'selected' : ''}>조 선택</option>`;
  return blank + Array.from({ length: TEAM_MAX }, (_, k) => k + 1)
    .map(n => `<option value="${n}" ${selected === n ? 'selected' : ''}>${n}조</option>`).join('');
}

async function renderRoster() {
  const parts = await DB.participant.getAll();
  const pMap = Object.fromEntries(parts.map(p => [p.id, p]));
  let scores = await DB.score.getByTournament(currentTournamentId);
  // 참가자 정보가 없는 기록(동기화 지연/삭제)은 화면에서만 제외 — 절대 삭제하지 않음(동기화 경합 방지)
  scores = scores.filter(s => pMap[s.participantId]);

  // 이 대회 명단 = 이 대회의 점수 레코드
  let rows = scores.map(s => ({ s, p: pMap[s.participantId] }));
  if (rosterSort === 'name') rows.sort((a, b) => a.p.name.localeCompare(b.p.name, 'ko'));
  else rows.sort((a, b) => a.s.id - b.s.id);

  const list = document.getElementById('participant-list');
  document.getElementById('roster-count-title').textContent = `참가자 명단 (총 ${rows.length}명)`;

  if (rows.length === 0) {
    list.innerHTML = '<p class="empty-msg">아직 참가자가 없습니다.<br>아래에서 추가하거나, 새 대회를 만들 때 명단을 불러오세요.</p>';
  } else {
    list.innerHTML = rows.map(({ s, p }, i) => {
      const attending = s.attend !== false;
      return `
        <div class="participant-row" data-sid="${s.id}">
          <div class="prow-top">
            <span class="p-no">${i + 1}</span>
            <label class="attend-label">
              <input type="checkbox" class="attend-check" data-sid="${s.id}" ${attending ? 'checked' : ''}>
              <span class="p-name">${escHtml(p.name)}</span>
              ${genderBadge(p.gender)}
            </label>
          </div>
          <div class="prow-bottom">
            <select class="team-select" data-sid="${s.id}">${teamOptionsHtml(s.team ?? null)}</select>
            <div class="p-actions">
              <button class="btn-icon btn-edit-p" data-pid="${p.id}" title="이름·성별 수정">✏️</button>
              <button class="btn-icon btn-del-p" data-sid="${s.id}" data-name="${escHtml(p.name)}" title="명단에서 빼기">🗑</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  let gotoBtn = document.getElementById('btn-goto-scores');
  if (!gotoBtn) {
    gotoBtn = document.createElement('button');
    gotoBtn.id = 'btn-goto-scores';
    gotoBtn.className = 'btn btn-primary btn-lg';
    list.parentElement.after(gotoBtn);
  }
  gotoBtn.onclick = () => showScreen('score-list');
  const updateGoto = () => {
    const cnt = scores.filter(s => s.attend !== false).length;
    gotoBtn.textContent = `점수 입력하기 (${cnt}명)`;
    gotoBtn.style.display = cnt > 0 ? '' : 'none';
  };
  updateGoto();

  // 전체 선택 / 해제
  const toggleAllBtn = document.getElementById('btn-toggle-all');
  if (toggleAllBtn) {
    const allOn = scores.length > 0 && scores.every(s => s.attend !== false);
    toggleAllBtn.textContent = allOn ? '전체 해제' : '전체 선택';
    toggleAllBtn.disabled = scores.length === 0;
    toggleAllBtn.onclick = async () => {
      const target = !scores.every(s => s.attend !== false); // 하나라도 꺼져 있으면 전체 켬
      await Promise.all(scores.map(s => { s.attend = target; return DB.score.update(s); }));
      await renderRoster();
    };
  }

  // 참석 체크 토글 (attend 플래그만 변경, 명단에서 제거 아님)
  list.querySelectorAll('.attend-check').forEach(cb => {
    cb.onchange = async () => {
      const sid = Number(cb.dataset.sid);
      const s = scores.find(x => x.id === sid);
      if (!s) return;
      s.attend = cb.checked;
      await DB.score.update(s);
      updateGoto();
    };
  });

  // 조 변경
  list.querySelectorAll('.team-select').forEach(sel => {
    sel.onchange = async () => {
      const sid = Number(sel.dataset.sid);
      const s = scores.find(x => x.id === sid);
      if (!s) return;
      s.team = sel.value === '' ? null : Number(sel.value);
      if (s.team != null) lastTeam = s.team;
      await DB.score.update(s);
    };
  });

  // ✏️ 이름·성별 수정 (전역 참가자 정보)
  list.querySelectorAll('.btn-edit-p').forEach(btn => {
    btn.onclick = async () => {
      const pid = Number(btn.dataset.pid);
      const p = await DB.participant.get(pid);
      const res = await promptEditParticipant(p.name, p.gender || '미지정');
      if (!res) return;
      if (res.name !== p.name) {
        const all2 = await DB.participant.getAll();
        if (all2.some(x => x.id !== pid && x.name === res.name)) { await alertBox('이미 등록된 이름입니다.'); return; }
      }
      await DB.participant.update({ ...p, name: res.name, gender: res.gender });
      toast('수정했습니다');
      await renderRoster();
    };
  });

  // 🗑 명단에서 빼기 (이 대회 기록만 삭제, 다른 대회엔 영향 없음)
  list.querySelectorAll('.btn-del-p').forEach(btn => {
    btn.onclick = async () => {
      const sid = Number(btn.dataset.sid);
      const ok = await confirm(`${btn.dataset.name} 님을 이 대회 명단에서 뺄까요?\n입력한 점수도 함께 삭제됩니다. (다른 대회에는 영향 없음)`);
      if (!ok) return;
      await DB.score.delete(sid);
      const idx = scores.findIndex(x => x.id === sid);
      if (idx >= 0) scores.splice(idx, 1);
      toast('명단에서 뺐습니다');
      await renderRoster();
    };
  });
}

document.getElementById('form-add-participant').onsubmit = async e => {
  e.preventDefault();
  const name = document.getElementById('input-participant-name').value.trim();
  if (!name) return;
  const team = Number(document.getElementById('add-team-select').value) || null;

  const all = await DB.participant.getAll();
  const existingP = all.find(p => p.name === name);
  const scores = await DB.score.getByTournament(currentTournamentId);
  if (existingP && scores.some(s => s.participantId === existingP.id)) {
    await alertBox('이미 이 대회 명단에 있습니다.'); return;
  }
  // 기존 등록자면 재사용, 아니면 새로 등록
  const pid = existingP ? existingP.id : await DB.participant.add({ name, gender: addGender });
  if (team != null) lastTeam = team;
  await DB.score.add({ tournamentId: currentTournamentId, participantId: pid, attend: true, team, A: null, B: null, C: null, D: null, total: null });
  document.getElementById('input-participant-name').value = '';
  toast(`${name} 추가됨${team != null ? ` (${team}조)` : ''}`);
  await renderRoster();
};

document.getElementById('btn-roster-back').onclick = () => showScreen('home');

// ────────────────────────────────
// 화면 3: 점수 목록
// ────────────────────────────────
screens['score-list'] = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  document.getElementById('scorelist-title').textContent = tournament.name;
  document.getElementById('scorelist-date').textContent = formatDate(tournament.date);
  await renderScoreList();
};

function teamLabel(t) { return t === 0 ? '미배정' : `${t}조`; }

async function renderScoreList() {
  const all = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));
  const scores = all.filter(s => s.attend !== false && pMap[s.participantId]);   // 참석자·정상 기록만
  const container = document.getElementById('score-list-items');

  if (scores.length === 0) {
    container.innerHTML = '<p class="empty-msg">참석자가 없습니다.<br>명단 화면에서 참석할 사람을 체크해주세요.</p>';
    return;
  }

  // 조별 그룹핑
  const teams = {};
  for (const s of scores) {
    const t = s.team ?? 0;
    (teams[t] = teams[t] || []).push(s);
  }
  const teamNums = Object.keys(teams).map(Number).sort((a, b) => a - b);

  container.innerHTML = teamNums.map(t => {
    const members = teams[t].slice().sort((a, b) =>
      (pMap[a.participantId]?.name || '').localeCompare(pMap[b.participantId]?.name || '', 'ko'));
    const doneCount = members.filter(s => s.A !== null && s.B !== null && s.C !== null && s.D !== null).length;
    const allDone = doneCount === members.length;
    const names = members.map(s => escHtml(pMap[s.participantId]?.name ?? '?')).join(', ');
    return `
      <div class="score-list-card ${allDone ? 'done' : 'pending'}" data-team="${t}">
        <div class="slc-info">
          <div class="slc-name">${teamLabel(t)} <span class="team-count">${members.length}명</span></div>
          <div class="slc-score">${names}</div>
        </div>
        <span class="slc-badge ${allDone ? 'badge-done' : 'badge-pending'}">${doneCount}/${members.length}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.score-list-card').forEach(card => {
    card.onclick = () => {
      currentTeam = Number(card.dataset.team);
      showScreen('team-entry');
    };
  });
}

document.getElementById('btn-scorelist-back').onclick = () => showScreen('roster');
document.getElementById('btn-goto-ranking').onclick = () => showScreen('ranking');

// ── 일괄 카드 OCR 버튼 (점수목록 화면) ──
// [수동 전환] 카드 사진 인식(OCR) 임시 비활성화 — 수동 입력 사용.
// 재활성화하려면 index.html의 OCR 카드/설정 버튼 주석과 아래 블록을 함께 해제하세요.
/*
document.getElementById('btn-batch-camera').onclick = () => document.getElementById('batch-file-camera').click();
document.getElementById('btn-batch-gallery').onclick = () => document.getElementById('batch-file-gallery').click();
document.getElementById('batch-file-camera').onchange = () => handleBatchOcr(document.getElementById('batch-file-camera'));
document.getElementById('batch-file-gallery').onchange = () => handleBatchOcr(document.getElementById('batch-file-gallery'));

async function handleBatchOcr(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  if (!hasApiKey()) {
    toast('먼저 설정(⚙️)에서 Gemini API 키를 입력해주세요');
    openSettings();
    return;
  }

  // 참석자 명단 확보 (이름 매칭 후보)
  const scores = await DB.score.getByTournament(currentTournamentId);
  if (scores.length === 0) {
    toast('참석자가 없습니다. 명단에서 먼저 체크해주세요.');
    return;
  }
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));
  const attendeeNames = scores.map(s => pMap[s.participantId]?.name).filter(Boolean);

  showOcrOverlay('이미지 준비 중...');
  try {
    const players = await analyzeCard(file, attendeeNames, msg => setOcrStatus(msg));
    hideOcrOverlay();
    if (players.length === 0) {
      toast('카드에서 선수를 인식하지 못했습니다. 더 밝고 정면으로 촬영해보세요.');
      return;
    }
    showScreen('batch-ocr', { players });
  } catch (err) {
    hideOcrOverlay();
    toast(err.message || '분석 오류가 발생했습니다.');
  }
}
*/

// ────────────────────────────────
// 화면 7: 조별 점수 입력 (일괄 그리드)
// ────────────────────────────────
async function getTeamMembers() {
  const scores = await DB.score.getByTournament(currentTournamentId);
  const parts = await DB.participant.getAll();
  const pMap = Object.fromEntries(parts.map(p => [p.id, p]));
  const members = scores.filter(s => s.attend !== false && (s.team ?? 0) === currentTeam);
  members.sort((a, b) =>
    (pMap[a.participantId]?.name || '').localeCompare(pMap[b.participantId]?.name || '', 'ko'));
  return { members, pMap };
}

screens['team-entry'] = async () => {
  const courses = ['A', 'B', 'C', 'D'];
  const { members, pMap } = await getTeamMembers();
  document.getElementById('team-entry-title').textContent = `${teamLabel(currentTeam)} 점수 입력`;

  const grid = document.getElementById('team-grid');
  grid.innerHTML = members.map(s => {
    const p = pMap[s.participantId];
    return `
      <div class="batch-row" data-score-id="${s.id}">
        <div class="batch-name">${escHtml(p?.name ?? '?')} ${genderBadge(p?.gender)}</div>
        <div class="batch-scores">
          ${courses.map(c => `
            <div class="batch-cell">
              <label class="batch-course-label">${c}</label>
              <input class="batch-score-input score-adv" id="team-${s.id}-${c}" data-sid="${s.id}"
                type="number" inputmode="numeric" min="1" max="99"
                value="${s[c] !== null ? s[c] : ''}" placeholder="–">
            </div>
          `).join('')}
        </div>
        <div class="batch-total-col">
          <span class="batch-total-label">합계</span>
          <span class="batch-total-val" id="team-total-${s.id}">–</span>
        </div>
      </div>
    `;
  }).join('');

  const updateRowTotal = sid => {
    const vals = courses.map(c => parseInt(document.getElementById(`team-${sid}-${c}`).value, 10));
    const el = document.getElementById(`team-total-${sid}`);
    if (vals.every(x => !isNaN(x))) {
      const t = vals.reduce((a, b) => a + b, 0);
      const diff = t - 132;
      const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
      el.textContent = `${t} (${diffStr})`;
      el.className = 'batch-total-val ' + (diff <= 0 ? 'under' : 'over');
    } else {
      el.textContent = '–';
      el.className = 'batch-total-val';
    }
  };

  // 합계 갱신 + 2자리 입력 시 다음 칸 자동 이동
  const inputs = [...grid.querySelectorAll('.score-adv')];
  inputs.forEach((inp, idx) => {
    inp.oninput = () => {
      if (inp.value.length > 2) inp.value = inp.value.slice(0, 2);   // 2자리 초과 입력 차단
      updateRowTotal(inp.dataset.sid);
      if (inp.value.length >= 2 && idx < inputs.length - 1) inputs[idx + 1].focus();
    };
    updateRowTotal(inp.dataset.sid);
  });
  if (inputs.length) inputs[0].focus();
};

document.getElementById('btn-team-back').onclick = () => showScreen('score-list');

document.getElementById('btn-team-save').onclick = async () => {
  const courses = ['A', 'B', 'C', 'D'];
  const { members } = await getTeamMembers();
  let saved = 0, missing = 0;
  for (const s of members) {
    const vals = courses.map(c => parseInt(document.getElementById(`team-${s.id}-${c}`)?.value, 10));
    if (vals.every(x => !isNaN(x))) {
      const [a, b, c, d] = vals;
      await DB.score.update({ ...s, A: a, B: b, C: c, D: d, total: a + b + c + d });
      saved++;
    } else {
      missing++;
    }
  }
  toast(`${saved}명 저장${missing > 0 ? ` · ${missing}명 미완료` : ''}`);
  showScreen('score-list');
};

// ────────────────────────────────
// 화면 4: 점수 입력 (개인)
// ────────────────────────────────
screens['score-entry'] = async () => {
  document.getElementById('entry-name').textContent = currentParticipantName;
  const score = await DB.score.get(currentScoreId);
  const inputs = { A: document.getElementById('score-A'), B: document.getElementById('score-B'),
                   C: document.getElementById('score-C'), D: document.getElementById('score-D') };
  for (const k of ['A','B','C','D']) {
    inputs[k].value = score[k] !== null ? score[k] : '';
  }
  updateTotalDisplay();
  for (const inp of Object.values(inputs)) { inp.oninput = updateTotalDisplay; }
};

function getInputVals() {
  return ['A','B','C','D'].map(k => {
    const v = parseInt(document.getElementById('score-' + k).value, 10);
    return isNaN(v) ? null : v;
  });
}

function updateTotalDisplay() {
  const [a, b, c, d] = getInputVals();
  const totalEl = document.getElementById('score-total-display');
  const diffEl = document.getElementById('score-par-diff');
  if (a !== null && b !== null && c !== null && d !== null) {
    const total = a + b + c + d;
    totalEl.textContent = total;
    diffEl.textContent = parDiffStr(total);
    diffEl.className = 'par-diff ' + (total <= 132 ? 'under' : 'over');
  } else {
    totalEl.textContent = '–';
    diffEl.textContent = '';
  }
}

document.getElementById('btn-save-score').onclick = async () => {
  const [a, b, c, d] = getInputVals();
  if (a === null || b === null || c === null || d === null) {
    toast('A·B·C·D 코스를 모두 입력해주세요'); return;
  }
  const total = a + b + c + d;
  const score = await DB.score.get(currentScoreId);
  await DB.score.update({ ...score, A: a, B: b, C: c, D: d, total });
  toast('저장했습니다');
  showScreen('score-list');
};

document.getElementById('btn-clear-score').onclick = async () => {
  const ok = await confirm('입력값을 초기화할까요?');
  if (!ok) return;
  for (const k of ['A','B','C','D']) document.getElementById('score-' + k).value = '';
  updateTotalDisplay();
};

document.getElementById('btn-entry-back').onclick = () => showScreen('score-list');

// ────────────────────────────────
// 화면 5: 순위 집계
// ────────────────────────────────
let rankingTab = '전체';    // '전체' | '남' | '여' | '팀'
let _lastRanked = [];
let _teamRanked = [];

screens.ranking = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  document.getElementById('ranking-title').textContent = tournament.name;
  document.getElementById('ranking-date').textContent = formatDate(tournament.date);

  const rawScores = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));
  const scores = rawScores.filter(s => s.attend !== false && pMap[s.participantId]);

  const complete = scores.filter(s => s.A !== null && s.B !== null && s.C !== null && s.D !== null);
  const incomplete = scores.length - complete.length;
  document.getElementById('ranking-incomplete-warn').style.display = incomplete > 0 ? '' : 'none';

  const entries = complete.map(s => ({
    name: pMap[s.participantId]?.name ?? '알 수 없음',
    gender: pMap[s.participantId]?.gender || '미지정',
    total: s.A + s.B + s.C + s.D, A: s.A, B: s.B, C: s.C, D: s.D
  }));

  entries.sort((a, b) => {
    if (a.total !== b.total) return a.total - b.total;
    if (a.D !== b.D) return a.D - b.D;
    if (a.C !== b.C) return a.C - b.C;
    if (a.B !== b.B) return a.B - b.B;
    return a.A - b.A;
  });

  const ranked = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i === 0) { ranked.push({ ...e, rank: 1, tied: false }); continue; }
    const prev = entries[i - 1];
    const sameTie = e.total === prev.total && e.D === prev.D && e.C === prev.C && e.B === prev.B && e.A === prev.A;
    ranked.push({ ...e, rank: sameTie ? ranked[i - 1].rank : i + 1, tied: sameTie });
  }

  // 팀(조) 합산 순위 — 조원 전원 완료된 조만 집계 (미배정 제외)
  const teamAttend = {};
  for (const s of scores) { const t = s.team ?? 0; if (t !== 0) teamAttend[t] = (teamAttend[t] || 0) + 1; }
  const teamAgg = {};
  for (const s of complete) {
    const t = s.team ?? 0;
    if (t === 0) continue;
    const g = teamAgg[t] = teamAgg[t] || { team: t, total: 0, count: 0, members: [] };
    g.total += s.A + s.B + s.C + s.D;
    g.count++;
    g.members.push({ name: pMap[s.participantId]?.name ?? '?', gender: pMap[s.participantId]?.gender || '미지정' });
  }
  const teams = Object.values(teamAgg).filter(g => g.count === teamAttend[g.team]);
  teams.sort((a, b) => a.total - b.total);
  let trank = 1;
  _teamRanked = teams.map((g, i, arr) => {
    if (i > 0 && g.total !== arr[i - 1].total) trank = i + 1;
    return { ...g, rank: trank, tied: i > 0 && arr[i - 1].total === g.total };
  });

  // 전체 순위 계산 결과를 저장 → 탭 전환 시 재계산 없이 필터만
  _lastRanked = ranked;
  rankingTab = '전체';
  document.querySelectorAll('#rank-tabs .rank-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.g === '전체'));
  renderRankingList();
};

// 팀 합산 순위 렌더
function renderTeamRanking() {
  const container = document.getElementById('ranking-list');
  if (_teamRanked.length === 0) {
    container.innerHTML = '<p class="empty-msg">조원 전원 입력이 끝난 조가 없습니다.</p>';
    return;
  }
  container.innerHTML = _teamRanked.map(g => {
    const par = 132 * g.count;
    const diff = g.total - par;
    const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff <= 0 ? 'under' : 'over';
    const medal = g.rank === 1 ? '🥇' : g.rank === 2 ? '🥈' : g.rank === 3 ? '🥉' : '';
    const rankLabel = g.tied ? `${g.rank}위 (공동)` : `${g.rank}위`;
    return `
      <div class="rank-card rank-${Math.min(g.rank, 4)}">
        <div class="rank-medal">${medal || g.rank}</div>
        <div class="rank-info">
          <div class="rank-name">${g.team}조 <span class="team-count">${g.count}명</span></div>
          <div class="rank-courses team-members">${g.members.map(m => `${escHtml(m.name)}${genderBadge(m.gender)}`).join(' · ')}</div>
          <div class="rank-label-text">${rankLabel} · 팀 PAR ${par}</div>
        </div>
        <div class="rank-total">
          <span class="rank-total-num">${g.total}</span>
          <span class="par-diff ${diffClass}">${diffStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

// 현재 탭 기준으로 순위 목록 렌더 (등수는 전체 기준 유지)
function renderRankingList() {
  if (rankingTab === '팀') { renderTeamRanking(); return; }
  const container = document.getElementById('ranking-list');
  const list = rankingTab === '전체'
    ? _lastRanked
    : _lastRanked.filter(e => (e.gender || '미지정') === rankingTab);

  if (list.length === 0) {
    container.innerHTML = `<p class="empty-msg">${rankingTab === '전체' ? '입력된 점수가 없습니다.' : '해당 성별의 집계 결과가 없습니다.'}</p>`;
    return;
  }

  const showOrder = rankingTab === '남' || rankingTab === '여';
  container.innerHTML = list.map((e, i) => {
    const diff = e.total - 132;
    const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff <= 0 ? 'under' : 'over';
    const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : '';
    const rankLabel = e.tied ? `${e.rank}위 (공동)` : `${e.rank}위`;
    return `
      <div class="rank-card rank-${Math.min(e.rank, 4)}">
        ${showOrder ? `<div class="rank-order">${i + 1}</div>` : ''}
        <div class="rank-medal">${medal || e.rank}</div>
        <div class="rank-info">
          <div class="rank-name">${escHtml(e.name)} ${genderBadge(e.gender)}</div>
          <div class="rank-courses">A ${e.A} · B ${e.B} · C ${e.C} · D ${e.D}</div>
          <div class="rank-label-text">${rankLabel}</div>
        </div>
        <div class="rank-total">
          <span class="rank-total-num">${e.total}</span>
          <span class="par-diff ${diffClass}">${diffStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

document.querySelectorAll('#rank-tabs .rank-tab').forEach(tab => {
  tab.onclick = () => {
    rankingTab = tab.dataset.g;
    document.querySelectorAll('#rank-tabs .rank-tab').forEach(t => t.classList.toggle('active', t === tab));
    renderRankingList();
  };
});

document.getElementById('btn-ranking-back').onclick = () => showScreen('score-list');

// ── 내보내기 공통 ──
async function getRankedEntries() {
  const rawScores = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));
  const scores = rawScores.filter(s => s.attend !== false && pMap[s.participantId]);
  const complete = scores.filter(s => s.A !== null && s.B !== null && s.C !== null && s.D !== null);
  const entries = complete.map(s => ({
    name: pMap[s.participantId]?.name ?? '알 수 없음',
    gender: pMap[s.participantId]?.gender || '미지정',
    team: (s.team ?? 0) === 0 ? '미배정' : `${s.team}조`,
    total: s.A + s.B + s.C + s.D, A: s.A, B: s.B, C: s.C, D: s.D
  }));
  entries.sort((a, b) => {
    if (a.total !== b.total) return a.total - b.total;
    if (a.D !== b.D) return a.D - b.D;
    if (a.C !== b.C) return a.C - b.C;
    if (a.B !== b.B) return a.B - b.B;
    return a.A - b.A;
  });
  let rank = 1;
  return entries.map((e, i, arr) => {
    if (i > 0) {
      const p = arr[i - 1];
      if (!(e.total === p.total && e.D === p.D && e.C === p.C && e.B === p.B && e.A === p.A)) rank = i + 1;
    }
    return { ...e, rank };
  });
}

document.getElementById('btn-export-csv').onclick = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  const ranked = await getRankedEntries();
  if (ranked.length === 0) { toast('집계된 점수가 없습니다'); return; }
  const BOM = '﻿';
  const header = ['순위','이름','성별','조','합계','A코스','B코스','C코스','D코스'];
  const rows = ranked.map(e => [e.rank, e.name, e.gender, e.team, e.total, e.A, e.B, e.C, e.D]);
  const csv = BOM + [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${tournament.name.replace(/[^\w가-힣]/g,'_')}_순위.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('CSV 저장 완료');
};

document.getElementById('btn-share').onclick = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  const ranked = await getRankedEntries();
  if (ranked.length === 0) { toast('집계된 점수가 없습니다'); return; }
  const lines = [
    `⛳ ${tournament.name} 순위 결과`, `📅 ${formatDate(tournament.date)}`, `PAR 132`, '',
    ...ranked.map(e => {
      const diff = e.total - 132;
      const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
      return `${e.rank}위 ${e.name}(${e.gender}/${e.team})  ${e.total}타 (${diffStr})  A${e.A}·B${e.B}·C${e.C}·D${e.D}`;
    })
  ];
  const text = lines.join('\n');
  if (navigator.share) {
    try { await navigator.share({ title: tournament.name + ' 순위', text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('클립보드에 복사됐습니다'); }
  catch { toast('공유 기능을 지원하지 않는 환경입니다'); }
};

// ────────────────────────────────
// 유틸
// ────────────────────────────────
function parDiffStr(total) {
  const diff = total - 132;
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

// ── 시작: 로컬 데이터 이관 → 실시간 구독 → 홈 ──
// (유령 기록은 삭제하지 않고 각 화면에서 표시만 제외 — 동기화 경합으로 인한 데이터 손실 방지)
(async () => {
  try { await migrateLegacyIfNeeded(); } catch (e) { console.warn('migrate', e); }
  subscribeRoom(refreshCurrentScreen);
  showScreen('home');
})();
