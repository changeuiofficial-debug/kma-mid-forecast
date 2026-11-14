"""정적 스냅샷 데모를 만든다. 서버와 인증키 없이 브라우저만으로 열리는 페이지 묶음이다.

capture_snapshot.py 가 받아 둔 실제 기상청 응답을 data/ 아래에 넣고, 화면 파일(static/)은 거의 그대로 복사한다.
바꾸는 곳은 아래 다섯 가지뿐이다.
  1) /api/* 요청을 스냅샷 파일로 대신 읽는 snapshot-shim.js 추가
  2) 페이지 이동을 /경로 대신 #해시(#now, #ultra …)로 처리
  3) 사이트 이름·제목을 "예보 스냅샷 데모"로 바꾸고, 비공식·스냅샷 안내를 맨 위에 표시
  4) 서버 전용 요소(지금 확인, 자동 확인·호출량, AI 도우미) 숨김, 데이터 안내 문구를 스냅샷에 맞게 교체
  5) 서버 내부 정보(키 파일 위치 등)는 스냅샷에 넣지 않음

사용: python3 tools/build_snapshot.py --data <수집 폴더> --out <출력 폴더> [--standalone]
"""
import argparse, datetime, json, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
REPO_URL = "https://github.com/changeuiofficial-debug/kma-mid-forecast"
PAGES = ["now", "ultra", "short", "outlook", "land", "temperature", "sea"]
SCRIPTS = ["combo.js", "outlook-parse.js", "short.js", "fx.js", "app.js", "side.js", "motion.js"]
STATUS_KEEP = ["limit", "warningAt", "warning", "limitReached", "providerHaltUntil", "lastSuccessAt",
               "minIntervalSeconds", "rollingWindowHours", "autoRefreshSeconds"]
KST = datetime.timezone(datetime.timedelta(hours=9))

SHIM = r'''"use strict";
// 정적 데모용: 서버 API(/api/*) 요청을 함께 게시한 스냅샷 파일(data/all.json)로 대신 응답한다.
(function(){
  const real=window.fetch.bind(window);
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
  const err=(status,code,message)=>reply(status,{error:{code,message}});
  let all=null;
  const load=()=>all||(all=real("data/all.json").then(r=>{if(!r.ok) throw new Error("snapshot");return r.json();}));
  window.fetch=async function(input,init){
    const url=typeof input==="string"?input:(input&&input.url)||"";
    if(!url.startsWith("/api/")) return real(input,init);
    const u=new URL(url,"http://snapshot.invalid");
    let data;
    try{ data=await load(); }catch(e){ all=null; return err(503,"snapshot_unavailable","스냅샷 파일을 읽지 못했습니다."); }
    if(u.pathname==="/api/status") return reply(200,data.status);
    if(u.pathname==="/api/regions") return reply(200,data.regions);
    if(u.pathname==="/api/forecast"){
      const hit=data.f[(u.searchParams.get("feature")||"")+"__"+(u.searchParams.get("region")||"")];
      return hit?reply(200,hit):err(404,"not_in_snapshot","이 데모에는 대표 지역만 들어 있습니다.");
    }
    return err(404,"snapshot","스냅샷 데모에서는 쓸 수 없는 기능입니다.");
  };
})();
'''

