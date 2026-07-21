'use strict';

const DB_NAME = 'parkgolf';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // 대회
      if (!db.objectStoreNames.contains('tournaments')) {
        const ts = db.createObjectStore('tournaments', { keyPath: 'id', autoIncrement: true });
        ts.createIndex('date', 'date');
      }
      // 참가자
      if (!db.objectStoreNames.contains('participants')) {
        const ps = db.createObjectStore('participants', { keyPath: 'id', autoIncrement: true });
        ps.createIndex('name', 'name');
      }
      // 성적
      if (!db.objectStoreNames.contains('scores')) {
        const ss = db.createObjectStore('scores', { keyPath: 'id', autoIncrement: true });
        ss.createIndex('tournamentId', 'tournamentId');
        ss.createIndex('participantId', 'participantId');
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// ── 대회 ──
export const DB = {
  tournament: {
    add: data => tx('tournaments', 'readwrite', s => s.add({ ...data, createdAt: Date.now() })),
    getAll: () => tx('tournaments', 'readonly', s => s.getAll()),
    get: id => tx('tournaments', 'readonly', s => s.get(id)),
    update: data => tx('tournaments', 'readwrite', s => s.put(data)),
    delete: id => tx('tournaments', 'readwrite', s => s.delete(id)),
  },
  participant: {
    add: data => tx('participants', 'readwrite', s => s.add({ ...data })),
    getAll: () => tx('participants', 'readonly', s => s.getAll()),
    get: id => tx('participants', 'readonly', s => s.get(id)),
    update: data => tx('participants', 'readwrite', s => s.put(data)),
    delete: id => tx('participants', 'readwrite', s => s.delete(id)),
  },
  score: {
    add: data => tx('scores', 'readwrite', s => s.add(data)),
    get: id => tx('scores', 'readonly', s => s.get(id)),
    getAll: () => tx('scores', 'readonly', s => s.getAll()),
    getByTournament: tournamentId => openDB().then(db => new Promise((resolve, reject) => {
      const t = db.transaction('scores', 'readonly');
      const idx = t.objectStore('scores').index('tournamentId');
      const req = idx.getAll(tournamentId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })),
    update: data => tx('scores', 'readwrite', s => s.put(data)),
    delete: id => tx('scores', 'readwrite', s => s.delete(id)),
  }
};
