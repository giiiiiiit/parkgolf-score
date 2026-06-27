'use strict';

// Service Worker 등록
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

// 기기 감지 및 설치 안내 표시
function detectDeviceAndShowGuide() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  const iosGuide = document.getElementById('ios-guide');
  const androidGuide = document.getElementById('android-guide');
  const desktopGuide = document.getElementById('desktop-guide');

  if (isIOS) {
    iosGuide.style.display = 'block';
  } else if (isAndroid) {
    androidGuide.style.display = 'block';
  } else {
    desktopGuide.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', detectDeviceAndShowGuide);
