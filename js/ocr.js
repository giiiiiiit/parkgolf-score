'use strict';

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

let _worker = null;
let _loading = false;
let _loadPromise = null;

// Tesseract.js를 동적으로 로드 (첫 호출 시 한 번만)
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_CDN;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Tesseract.js 로드 실패. 인터넷 연결을 확인해주세요.'));
    document.head.appendChild(s);
  });
  return _loadPromise;
}

// Worker 초기화 (언어: eng — 숫자 인식)
async function getWorker(onProgress) {
  if (_worker) return _worker;
  await loadTesseract();
  _worker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    }
  });
  // 숫자 인식에 최적화
  await _worker.setParameters({
    tessedit_char_whitelist: '0123456789',
  });
  return _worker;
}

// 이미지에서 파크골프 타수 추출
export async function extractScores(imageBlob, onProgress) {
  const worker = await getWorker(onProgress);
  const url = URL.createObjectURL(imageBlob);
  try {
    const { data: { text } } = await worker.recognize(url);
    return parseScores(text);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 텍스트에서 파크골프 타수 범위(25~55) 숫자 추출
function parseScores(text) {
  const nums = [];
  const matches = text.match(/\d+/g) || [];
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n >= 25 && n <= 55) nums.push(n);
  }
  return nums; // 중복 포함 원본 순서 반환
}
