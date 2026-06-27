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

// ── 새 대회 폼 ──
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

  list.querySelectorAll('.attend-check').forEach(cb => {
    cb.onchange = async () => {
      const pid = Number(cb.dataset.id);
      if (cb.checked) {
        const existing = scores.find(s => s.participantId === pid);
        if (!existing) {
          await DB.score.add({
            tournamentId: currentTournamentId,
            participantId: pid,
            A: null, B: null, C: null, D: null,
            total: null, source: null, imageRef: null
          });
          scores.push({ participantId: pid });
        }
      } else {
        const existing = scores.find(s => s.participantId === pid);
        if (existing) {
          const ok = await confirm('참석 취소 시 입력된 성적도 삭제됩니다.\n계속할까요?');
          if (!ok) { cb.checked = true; return; }
          await DB.score.delete(existing.id);
          scores.splice(scores.indexOf(existing), 1);
        }
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
// 유틸
// ────────────────────────────────
function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

// ── 시작 ──
showScreen('home');
