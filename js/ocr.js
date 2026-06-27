'use strict';

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let _loadPromise = null;

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

// 단건 인식: 개인 코스 점수 4개 추출 (25~60 범위)
export async function extractScores(imageBlob, onProgress) {
  await loadTesseract();
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100));
    }
  });
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '6',
  });
  const url = URL.createObjectURL(imageBlob);
  try {
    const { data: { text } } = await worker.recognize(url);
    await worker.terminate();
    return parseRange(text, 25, 60);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 전체 카드 인식: 합계표에서 타수 전부 추출
// 카드 읽기 순서(행 우선): A코스 전원 → B코스 전원 → C코스 전원 → D코스 전원
export async function extractBatchScores(imageBlob, onProgress) {
  await loadTesseract();
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100));
    }
  });
  // 숫자 + 공백만 인식 (숫자 구분 목적)
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789 ',
    tessedit_pageseg_mode: '6',
  });
  const url = URL.createObjectURL(imageBlob);
  try {
    const { data: { text } } = await worker.recognize(url);
    await worker.terminate();
    // 개인 코스 타수 범위: 20~60 (합계 132+는 제외됨)
    return parseRange(text, 20, 60);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function parseRange(text, min, max) {
  const nums = [];
  const matches = text.match(/\d+/g) || [];
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n >= min && n <= max) nums.push(n);
  }
  return nums;
}
