# ⛳ 파크골프 스코어 집계 앱

수기 스코어 카드를 사진으로 찍어 총타수 기준 순위를 자동 집계하는 PWA 앱입니다.  
아이폰(사파리)과 갤럭시(크롬) 모두 홈 화면에 추가하여 앱처럼 사용할 수 있습니다.

---

## 🤖 사진 자동 입력(AI) 설정 — Gemini API 키

카드 사진 한 장으로 참가자 이름을 자동 매칭하고 점수를 채우는 기능은 **Google Gemini API**를 사용합니다.  
처음 한 번만 무료 API 키를 발급받아 앱에 입력하면 됩니다. (키는 폰에만 저장되고 외부로 전송되지 않습니다.)

1. [Google AI Studio](https://aistudio.google.com/app/apikey) 에 구글 계정으로 로그인
2. **Create API key** (API 키 만들기) 클릭 → 생성된 키(`AIza...`) 복사
3. 앱 오른쪽 위 **⚙️ 설정** 버튼 탭
4. 키를 붙여넣고 **저장**

> 💡 무료 한도는 하루 수백 회 수준이라 동호회 대회 용도로는 충분합니다.  
> 사진 자동 입력에는 인터넷 연결이 필요합니다. (수동 입력은 오프라인에서도 가능)

---

## 📱 폰에서 앱으로 설치하는 방법

### 아이폰 (사파리)

1. **사파리**로 GitHub Pages 주소를 엽니다  
   `https://[내 GitHub 아이디].github.io/parkgolf-score/`
2. 화면 하단 가운데 **공유 버튼 (□↑)** 을 탭합니다
3. 아래로 스크롤하여 **"홈 화면에 추가"** 를 탭합니다
4. 오른쪽 위 **"추가"** 를 탭합니다
5. 홈 화면에 아이콘이 생기면 완료! 탭하여 실행합니다

> ⚠️ 반드시 **사파리**에서 열어야 합니다. 카카오톡·크롬 인앱브라우저에서는 홈 화면에 추가가 안 됩니다.

---

### 갤럭시 (크롬)

1. **크롬**으로 GitHub Pages 주소를 엽니다  
   `https://[내 GitHub 아이디].github.io/parkgolf-score/`
2. 화면 오른쪽 위 **⋮ 메뉴** (점 세 개)를 탭합니다
3. **"앱 설치"** 또는 **"홈 화면에 추가"** 를 탭합니다
4. **"설치"** 를 탭합니다
5. 홈 화면 또는 앱 서랍에서 아이콘을 탭하여 실행합니다

> ⚠️ 반드시 **크롬**에서 열어야 합니다.  
> "앱 설치" 메뉴가 보이지 않으면 "홈 화면에 추가"를 선택하세요.

---

## 🖥️ GitHub Pages 배포 방법

아래 명령어를 **맥북 터미널**에서 순서대로 입력하세요.

### 1단계 — GitHub에 빈 저장소 만들기

1. [github.com](https://github.com) 에 로그인
2. 오른쪽 위 **+** → **New repository**
3. Repository name: `parkgolf-score`
4. **Public** 선택 (GitHub Pages 무료 사용)
5. **Create repository** 클릭

### 2단계 — 터미널에서 업로드

```bash
# 프로젝트 폴더로 이동
cd ~/Project/parkgolf-score

# git 저장소 초기화
git init

# 모든 파일 추가
git add .

# 첫 커밋
git commit -m "1단계: PWA 기본 구조"

# 기본 브랜치를 main으로 설정
git branch -M main

# GitHub 원격 저장소 연결 (아래 [내 아이디] 부분을 본인 GitHub 아이디로 바꾸세요)
git remote add origin https://github.com/[내 GitHub 아이디]/parkgolf-score.git

# GitHub에 올리기
git push -u origin main
```

### 3단계 — GitHub Pages 활성화

1. GitHub에서 `parkgolf-score` 저장소 열기
2. **Settings** 탭 클릭
3. 왼쪽 메뉴에서 **Pages** 클릭
4. Source: **Deploy from a branch**
5. Branch: **main** / `/ (root)` 선택 후 **Save**
6. 1~2분 후 `https://[내 아이디].github.io/parkgolf-score/` 에서 확인

---

## 앞으로 코드를 수정했을 때 업데이트 방법

```bash
cd ~/Project/parkgolf-score
git add .
git commit -m "변경 내용 설명"
git push
```

푸시 후 1~2분 기다리면 GitHub Pages에 자동 반영됩니다.
