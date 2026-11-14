# 개발·테스트

> 테스트 실행, 체험용 스냅샷 만들기, 보조 스크립트 · [← README로 돌아가기](../README.md)

## 테스트

```bash
cd kma-mid-forecast
```

```bash
python3 -m unittest discover -s tests -v
```

`tests/fixtures/real_20261110.json`(중기)과 `short_20261113.json`(단기: 실황·초단기예보·단기예보, 서울 종로구 격자)은 실제 API 응답의 항목(인증키 없음)으로, 변환값이 원본 필드와 일치하는지 대조합니다. 발표시각 경계, 코드값 해석, 격자 지역, 그룹별 호출 간격, 캐시 시간도 검증합니다(전체 65개). 호출량·제한 테스트는 모의 응답과 모의 호출 기록만 사용합니다. 검증 결과는 [VERIFICATION.md](../VERIFICATION.md)를 참고하세요.

---

## 체험용 스냅샷 만들기 (서버 없는 정적 데모)

공개용 데모는 서버와 인증키 없이 브라우저만으로 열립니다. 만드는 순서는 다음과 같습니다.

```bash
# 1) 서버를 켠 상태에서 대표 지역의 실제 응답을 받아 둔다 (기상청 호출 간격 규칙을 지켜 약 25분 걸린다)
python3 tools/capture_snapshot.py --base http://127.0.0.1:8080 --out snapshot-data

# 2) 받아 둔 응답으로 정적 페이지를 만든다 (--standalone 은 로컬 확인용 standalone.html 추가)
python3 tools/build_snapshot.py --data snapshot-data --out snapshot-site --standalone
```

- 만들어진 `snapshot-site/`는 `index.html`과 `data/all.json` 등 정적 파일입니다. `python3 -m http.server`로 로컬에서 확인할 수 있습니다(`standalone.html#now`).
- 인증키·서버 내부 경로는 스냅샷에 들어가지 않으며, 빌드 스크립트가 해당 문자열이 있으면 중단합니다.
- 사이트 이름을 "예보 스냅샷 데모"로 바꾸고 비공식·기준 시각 안내를 화면 맨 위에 표시합니다.
- `snapshot-data/`, `snapshot-site/`는 생성물이라 저장소에 올리지 않습니다.

---

## 보조 스크립트 (`tools/`)

| 스크립트 | 용도 |
|---|---|
| `tools/build_grid_regions.py` | 기상청 격자 Excel → `data/grid_regions.json` 변환 |
| `tools/capture_snapshot.py` | 실행 중인 서버에서 대표 지역의 실제 응답 수집 |
| `tools/build_snapshot.py` | 수집한 응답으로 서버 없는 정적 데모 생성 |
