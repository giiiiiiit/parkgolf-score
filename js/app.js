'use strict';
import { DB } from './db.js';

// ── Service Worker ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

// ── 라우터 ──
const screens = {};
let currentTournamentId = null;
let currentScoreId = null;      // 현재 편집 중인 score 레코드 id
let currentParticipantName = '';

function showScreen(name, data = {}) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (screens[name]) screens[name](data);
}

// ── 토스트 메시지 ──
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

// ────────────────────────────────
// 화면 1: 홈 (대회 목록)
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
    btn.onclick = () => {
      currentTournamentId = Number(btn.dataset.id);
      showScreen('roster');
    };
  });

  list.querySelectorAll('.btn-del').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirm('대회를 삭제할까요?\n관련 성적도 함께 삭제됩니다.');
      if (!ok) return;
      await DB.tournament.delete(Number(btn.dataset.id));
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
  const all = await DB.participant.getAll();
  const scores = await DB.score.getByTournament(currentTournamentId);
  const attendIds = new Set(scores.map(s => s.participantId));

  const list = document.getElementById('participant-list');
  if (all.length === 0) {
    list.innerHTML = '<p class="empty-msg">참가자를 추가해주세요</p>';
    return;
  }

  list.innerHTML = all.map(p => {
    const checked = attendIds.has(p.id) ? 'checked' : '';
    return `
      <div class="participant-row" data-id="${p.id}">
        <label class="attend-label">
          <input type="checkbox" class="attend-check" data-id="${p.id}" ${checked}>
          <span class="p-name">${escHtml(p.name)}</span>
        </label>
        <button class="btn-icon btn-del-p" data-id="${p.id}" title="삭제">🗑</button>
      </div>
    `;
  }).join('');

  // 참석자가 1명 이상이면 점수 입력 버튼 표시
  const attendCount = attendIds.size;
  let gotoBtn = document.getElementById('btn-goto-scores');
  if (!gotoBtn) {
    gotoBtn = document.createElement('button');
    gotoBtn.id = 'btn-goto-scores';
    gotoBtn.className = 'btn btn-primary btn-lg';
    list.parentElement.after(gotoBtn);
  }
  gotoBtn.onclick = () => showScreen('score-list');
  if (attendCount > 0) {
    gotoBtn.textContent = `점수 입력하기 (${attendCount}명)`;
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
          const newScore = {
            tournamentId: currentTournamentId,
            participantId: pid,
            A: null, B: null, C: null, D: null,
            total: null, source: null, imageRef: null
          };
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
      // 버튼 카운트 갱신
      const cnt = attendIds.size;
      if (cnt > 0) {
        gotoBtn.textContent = `점수 입력하기 (${cnt}명)`;
        gotoBtn.style.display = '';
      } else {
        gotoBtn.style.display = 'none';
      }
    };
  });

  list.querySelectorAll('.btn-del-p').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirm('참가자를 명단에서 삭제할까요?');
      if (!ok) return;
      await DB.participant.delete(Number(btn.dataset.id));
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
  if (all.some(p => p.name === name)) {
    toast('이미 등록된 이름입니다');
    return;
  }
  await DB.participant.add({ name });
  document.getElementById('input-participant-name').value = '';
  toast(`${name} 추가됨`);
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
    const diffStr = done ? parDiffStr(total) : '';
    return `
      <div class="score-list-card ${done ? 'done' : 'pending'}" data-score-id="${s.id}" data-p-name="${escHtml(p.name)}">
        <div class="slc-info">
          <div class="slc-name">${escHtml(p.name)}</div>
          ${done
            ? `<div class="slc-score">${s.A} · ${s.B} · ${s.C} · ${s.D} = <strong>${total}</strong> ${diffStr}</div>`
            : `<div class="slc-score pending-label">미입력</div>`
          }
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

// ────────────────────────────────
// 화면 4: 점수 입력
// ────────────────────────────────
screens['score-entry'] = async () => {
  document.getElementById('entry-name').textContent = currentParticipantName;
  const score = await DB.score.get(currentScoreId);

  const inputs = { A: document.getElementById('score-A'), B: document.getElementById('score-B'),
                   C: document.getElementById('score-C'), D: document.getElementById('score-D') };

  // 기존 값 복원
  for (const k of ['A','B','C','D']) {
    inputs[k].value = score[k] !== null ? score[k] : '';
  }
  document.getElementById('score-mismatch-warn').style.display = 'none';
  updateTotalDisplay();

  // 입력할 때마다 합계 갱신
  for (const inp of Object.values(inputs)) {
    inp.oninput = updateTotalDisplay;
  }
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
    toast('A·B·C·D 코스를 모두 입력해주세요');
    return;
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
screens.ranking = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  document.getElementById('ranking-title').textContent = tournament.name;
  document.getElementById('ranking-date').textContent = formatDate(tournament.date);

  const scores = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));

  // 완료된 점수만 집계, 미완료는 경고
  const complete = scores.filter(s => s.A !== null && s.B !== null && s.C !== null && s.D !== null);
  const incomplete = scores.length - complete.length;

  const warnEl = document.getElementById('ranking-incomplete-warn');
  warnEl.style.display = incomplete > 0 ? '' : 'none';

  // 순위 정렬: 총타수 오름차순, 동점 시 D→C→B→A 백카운트
  const entries = complete.map(s => ({
    name: pMap[s.participantId]?.name ?? '알 수 없음',
    total: s.A + s.B + s.C + s.D,
    A: s.A, B: s.B, C: s.C, D: s.D
  }));

  entries.sort((a, b) => {
    if (a.total !== b.total) return a.total - b.total;
    if (a.D !== b.D) return a.D - b.D;
    if (a.C !== b.C) return a.C - b.C;
    if (a.B !== b.B) return a.B - b.B;
    return a.A - b.A;
  });

  // 공동 순위 계산
  const ranked = entries.map((e, i, arr) => {
    if (i === 0) return { ...e, rank: 1, tied: false };
    const prev = arr[i - 1];
    const sameTie = e.total === prev.total && e.D === prev.D && e.C === prev.C && e.B === prev.B && e.A === prev.A;
    const prevRank = ranked[i - 1].rank;
    return { ...e, rank: sameTie ? prevRank : i + 1, tied: sameTie };
  });

  const container = document.getElementById('ranking-list');

  if (ranked.length === 0) {
    container.innerHTML = '<p class="empty-msg">입력된 점수가 없습니다.</p>';
    return;
  }

  container.innerHTML = ranked.map(e => {
    const diff = e.total - 132;
    const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff <= 0 ? 'under' : 'over';
    const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : '';
    const rankLabel = e.tied ? `${e.rank}위 (공동)` : `${e.rank}위`;
    return `
      <div class="rank-card rank-${Math.min(e.rank, 4)}">
        <div class="rank-medal">${medal || e.rank}</div>
        <div class="rank-info">
          <div class="rank-name">${escHtml(e.name)}</div>
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
};

