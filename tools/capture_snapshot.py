"""실행 중인 서버(/api/*)에서 대표 지역의 실제 응답을 받아 스냅샷 파일로 저장한다.

공개 데모(정적 페이지)에는 서버와 인증키가 없으므로, 이 스크립트가 받아 둔 응답을 대신 보여 준다.
서버의 호출 간격 규칙(단기 5초, 중기 30초)과 하루 호출 한도를 그대로 지킨다. 인증키는 이 스크립트에 필요 없다.

사용: python3 tools/capture_snapshot.py --base http://127.0.0.1:8081 --out <저장 폴더>
"""
import argparse, json, sys, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path

GRID_NAMES = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "전남광주통합특별시", "대전광역시", "울산광역시", "제주특별자치도"]
TEMP_NAMES = ["서울", "인천", "수원", "춘천", "강릉", "대전", "청주", "대구", "부산", "광주", "전주", "제주"]
GAP = {"now": 6, "ultra": 6, "short": 6, "outlook": 31, "land": 31, "temperature": 31, "sea": 31}


def get(base, path):
    try:
        with urllib.request.urlopen(base + path, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"error": {"code": "http", "message": str(e)}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8081")
    ap.add_argument("--out", required=True)
    ap.add_argument("--only-grid", action="store_true", help="단기 3개 화면의 지역만 (이미 받은 항목은 건너뛰고 기존 결과에 합친다)")
    a = ap.parse_args()
    out = Path(a.out); (out / "f").mkdir(parents=True, exist_ok=True)

    _, status = get(a.base, "/api/status")
    _, regions = get(a.base, "/api/regions")
    prev = {}
    if a.only_grid and (out / "_index.json").exists():
        prev = json.loads((out / "_index.json").read_text(encoding="utf-8"))
        # 발표시각이 처음 수집과 같을 때만 합친다 (섞이면 화면의 발표시각이 어긋난다)
    else:
        (out / "_status.json").write_text(json.dumps(status, ensure_ascii=False), encoding="utf-8")
        (out / "_regions.json").write_text(json.dumps(regions, ensure_ascii=False), encoding="utf-8")

    plan = []  # (feature, regionCode, regionName)
    grid = {g["name"]: g for g in regions["grid"] if g.get("lvl") == 1}
    for n in GRID_NAMES:
        if n in grid:
            for f in ("now", "ultra", "short"):
                plan.append((f, grid[n]["code"], n))
        else:
            print("격자 지역 없음:", n)
    if not a.only_grid:
        for f in ("outlook", "land", "sea"):
            for r in regions[f]:
                plan.append((f, r["code"], r["name"]))
        names = {r["name"]: r for r in regions["temperature"]}
        for n in TEMP_NAMES:
            if n in names:
                plan.append(("temperature", names[n]["code"], n))
            else:
                print("기온 지역 없음:", n)
    plan = [p for p in plan if f"{p[0]}__{p[1]}" not in prev]
    # 단기는 5초 간격이라 먼저, 중기는 뒤에서 30초 간격으로
    plan.sort(key=lambda p: GAP[p[0]])
    print("수집 항목", len(plan), flush=True)

    done = dict(prev)
    last = {}
    for i, (f, code, name) in enumerate(plan, 1):
        raw_rel = status["releases"][f][0]
        rel = raw_rel if isinstance(raw_rel, str) else raw_rel.get("tmFc") or raw_rel.get("value")
        first = next((v["release"] for v in prev.values() if v["feature"] == f), None)
        if first and first != rel:
            rel = first   # 추가 수집도 처음 수집한 발표시각을 쓴다(그 발표본은 서버가 계속 조회할 수 있다)
        grp = "short" if f in ("now", "ultra", "short") else "mid"
        wait = GAP[f] - (time.time() - last.get(grp, 0))
        if wait > 0:
            time.sleep(wait)
        for attempt in range(6):
            q = urllib.parse.urlencode({"feature": f, "region": code, "tmFc": rel})
            st, body = get(a.base, "/api/forecast?" + q)
            last[grp] = time.time()
            if st == 200:
                (out / "f" / f"{f}__{code}.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
                done[f"{f}__{code}"] = {"feature": f, "code": code, "name": name, "release": rel}
                print(f"[{i}/{len(plan)}] OK  {f} {name} {rel}", flush=True)
                break
            msg = (body.get("error") or {}).get("code")
            print(f"[{i}/{len(plan)}] {st} {msg} {f} {name} (재시도 {attempt + 1})", flush=True)
            if msg not in ("cooldown", "waiting"):
                time.sleep(10)
            time.sleep(GAP[f] + 1)
        else:
            print("실패:", f, name, flush=True)
    (out / "_index.json").write_text(json.dumps(done, ensure_ascii=False), encoding="utf-8")
    print("DONE", len(done), "/", len(plan), flush=True)


if __name__ == "__main__":
    sys.exit(main())
