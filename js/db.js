'use strict';
// Firestore 기반 저장소 — 기존 IndexedDB와 동일한 DB.* API 유지
import { col, ref } from './firebase.js';
import {
  getDoc, getDocs, setDoc, deleteDoc, query, where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// 숫자 ID 생성 (기존 앱이 숫자 id를 기대함, 기기 간 충돌 사실상 없음)
function genId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

async function addItem(name, data) {
  const id = genId();
  await setDoc(ref(name, id), { ...data, id });
  return id;
}
async function getItem(name, id) {
  const s = await getDoc(ref(name, id));
  return s.exists() ? s.data() : undefined;
}
async function getAllItems(name) {
  const s = await getDocs(col(name));
  return s.docs.map(d => d.data());
}
async function updateItem(name, data) {
  await setDoc(ref(name, data.id), data);   // 전체 문서 교체
}
async function deleteItem(name, id) {
  await deleteDoc(ref(name, id));
}
async function scoresByTournament(tournamentId) {
  const s = await getDocs(query(col('scores'), where('tournamentId', '==', tournamentId)));
  return s.docs.map(d => d.data());
}

export const DB = {
  tournament: {
    add: d => addItem('tournaments', d),
    getAll: () => getAllItems('tournaments'),
    get: id => getItem('tournaments', id),
    update: d => updateItem('tournaments', d),
    delete: id => deleteItem('tournaments', id),
  },
  participant: {
    add: d => addItem('participants', d),
    getAll: () => getAllItems('participants'),
    get: id => getItem('participants', id),
    update: d => updateItem('participants', d),
    delete: id => deleteItem('participants', id),
  },
  score: {
    add: d => addItem('scores', d),
    get: id => getItem('scores', id),
    getAll: () => getAllItems('scores'),
    getByTournament: scoresByTournament,
    update: d => updateItem('scores', d),
    delete: id => deleteItem('scores', id),
  }
};
