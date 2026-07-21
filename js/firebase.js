'use strict';
// Firebase(Firestore) 실시간 동기화 모듈
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyD-MTYVxqeOgPPwgW47gsVz0ItOiw7WPQQ",
  authDomain: "parkgolf-4c191.firebaseapp.com",
  projectId: "parkgolf-4c191",
  storageBucket: "parkgolf-4c191.firebasestorage.app",
  messagingSenderId: "382391214140",
  appId: "1:382391214140:web:e30da433ec64d802602339"
};

const app = initializeApp(firebaseConfig);

// 오프라인 저장 + 여러 탭 동시 지원
export const fs = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// ── 연결 코드(room) 관리 ──
const ROOM_KEY = 'parkgolf_room';
function randomRoom() {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += s[Math.floor(Math.random() * s.length)];
  return 'pg-' + c;
}
export function getRoom() {
  let r = localStorage.getItem(ROOM_KEY);
  if (!r) { r = randomRoom(); localStorage.setItem(ROOM_KEY, r); }
  return r;
}
export function setRoom(code) {
  const clean = String(code).trim().replace(/[^\w-]/g, '');
  if (clean) localStorage.setItem(ROOM_KEY, clean);
  return clean;
}

// ── 컬렉션/문서 참조 (항상 현재 room 기준) ──
export function col(name) { return collection(fs, 'rooms', getRoom(), name); }
export function ref(name, id) { return doc(fs, 'rooms', getRoom(), name, String(id)); }

// ── 실시간 구독: 원격 변경 시 콜백 (로컬 쓰기는 무시, 디바운스) ──
let _unsub = [];
export function subscribeRoom(onRemoteChange) {
  unsubscribeRoom();
  let timer = null;
  // 변경 감지 시 (내 쓰기·원격 쓰기 모두) 디바운스하여 현재 화면 갱신.
  // 내 쓰기는 이미 로컬에서 렌더되므로 재렌더는 idempotent.
  const handler = () => {
    clearTimeout(timer);
    timer = setTimeout(onRemoteChange, 300);
  };
  for (const name of ['tournaments', 'participants', 'scores']) {
    _unsub.push(onSnapshot(col(name), handler));
  }
}
export function unsubscribeRoom() {
  _unsub.forEach(u => { try { u(); } catch {} });
  _unsub = [];
}

// ── 기존 로컬(IndexedDB) 데이터를 최초 1회 클라우드로 이관 ──
export async function migrateLegacyIfNeeded() {
  if (localStorage.getItem('parkgolf_migrated_v1')) return;
  const legacy = await readLegacy();
  if (legacy) {
    const map = { tournaments: legacy.tournaments, participants: legacy.participants, scores: legacy.scores };
    let count = 0;
    for (const [name, arr] of Object.entries(map)) {
      for (const item of (arr || [])) {
        if (item && item.id != null) { await setDoc(ref(name, item.id), item); count++; }
      }
    }
    if (count) console.log(`[sync] 로컬 데이터 ${count}건 클라우드로 이관`);
  }
  localStorage.setItem('parkgolf_migrated_v1', '1');
}

function readLegacy() {
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open('parkgolf'); } catch { return resolve(null); }
    req.onerror = () => resolve(null);
    req.onsuccess = e => {
      const db = e.target.result;
      const names = ['tournaments', 'participants', 'scores'];
      if (!names.every(n => db.objectStoreNames.contains(n))) { db.close(); return resolve(null); }
      const out = {};
      let done = 0;
      const tx = db.transaction(names, 'readonly');
      names.forEach(n => {
        const rq = tx.objectStore(n).getAll();
        rq.onsuccess = () => { out[n] = rq.result || []; if (++done === 3) { db.close(); resolve(out); } };
        rq.onerror = () => { out[n] = []; if (++done === 3) { db.close(); resolve(out); } };
      });
    };
  });
}
