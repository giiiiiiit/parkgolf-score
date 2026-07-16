'use strict';
import { DB } from './db.js';
import { analyzeCard, getApiKey, setApiKey, hasApiKey } from './gemini.js';

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

function showScreen(name, data = {}) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (screens[name]) screens[name](data);
}

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

screens['new-tournament'] = () => {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('input-tournament-date').value = today;
  document.getElementById('input-tournament-name').value = '';
  document.getElementById('input-tournament-name').focus();
};
document.getElementById('form-new-tournament').onsubmit = async e => {
  e.preventDefault();
  const name = document.getElementById('input-tournament-name').value.trim();
  const date = document.getElementById('input-tournament-date').value;
  if (!name) return;
  await DB.tournament.add({ name, date, par: 132 });
  toast('대회를 만들었습니다');
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
  await renderRoster();
};

async function renderRoster() {
  let all = await DB.participant.getAll();
  if (rosterSort === 'name') all = [...all].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  else all = [...all].sort((a, b) => a.id - b.id);

  const scores = await DB.score.getByTournament(currentTournamentId);
  const attendIds = new Set(scores.map(s => s.participantId));
  const list = document.getElementById('participant-list');

  if (all.length === 0) {
    list.innerHTML = '<p class="empty-msg">참가자를 추가해주세요</p>';
  } else {
    list.innerHTML = all.map(p => {
      const checked = attendIds.has(p.id) ? 'checked' : '';
      return `
        <div class="participant-row" data-id="${p.id}">
          <label class="attend-label">
            <input type="checkbox" class="attend-check" data-id="${p.id}" ${checked}>
            <span class="p-name">${escHtml(p.name)}</span>
            ${genderBadge(p.gender)}
          </label>
          <div class="p-actions">
            <button class="btn-icon btn-edit-p" data-id="${p.id}" title="이름·성별 수정">✏️</button>
            <button class="btn-icon btn-del-p" data-id="${p.id}" title="삭제">🗑</button>
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
  if (attendIds.size > 0) {
    gotoBtn.textContent = `점수 입력하기 (${attendIds.size}명)`;
    gotoBtn.style.display = '';
  } else {
    gotoBtn.style.display = 'none';
  }

  list.querySelectorAll('.attend-check').forEach(cb => {
    cb.onchange = async () => {
      const pid = Number(cb.dataset.id);
      if (cb.checked) {
        const existing = scores.find(s => s.participantId === pid);
        if (!existing) {
          const newScore = { tournamentId: currentTournamentId, participantId: pid, A: null, B: null, C: null, D: null, total: null, source: null };
          const id = await DB.score.add(newScore);
          scores.push({ ...newScore, id });
          attendIds.add(pid);
        }
      } else {
        const existing = scores.find(s => s.participantId === pid);
        if (existing) {
          const ok = await confirm('참석 취소 시 입력된 성적도 삭제됩니다.\n계속할까요?');
          if (!ok) { cb.checked = true; return; }
          await DB.score.delete(existing.id);
          scores.splice(scores.indexOf(existing), 1);
          attendIds.delete(pid);
        }
      }
      const cnt = attendIds.size;
      gotoBtn.textContent = `점수 입력하기 (${cnt}명)`;
      gotoBtn.style.display = cnt > 0 ? '' : 'none';
    };
  });

  // ✏️ 이름·성별 수정
  list.querySelectorAll('.btn-edit-p').forEach(btn => {
    btn.onclick = async () => {
      const pid = Number(btn.dataset.id);
      const p = await DB.participant.get(pid);
      const res = await promptEditParticipant(p.name, p.gender || '미지정');
      if (!res) return;
      if (res.name !== p.name) {
        const all2 = await DB.participant.getAll();
        if (all2.some(x => x.id !== pid && x.name === res.name)) { toast('이미 사용 중인 이름입니다'); return; }
      }
      await DB.participant.update({ ...p, name: res.name, gender: res.gender });
      toast('수정했습니다');
      await renderRoster();
    };
  });

  // 🗑 참가자 삭제 → 해당 대회 점수도 같이 삭제
  list.querySelectorAll('.btn-del-p').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirm('참가자를 명단에서 삭제할까요?\n이 대회의 점수도 삭제됩니다.');
      if (!ok) return;
      const pid = Number(btn.dataset.id);
      // 현재 대회의 점수 삭제
      const existingScore = scores.find(s => s.participantId === pid);
      if (existingScore) await DB.score.delete(existingScore.id);
      // 참가자 삭제
      await DB.participant.delete(pid);
      toast('삭제했습니다');
      await renderRoster();
    };
  });
}

document.getElementById('form-add-participant').onsubmit = async e => {
  e.preventDefault();
  const name = document.getElementById('input-participant-name').value.trim();
  if (!name) return;
  const all = await DB.participant.getAll();
  if (all.some(p => p.name === name)) { toast('이미 등록된 이름입니다'); return; }
  await DB.participant.add({ name, gender: addGender });
  document.getElementById('input-participant-name').value = '';
  toast(`${name}(${addGender}) 추가됨`);
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

async function renderScoreList() {
  const scores = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));
  const container = document.getElementById('score-list-items');

  if (scores.length === 0) {
    container.innerHTML = '<p class="empty-msg">참석자가 없습니다.<br>명단 화면에서 체크해주세요.</p>';
    return;
  }

  container.innerHTML = scores.map(s => {
    const p = pMap[s.participantId];
    if (!p) return '';
    const done = s.A !== null && s.B !== null && s.C !== null && s.D !== null;
    const total = done ? s.A + s.B + s.C + s.D : null;
    return `
      <div class="score-list-card ${done ? 'done' : 'pending'}" data-score-id="${s.id}" data-p-name="${escHtml(p.name)}">
        <div class="slc-info">
          <div class="slc-name">${escHtml(p.name)} ${genderBadge(p.gender)}</div>
          ${done
            ? `<div class="slc-score">${s.A} · ${s.B} · ${s.C} · ${s.D} = <strong>${total}</strong> ${parDiffStr(total)}</div>`
            : `<div class="slc-score pending-label">미입력</div>`}
        </div>
        <span class="slc-badge ${done ? 'badge-done' : 'badge-pending'}">${done ? '완료' : '입력'}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.score-list-card').forEach(card => {
    card.onclick = () => {
      currentScoreId = Number(card.dataset.scoreId);
      currentParticipantName = card.dataset.pName;
      showScreen('score-entry');
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
// 화면 7: 일괄 OCR 입력
// ────────────────────────────────
screens['batch-ocr'] = async ({ players = [] } = {}) => {
  const scores = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));
  const courses = ['A', 'B', 'C', 'D'];

  // 참석자 (점수 레코드 보유자)
  const attendees = scores.map(s => ({
    scoreId: s.id,
    name: pMap[s.participantId]?.name ?? '알 수 없음',
    A: s.A, B: s.B, C: s.C, D: s.D
  }));

  const warnEl = document.getElementById('batch-warn');
  const grid = document.getElementById('batch-grid');

  if (attendees.length === 0) {
    warnEl.className = 'warn-box';
    warnEl.style.display = '';
    warnEl.textContent = '참석자가 없습니다. 명단에서 먼저 체크해주세요.';
    grid.innerHTML = '';
    return;
  }

  // 매칭된 이름 → 타수
  const byName = {};
  for (const p of players) if (p.matched) byName[p.matched] = p;

  // 각 참석자 프리필 (매칭되면 AI 값, 아니면 기존 값)
  let matchedCount = 0;
  const filled = attendees.map(att => {
    const m = byName[att.name];
    if (m) matchedCount++;
    const vals = {};
    for (const c of courses) {
      vals[c] = m && m[c] != null ? m[c] : (att[c] != null ? att[c] : '');
    }
    return { ...att, vals, isMatched: !!m };
  });

  grid.innerHTML = filled.map(att => `
    <div class="batch-row ${att.isMatched ? 'matched' : ''}" data-score-id="${att.scoreId}">
      <div class="batch-name">${escHtml(att.name)}${att.isMatched ? ' <span class="batch-tag">AI 인식</span>' : ''}</div>
      <div class="batch-scores">
        ${courses.map(c => `
          <div class="batch-cell">
            <label class="batch-course-label">${c}</label>
            <input class="batch-score-input" id="batch-${att.scoreId}-${c}" data-sid="${att.scoreId}"
              type="number" inputmode="numeric" min="1" max="99"
              value="${att.vals[c] !== '' ? att.vals[c] : ''}" placeholder="–">
          </div>
        `).join('')}
      </div>
      <div class="batch-total-col">
        <span class="batch-total-label">합계</span>
        <span class="batch-total-val" id="batch-total-${att.scoreId}">–</span>
      </div>
    </div>
  `).join('');

  const updateRowTotal = sid => {
    const vals = courses.map(c => parseInt(document.getElementById(`batch-${sid}-${c}`).value, 10));
    const el = document.getElementById(`batch-total-${sid}`);
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
  grid.querySelectorAll('.batch-score-input').forEach(inp => {
    inp.oninput = () => updateRowTotal(inp.dataset.sid);
    updateRowTotal(inp.dataset.sid);
  });

  // 안내: 매칭 결과 + 매칭 실패한 인식 이름
  const attendeeNameSet = new Set(attendees.map(a => a.name));
  const unmatched = players.filter(p => !p.matched || !attendeeNameSet.has(p.matched));
  const parts = [`참석자 ${attendees.length}명 중 ${matchedCount}명 자동 입력됨.`];
  if (unmatched.length > 0) {
    const raws = unmatched.map(p => p.raw || '?').filter(Boolean).join(', ');
    parts.push(`매칭 실패: ${raws || unmatched.length + '명'} — 해당 칸은 직접 입력하세요.`);
  }
  parts.push('값을 확인 후 수정하고 "모두 저장"을 누르세요.');
  warnEl.className = 'warn-box batch-info';
  warnEl.style.display = '';
  warnEl.innerHTML = parts.map(escHtml).join('<br>');
};

document.getElementById('btn-batch-back').onclick = () => showScreen('score-list');

document.getElementById('btn-batch-save').onclick = async () => {
  const scores = await DB.score.getByTournament(currentTournamentId);
  const courses = ['A','B','C','D'];
  let savedCount = 0;
  let missingCount = 0;

  for (const s of scores) {
    const vals = courses.map(c => parseInt(document.getElementById(`batch-${s.id}-${c}`)?.value, 10));
    if (vals.every(x => !isNaN(x))) {
      const [a,b,c,d] = vals;
      await DB.score.update({ ...s, A:a, B:b, C:c, D:d, total: a+b+c+d });
      savedCount++;
    } else {
      missingCount++;
    }
  }
  toast(`${savedCount}명 저장 완료${missingCount > 0 ? ` (${missingCount}명 미완료)` : ''}`);
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
let rankingTab = '전체';    // '전체' | '남' | '여'
let _lastRanked = [];

screens.ranking = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  document.getElementById('ranking-title').textContent = tournament.name;
  document.getElementById('ranking-date').textContent = formatDate(tournament.date);

  const scores = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));

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

  // 전체 순위 계산 결과를 저장 → 탭 전환 시 재계산 없이 필터만
  _lastRanked = ranked;
  rankingTab = '전체';
  document.querySelectorAll('#rank-tabs .rank-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.g === '전체'));
  renderRankingList();
};

// 현재 탭 기준으로 순위 목록 렌더 (등수는 전체 기준 유지)
function renderRankingList() {
  const container = document.getElementById('ranking-list');
  const list = rankingTab === '전체'
    ? _lastRanked
    : _lastRanked.filter(e => (e.gender || '미지정') === rankingTab);

  if (list.length === 0) {
    container.innerHTML = `<p class="empty-msg">${rankingTab === '전체' ? '입력된 점수가 없습니다.' : '해당 성별의 집계 결과가 없습니다.'}</p>`;
    return;
  }

  container.innerHTML = list.map(e => {
    const diff = e.total - 132;
    const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff <= 0 ? 'under' : 'over';
    const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : '';
    const rankLabel = e.tied ? `${e.rank}위 (공동)` : `${e.rank}위`;
    return `
      <div class="rank-card rank-${Math.min(e.rank, 4)}">
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
  const scores = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));
  const complete = scores.filter(s => s.A !== null && s.B !== null && s.C !== null && s.D !== null);
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
  const header = ['순위','이름','성별','합계','A코스','B코스','C코스','D코스'];
  const rows = ranked.map(e => [e.rank, e.name, e.gender, e.total, e.A, e.B, e.C, e.D]);
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
      return `${e.rank}위 ${e.name}(${e.gender})  ${e.total}타 (${diffStr})  A${e.A}·B${e.B}·C${e.C}·D${e.D}`;
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

showScreen('home');