document.getElementById('btn-ranking-back').onclick = () => showScreen('score-list');

// ── 내보내기 공통: 현재 순위 데이터 수집 ──
async function getRankedEntries() {
  const scores = await DB.score.getByTournament(currentTournamentId);
  const allParticipants = await DB.participant.getAll();
  const pMap = Object.fromEntries(allParticipants.map(p => [p.id, p]));
  const complete = scores.filter(s => s.A !== null && s.B !== null && s.C !== null && s.D !== null);
  const entries = complete.map(s => ({
    name: pMap[s.participantId]?.name ?? '알 수 없음',
    total: s.A + s.B + s.C + s.D,
    A: s.A, B: s.B, C: s.C, D: s.D
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
      const tied = e.total === p.total && e.D === p.D && e.C === p.C && e.B === p.B && e.A === p.A;
      if (!tied) rank = i + 1;
    }
    return { ...e, rank };
  });
}

// ── CSV 내보내기 ──
document.getElementById('btn-export-csv').onclick = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  const ranked = await getRankedEntries();
  if (ranked.length === 0) { toast('집계된 점수가 없습니다'); return; }

  const BOM = '﻿'; // 엑셀 한글 깨짐 방지
  const header = ['순위', '이름', '합계', 'A코스', 'B코스', 'C코스', 'D코스'];
  const rows = ranked.map(e => [e.rank, e.name, e.total, e.A, e.B, e.C, e.D]);
  const csv = BOM + [header, ...rows].map(r => r.join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = tournament.name.replace(/[^\w가-힣]/g, '_');
  a.href = url;
  a.download = `${safeName}_순위.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV 저장 완료');
};

// ── 결과 공유 ──
document.getElementById('btn-share').onclick = async () => {
  const tournament = await DB.tournament.get(currentTournamentId);
  const ranked = await getRankedEntries();
  if (ranked.length === 0) { toast('집계된 점수가 없습니다'); return; }

  const lines = [
    `⛳ ${tournament.name} 순위 결과`,
    `📅 ${formatDate(tournament.date)}`,
    `PAR 132`,
    '',
    ...ranked.map(e => {
      const diff = e.total - 132;
      const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
      return `${e.rank}위 ${e.name}  ${e.total}타 (${diffStr})  A${e.A}·B${e.B}·C${e.C}·D${e.D}`;
    })
  ];
  const text = lines.join('\n');

  if (navigator.share) {
    try {
      await navigator.share({ title: tournament.name + ' 순위', text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // 사용자가 취소
    }
  }
  // 폴백: 클립보드 복사
  try {
    await navigator.clipboard.writeText(text);
    toast('클립보드에 복사됐습니다');
  } catch {
    toast('공유 기능을 지원하지 않는 환경입니다');
  }
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
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

// DB에 score.get 추가 (단건 조회)
// db.js의 score.get은 tx 래퍼로 처리
// ── 시작 ──
showScreen('home');