CSS = '''
/* === 스냅샷 데모 전용 === */
.snap-note{word-break:keep-all;margin:0 0 1.4rem;padding:.75rem 1rem;border:1px solid var(--line);border-left:3px solid var(--orange);border-radius:10px;background:var(--paper);color:var(--ink);font-size:.88rem;line-height:1.6}
.snap-note strong{font-weight:800}
.side .status-strip>div:nth-child(2),.side .status-strip>div:nth-child(3),.side .status-strip>div:nth-child(4){display:none}
.side .status-strip>div:first-child,.side .status-strip>div.snap-cell{display:block}
.side .status-strip{grid-template-columns:1fr 1fr}
@media(min-width:1024px){.side .status-strip{grid-template-columns:1fr}}
#refresh,#chat-open,#chat-panel{display:none!important}
.side{top:env(safe-area-inset-top,0px)}
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--standalone", action="store_true", help="로컬 확인용으로 doctype·head를 붙인 standalone.html도 만든다")
    a = ap.parse_args()
    data, out = Path(a.data), Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "data").mkdir(parents=True)

    index = json.loads((data / "_index.json").read_text(encoding="utf-8"))
    raw_status = json.loads((data / "_status.json").read_text(encoding="utf-8"))
    raw_regions = json.loads((data / "_regions.json").read_text(encoding="utf-8"))
    captured = lambda f, code: f"{f}__{code}" in index

    # --- 지역 목록: 수집된 지역만 ---
    regions = {}
    for key in ("outlook", "land", "temperature", "sea"):
        regions[key] = [r for r in raw_regions[key] if captured(key, r["code"])]
    regions["grid"] = [g for g in raw_regions["grid"] if all(captured(f, g["code"]) for f in ("now", "ultra", "short"))]
    # 단기 3개 화면의 지역 순서: 수집 계획 순서(서울 먼저)를 따른다
    order = {name: i for i, name in enumerate(["서울특별시", "부산광역시", "대구광역시", "인천광역시", "전남광주통합특별시", "광주광역시", "대전광역시", "울산광역시", "제주특별자치도"])}
    regions["grid"].sort(key=lambda g: order.get(g["name"], 99))

    # --- 상태: 서버 내부 정보 없이 필요한 값만 ---
    releases = {}
    for k, v in index.items():
        releases.setdefault(v["feature"], v["release"])
    status = {k: raw_status[k] for k in STATUS_KEEP if k in raw_status}
    status.update({"releases": {f: [r] for f, r in releases.items()}, "releaseCandidates": [], "usage": 0, "usageByFeature": {},
                   "keyStatus": "configured", "geminiStatus": "missing", "autoRefreshSeconds": 3600})

    # --- 예보 응답: 한 파일(data/all.json)로 묶는다 ---
    bundle = {"status": status, "regions": regions, "f": {}}
    for key in index:
        text = (data / "f" / f"{key}.json").read_text(encoding="utf-8")
        if "/Users/" in text or "serviceKey" in text or "authKey" in text:
            sys.exit(f"스냅샷에 넣으면 안 되는 문자열이 있습니다: {key}")
        bundle["f"][key] = json.loads(text)
    n_files = len(bundle["f"])
    (out / "data" / "all.json").write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # --- 수집 시각(한국 시간) ---
    ts = datetime.datetime.fromtimestamp(min(f.stat().st_mtime for f in (data / "f").glob("*.json")), KST)   # 가장 이른 수신 시각(보수적으로 표시)
    stamp_long = ts.strftime("%Y-%m-%d %H:%M")
    stamp_short = ts.strftime("%m/%d %H:%M")

    # --- 화면 파일 복사와 수정 ---
    shutil.copy(STATIC / "styles.css", out / "styles.css")
    with open(out / "styles.css", "a", encoding="utf-8") as fh:
        fh.write(CSS)
    for name in SCRIPTS:
        if name == "app.js":
            continue
        shutil.copy(STATIC / name, out / name)
    (out / "snapshot-shim.js").write_text(SHIM, encoding="utf-8")

    app = (STATIC / "app.js").read_text(encoding="utf-8")
    def sub(old, new, count=1):
        nonlocal app
        if old not in app:
            sys.exit("app.js에서 바꿀 부분을 찾지 못했습니다: " + old[:60])
        app = app.replace(old, new, count)
    sub('const page = PAGE_BY_PATH[location.pathname] || "now";',
        'const SNAP_PAGES = %s;\nconst page = SNAP_PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "now";\n'
        'window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (SNAP_PAGES.includes(h) && h !== page) location.reload(); });' % json.dumps(PAGES))
    sub('document.title=`${cfg.title} | 기상청 예보`;', 'document.title=`${cfg.title} | 예보 스냅샷 데모`;')
    sub("첨부 Excel의 상세 기온 지점별", "기온 지점별")   # 외부인에게는 의미 없는 '첨부 Excel' 표현 제거
    method = [
        f"이 페이지는 기상청 단기·중기예보 조회서비스(공공데이터포털)의 실제 응답을 {stamp_long}(한국 시간)에 받아 둔 스냅샷입니다. 실시간으로 갱신되지 않습니다.",
        "서버와 인증키가 없는 정적 페이지라서 대표 지역만 들어 있고, 자동 확인·호출량 관리·AI 도우미는 꺼져 있습니다.",
        "전체 기능(전국 3,838개 지역 검색, 30초 자동 확인, 서버 캐시와 호출 한도 관리)은 소스 코드를 내려받아 직접 실행하면 쓸 수 있습니다.",
        "기상청과 관련 없는 개인 학습 프로젝트이며, 공식 서비스가 아닙니다. 정확한 예보는 기상청 공식 채널에서 확인하세요.",
    ]
    sub('if(cfg.method) $("method-note").innerHTML=`<h2>데이터 안내</h2>${cfg.method.map(t=>`<p>${esc(t)}</p>`).join("")}`;',
        'if(cfg.method) $("method-note").innerHTML=`<h2>데이터 안내</h2>${%s.map(t=>`<p>${esc(t)}</p>`).join("")}<p><a href="%s" target="_blank" rel="noopener noreferrer">소스 코드 보기 (GitHub) ↗</a></p>`;'
        % (json.dumps(method, ensure_ascii=False), REPO_URL))
    (out / "app.js").write_text(app, encoding="utf-8")

    # --- 페이지(HTML 조각) ---
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    body = html[html.index("<body>") + 6: html.index("</body>")]
    body = re.sub(r'\s*<script src="[^"]+" defer></script>', "", body)
    body = re.sub(r'\s*<a class="skip" href="#main">[^<]*</a>', "", body)   # 해시 이동과 겹치지 않게 제거
    for p in PAGES:
        body = body.replace(f'href="/{p}" data-page="{p}"', f'href="#{p}" data-page="{p}"')
    body = body.replace("<span>기상청 예보</span>", "<span>예보 스냅샷 데모</span>")
    body = body.replace("출처: 기상청 단기예보·중기예보 조회서비스 · 공공데이터포털", "출처: 기상청 단기예보·중기예보 조회서비스 · 공공데이터포털 · 비공식 학습 프로젝트")
    note = (f'<aside class="snap-note" role="note"><strong>비공식 학습 프로젝트 · {stamp_long} 기준 스냅샷</strong><br>'
            f'기상청 공공데이터를 이용해 만든 개인 프로젝트이며 공식 서비스가 아닙니다. 실시간으로 갱신되지 않고, 대표 지역만 수록했습니다.</aside>\n    ')
    body = body.replace('<section class="intro">', note + '<section class="intro">', 1)
    cell = f'<div class="snap-cell"><span>스냅샷 기준</span><strong>{stamp_short}</strong><small class="sub">실시간 아님 · 한국 시간</small></div>\n    '
    anchor = '<small class="sub">앱 합계 · 상한 9,000</small></div>\n    </section>'
    body = body.replace(anchor, '<small class="sub">앱 합계 · 상한 9,000</small></div>\n      ' + cell.strip() + "\n    </section>", 1)
    if "snap-cell" not in body:
        sys.exit("상태 칸을 넣을 위치를 찾지 못했습니다")
    scripts = '<script src="snapshot-shim.js"></script>\n' + "\n".join(f'<script src="{s}" defer></script>' for s in SCRIPTS)
    head = '<title>예보 스냅샷 데모</title>\n<link rel="stylesheet" href="styles.css">\n'
    page = head + body.strip() + "\n" + scripts + "\n"
    (out / "index.html").write_text(page, encoding="utf-8")
    if a.standalone:
        (out / "standalone.html").write_text('<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n' + page + "</body></html>\n", encoding="utf-8")

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"완료: 예보 응답 {n_files}개, 총 {total/1024:.0f}KB, 기준 {stamp_long}")
    print("지역 수:", {k: len(v) for k, v in regions.items()})


if __name__ == "__main__":
    main()
