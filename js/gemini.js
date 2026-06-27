'use strict';

// 사용 모델 (무료 티어). 필요 시 'gemini-2.0-flash' 등으로 변경 가능.
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const KEY_STORAGE = 'parkgolf_gemini_key';

// ── API 키 관리 (localStorage) ──
export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}
export function setApiKey(key) {
  const k = (key || '').trim();
  if (k) localStorage.setItem(KEY_STORAGE, k);
  else localStorage.removeItem(KEY_STORAGE);
}
export function hasApiKey() {
  return !!getApiKey();
}

// ── 이미지 축소 후 base64(JPEG) 반환 ──
async function fileToBase64(file, maxSize = 1600) {
  const img = await loadImage(file);
  let { width, height } = img;
  if (Math.max(width, height) > maxSize) {
    const scale = maxSize / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.split(',')[1]; // base64 본문만
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다.')); };
    img.src = url;
  });
}

// ── 카드 분석: 참석자 명단 기반 이름 매칭 + 코스 타수 추출 ──
// 반환: [{ raw, matched, A, B, C, D }]
export async function analyzeCard(file, participantNames, onStatus) {
  const key = getApiKey();
  if (!key) throw new Error('Gemini API 키가 설정되어 있지 않습니다. 설정에서 키를 입력해주세요.');

  if (onStatus) onStatus('이미지 준비 중...');
  const base64 = await fileToBase64(file);

  if (onStatus) onStatus('AI 분석 중... (수 초 걸릴 수 있어요)');
  const body = {
    contents: [{
      parts: [
        { text: buildPrompt(participantNames) },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json'
    }
  };

  let res;
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('네트워크 오류. 인터넷 연결을 확인해주세요.');
  }

  if (!res.ok) {
    let msg = `API 오류 (${res.status})`;
    try { const e = await res.json(); if (e.error?.message) msg = e.error.message; } catch {}
    if (res.status === 400 || res.status === 403) msg = 'API 키가 올바르지 않거나 권한이 없습니다. 설정에서 키를 다시 확인해주세요.';
    else if (res.status === 429) msg = '사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
    throw new Error(msg);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('AI가 결과를 반환하지 않았습니다. 다시 시도해주세요.');

  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('결과 형식 오류. 다시 시도해주세요.'); }

  const players = Array.isArray(parsed.players) ? parsed.players : [];
  return players.map(p => ({
    raw: p.raw_name ?? p.name ?? '',
    matched: p.matched ?? null,
    A: toScore(p.A), B: toScore(p.B), C: toScore(p.C), D: toScore(p.D)
  }));
}

function toScore(v) {
  const n = parseInt(v, 10);
  return (!isNaN(n) && n >= 1 && n <= 99) ? n : null;
}

function buildPrompt(names) {
  return [
    '이 이미지는 파크골프 합계표(스코어 카드)입니다.',
    '표의 각 열(세로 칸)은 한 명의 선수이며, 행은 위에서부터 A코스, B코스, C코스, D코스의 타수입니다.',
    '맨 아래 "합계" 행은 이미 더한 값이므로 무시하세요.',
    '',
    '등록된 참가자 명단:',
    (names.length ? names.map(n => `- ${n}`).join('\n') : '- (없음)'),
    '',
    '각 선수에 대해 다음을 수행하세요:',
    '1. 손글씨 이름을 읽고, 위 명단에서 가장 비슷한 이름을 matched에 적으세요. 확신이 없으면 matched는 null로 두세요.',
    '2. A, B, C, D 코스의 타수를 정수로 읽으세요 (보통 25~55). 읽을 수 없으면 null.',
    '',
    '반드시 아래 JSON 형식으로만 답하세요:',
    '{"players":[{"raw_name":"읽은이름","matched":"명단의이름또는null","A":39,"B":36,"C":42,"D":33}]}'
  ].join('\n');
}
