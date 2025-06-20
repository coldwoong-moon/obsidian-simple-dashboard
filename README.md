# Simple Dashboard

이 플러그인은 옵시디언에서 데일리, 위클리, 월간 노트와 외부 캘린더의 정보를 간단한 대시보드 형태로 보여줍니다. Obsidian 1.9 버전에서 도입된 **Bases** 기능을 활용해 원하는 날짜의 노트 목록을 가져오며, 사용자 지정 버튼을 통해 새 노트나 데일리 노트를 손쉽게 생성할 수 있습니다.

## 주요 기능

- 아이콘이나 명령으로 대시보드 뷰 열기
- 설정한 폴더에 새 노트 또는 데일리 노트 생성
- Bases 기능을 이용한 날짜별 노트 목록 표시(지원되지 않을 경우 기본 검색 사용)
- iCloud, Google 등에서 제공하는 ICS 주소를 입력해 일정 표시 가능

## 설정 방법

플러그인 설정에서 기본 노트 폴더, 데일리 노트 폴더, 캘린더 ICS URL을 입력할 수 있습니다. 여러 주소는 쉼표로 구분합니다.

## 개발 및 빌드

이 플러그인은 [Build a plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin) 튜토리얼의 구조를 따릅니다. 안전한 개발을 위해 별도의 테스트 볼트를 만들고 아래 명령으로 의존성을 설치한 후 빌드를 실행하세요.

```bash
npm install
npm run dev
```

빌드가 완료되면 `main.js`, `manifest.json`, `styles.css` 파일을 볼트의 `.obsidian/plugins/simple-dashboard` 폴더에 복사해 사용할 수 있습니다.
