# 종소리와 재 — 피클 해석판

90년대 PC-98 풍 오리지널 웹 JRPG. 브라우저에서 바로 플레이합니다.

- 게임: https://xploride.github.io/bells-and-ashes/
- 외부 라이브러리·외부 음원 없이 HTML5 Canvas + Web Audio로 동작 (음악은 실시간 합성)
- 폴백 폰트: Galmuri11 (SIL Open Font License 1.1, © Lee Minseo / quiple)

## 구조

```
index.html          게임 진입점 (GitHub Pages 루트)
css/style.css       UI·레이아웃·터치 조작
js/                 main, core, state, field, battle, ui, audio, tracks (ES 모듈)
data/*.json         맵·이벤트·캐릭터·적·아이템·스킬 데이터
assets/*.png        아트 154장 + manifest.json
fonts/              Galmuri11, Galmuri11-Bold
```

`.nojekyll`이 있어 Jekyll 처리를 건너뛰고 정적 파일을 그대로 서빙합니다.

## 로컬 실행

```sh
python3 -m http.server 8080
# http://localhost:8080
```

ES 모듈을 쓰므로 `file://`로 열면 동작하지 않습니다.

## 라이선스

코드는 저장소 소유자(진재구)의 것이며, 폰트는 SIL OFL 1.1입니다.
