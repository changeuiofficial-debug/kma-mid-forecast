"use strict";

// 브라우저는 이 로컬 서버(/api/...)에만 요청한다. 인증키는 서버에만 있다.
const PAGE_BY_PATH = {"/":"now","/now":"now","/ultra":"ultra","/short":"short","/outlook":"outlook","/land":"land","/temperature":"temperature","/sea":"sea"};
const SHORT_METHOD = (cycle, cacheText) => [
  `${cycle} 30초마다 새 자료가 생기는 것이 아니라, 활성 탭에서 30초마다 서버에 확인합니다. 같은 발표본은 서버 캐시(${cacheText})를 그대로 쓰고, 숨긴 탭에서는 자동 확인을 멈춥니다.`,
  "브라우저는 이 로컬 서버에만 요청합니다. 서버가 기상청 API 호출, 같은 조건의 캐시 공유, 중기·단기 합산 호출량을 관리합니다. 단기 기능 사이의 외부 호출은 최소 5초 간격(중기 기능은 30초)입니다.",
  "호출량은 최근 24시간 이동 집계입니다(공공데이터포털의 일일 초기화 시각은 공식 자료에서 확인하지 못했습니다). 8,000회부터 경고하고 9,000회에서 외부 호출을 멈춥니다. 같은 인증키를 다른 프로그램에서도 쓰면 포털 집계와 다를 수 있습니다.",
  "지역은 기상청 격자(X,Y) 좌표로 조회합니다. 같은 격자를 쓰는 행정구역은 같은 값을 받으며, 행정동 단위의 정밀 예보가 아닙니다."];
const CONFIG = {
  now:{name:"getUltraSrtNcst",title:"현재 날씨",grid:true,codeName:"격자 X,Y",note:["매시 정시 발표","10분마다 갱신 · KST"],
    cycle:"실황은 매시 정시에 생성되어 10분마다 갱신되며, 발표 10분 이후부터 조회할 수 있습니다.",
    description:"선택한 지역이 속한 격자의 대표 관측소(AWS) 실황을 확인합니다. 예보가 아니라 관측값입니다.",method:SHORT_METHOD("실황은 매시 정시에 생성되어 10분마다 갱신됩니다.","10분")},
  ultra:{name:"getUltraSrtFcst",title:"6시간 예보",grid:true,codeName:"격자 X,Y",note:["매시 30분 발표","앞으로 6시간 · KST"],
    cycle:"초단기예보는 매시 30분에 생성되는 앞으로 6시간 예보이며, 발표 45분 이후부터 조회할 수 있습니다.",
    description:"앞으로 6시간의 시간별 기온·하늘상태·강수확률·습도·바람을 카드, 그래프, 표로 확인합니다.",method:SHORT_METHOD("초단기예보는 매시 30분에 새로 발표됩니다.","10분")},
  short:{name:"getVilageFcst",title:"단기예보",grid:true,codeName:"격자 X,Y",note:["하루 8회 발표","02·05·08·11·14·17·20·23시"],
    cycle:"단기예보는 02·05·08·11·14·17·20·23시(하루 8회)에 발표되며, 발표 10분 이후부터 조회할 수 있습니다.",
    description:"며칠 앞까지의 시간별 기온·강수확률·하늘상태와 날짜별 최저·최고기온을 확인합니다.",method:SHORT_METHOD("단기예보는 하루 8번 발표됩니다.","30분")},
  outlook:{name:"getMidFcst",title:"중기전망",codeName:"지점번호 stnId",description:"권역별 서술형 기상전망(wfSv) 원문과 조회에 사용한 발표 정보를 확인합니다. 전망문은 수치 그래프로 바꾸지 않습니다."},
  land:{name:"getMidLandFcst",title:"중기육상예보",codeName:"육상 예보구역코드 regId",description:"날짜별 날씨와 강수확률(%)을 카드, 그래프, 표로 확인합니다. 4~7일 후는 오전·오후, 8~10일 후는 하루 단위입니다."},
  temperature:{name:"getMidTa",title:"중기기온",codeName:"기온 예보구역코드 regId",description:"첨부 Excel의 상세 기온 지점별 예상 최저·최고기온(℃)을 두 개의 선과 수치표로 비교합니다."},
  sea:{name:"getMidSeaFcst",title:"중기해상예보",codeName:"해상 예보구역코드 regId",description:"해역별 날씨와 최저·최고 예상파고(m) 범위를 확인합니다. 육상 지역과 자동으로 연결하지 않습니다."}
};
const page = PAGE_BY_PATH[location.pathname] || "now";
const IS_GRID = Boolean(CONFIG[page].grid);
const REFRESH_SECONDS = 30;
const $ = (id) => document.getElementById(id);
const state = {regions:[], seconds:REFRESH_SECONDS, timer:null, status:null, busy:false, chatBusy:false,
  autoEnabled:true, lastGood:null, releaseChosenByUser:false, fallbackFrom:null};
// API에서 받은 문자열은 항상 이스케이프한 뒤 화면에 넣는다(HTML로 실행되지 않음).
const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const isMissing = (v) => v === null || v === undefined || v === "";
const showValue = (v, unit="") => isMissing(v) ? '<span class="missing">미제공</span>' : `${esc(v)}${unit}`;
// ---- 날짜 표기 규칙(모든 화면 공통) ----
// 예보 날짜 11/15(일) · 발표시각 11/11(화) 06시 · 확인 시각 14:04:20 (오늘이 아니면 날짜 추가)
const KST_PARTS=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
const KST_WEEKDAY=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",weekday:"short"});
function kst(date){const o={};KST_PARTS.formatToParts(date).forEach(p=>{o[p.type]=p.value;});return o;}
const fmtDate=(iso)=>`${Number(iso.slice(5,7))}/${Number(iso.slice(8,10))}(${KST_WEEKDAY.format(new Date(`${iso}T12:00:00+09:00`))})`;
const dateLabel=fmtDate, md=fmtDate;
const tmFcDate=(v)=>new Date(`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T${v.slice(8,10)}:${v.slice(10,12)}:00+09:00`);
const fmtRelease=(v)=>`${fmtDate(`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`)} ${v.slice(10,12)==='00'?`${v.slice(8,10)}시`:`${v.slice(8,10)}:${v.slice(10,12)}`}`;
const releaseLabel=(v)=>`${fmtRelease(v)} 발표`;
function ageText(v){const min=Math.max(0,Math.round((Date.now()-tmFcDate(v).getTime())/60000)); return min<60?`${min}분 전`:`${Math.floor(min/60)}시간 전`;}
function fmtClock(sec){
  if(!sec) return "—"; const d=new Date(sec*1000), p=kst(d), t=kst(new Date());
  const time=`${p.hour}:${p.minute}:${p.second}`;
  return (p.year===t.year&&p.month===t.month&&p.day===t.day)?time:`${fmtDate(`${p.year}-${p.month}-${p.day}`)} ${p.hour}:${p.minute}`;
}
const timeLabel=fmtClock;

async function getJSON(url){
  let response;
  try{ response = await fetch(url,{headers:{Accept:"application/json"},cache:"no-store"}); }
  catch(_){ const e = new Error("로컬 서버에 연결할 수 없습니다. 서버실행.cmd 창(또는 python server.py 터미널)이 열려 있는지 확인해 주세요."); e.info={code:"local_server_down"}; throw e; }
  const body = await response.json().catch(() => ({}));
  if(!response.ok){const e = new Error(body.error?.message || `서버 오류 (${response.status})`); e.info=body.error||{}; throw e;}
  return body;
}

function setupPage(){
  const cfg=CONFIG[page]; document.title=`${cfg.title} | 기상청 예보`;
  $("feature-name").textContent=cfg.name; $("page-title").textContent=cfg.title; $("page-description").textContent=cfg.description;
  if(cfg.note){ $("rel-note-title").textContent=cfg.note[0]; $("rel-note-sub").textContent=cfg.note[1]; }
  if(cfg.method) $("method-note").innerHTML=`<h2>데이터 안내</h2>${cfg.method.map(t=>`<p>${esc(t)}</p>`).join("")}`;
  document.querySelectorAll("nav a").forEach(a=>{if(a.dataset.page===page){a.classList.add("active");a.setAttribute("aria-current","page");}});
}

async function initialize(){
  setupPage(); setupInteractions();
  try{
    const [status,regions]=await Promise.all([getJSON("/api/status"),getJSON("/api/regions")]);
    state.status=status; state.regions=regions[IS_GRID?"grid":page];
    fillRegions(); fillReleases(status.releases?.[page]||status.releaseCandidates);
    // 화면용 드롭다운: 지역은 검색 가능(기온은 203곳), 발표시각은 단순 목록
    enhanceSelect($("region"),{label:"region-label",searchable:state.regions.length>12,placeholder:IS_GRID?"지역 이름 검색 (예: 종로구, 해운대)":"지역 이름 또는 코드 검색"});
    enhanceSelect($("release"),{label:"release-label"});
    updateKeyAlert(status); updateUsage(status.usage,status.warning); updateAdminAlert(status);
    $("region").addEventListener("change",()=>{saveRegion($("region").value); updateRegionDetail(); state.lastGood=null; clearStatus(); $("results").classList.add("is-switching"); resetRelease(); refresh(true);});
    $("release").addEventListener("change",()=>{state.releaseChosenByUser=true; state.lastGood=null; clearStatus(); $("results").classList.add("is-switching"); refresh(true);});
    $("refresh").addEventListener("click",()=>refresh(true));
    document.addEventListener("visibilitychange",()=>{ if(!document.hidden && state.autoEnabled && (state.seconds<=0 || !state.renderedKey)) refresh(false); });  // 처음부터 숨겨져 있던 탭도 보이는 즉시 조회
    window.addEventListener("pagehide",()=>{ clearInterval(state.timer); state.timer=null; });
    state.autoEnabled = status.keyStatus==="configured";
    state.timer=setInterval(tick,1000); preparePendingAction(); updateRegionDetail();
    if(state.autoEnabled){ await refresh(true); }  // 첫 조회는 탭이 숨겨져 있어도 한 번 실행(서버 캐시·30초 간격 적용)
    else { $("status-countdown").textContent="인증키 설정 후 시작"; renderKeyNeeded(status); }
    finishPendingAction();
  }catch(error){ showMessage(error.message,"error"); $("status-countdown").textContent="중지됨"; }
}

const REGION_KEY=`kma-region-${IS_GRID?"grid":page}`;  // 현재·6시간·단기 페이지는 같은 지역 선택을 공유한다
function saveRegion(code){ try{ localStorage.setItem(REGION_KEY,code); }catch(_){} }
function loadRegion(){ try{ return localStorage.getItem(REGION_KEY); }catch(_){ return null; } }
function fillRegions(){
  const saved=loadRegion();
  $("region").innerHTML=state.regions.map(r=>`<option value="${esc(r.code)}">${esc(r.name)} (${IS_GRID?`${esc(r.nx)},${esc(r.ny)}`:esc(r.code)})</option>`).join("");
  if(state.regions.some(r=>r.code===saved)) $("region").value=saved;
}
function fillReleases(values){
  $("release").innerHTML=values.map((v,i)=>IS_GRID
    ?`<option value="${v}">${releaseLabel(v)} (${i===0?"최신":"직전 발표"})</option>`
    :`<option value="${v}">${releaseLabel(v)} (${i===0?"최신 · ":""}${v.slice(8,10)==="06"?"4~10일 후":"5~10일 후"})</option>`).join("");
}
// 시간이 지나 새 발표본이 생기면(단기 기능은 매시) 사용자가 직접 고르지 않은 경우 자동으로 최신 발표본으로 옮긴다.
function syncReleases(s){
  const list=s.releases?.[page]; const sel=$("release");
  if(!list||state.releaseChosenByUser||sel.options[0]?.value===list[0]) return false;
  fillReleases(list); sel.selectedIndex=0; sel._combo?.sync(); state.fallbackFrom=null; return true;
}
function resetRelease(){ if(!state.releaseChosenByUser) $("release").selectedIndex=0; state.fallbackFrom=null; }
function updateRegionDetail(){
  const r=state.regions.find(x=>x.code===$("region").value); if(!r) return;
  if(IS_GRID){ $("region-detail").innerHTML=`<strong>${esc(r.name)}</strong> · 격자 <span class="code">X ${esc(r.nx)}</span> <span class="code">Y ${esc(r.ny)}</span> · 같은 격자를 쓰는 지역 ${esc(r.n)}곳은 같은 값을 받습니다(행정동 단위 정밀 예보가 아님)`; return; }
  $("region-detail").innerHTML=`<strong>${esc(r.name)}</strong> · ${esc(CONFIG[page].codeName)} <span class="code">${esc(r.code)}</span> · 적용 범위: ${esc(r.scope)}`;
}
function updateKeyAlert(s){
  if(s.keyStatus==="configured") return;
  const labels={missing:"설정되어 있지 않습니다",empty:"값이 비어 있습니다",placeholder:"예제 자리표시자(YOUR_API_KEY 등) 상태입니다"};
  const hint=(s.keyFileHints||[]).filter(h=>h!==".env").map(h=>`<br>• <span class="code">${esc(h)}</span> 파일이 있습니다. 이름을 정확히 <span class="code">KEY.env</span>로 바꿔 주세요(Windows에서 KEY.env.txt로 저장되는 경우가 많습니다).`).join("");
  const el=$("key-alert"); el.classList.remove("hidden");
  el.innerHTML=`<strong>인증키 설정 필요</strong><br>KMA_SERVICE_KEY가 ${labels[s.keyStatus]||"설정되지 않았습니다"}. 인증키가 틀렸다는 뜻은 아닙니다.<br>
  아래 파일을 만들고 <span class="code">KMA_SERVICE_KEY=발급받은_실제_인증키</span> 한 줄을 저장한 뒤 서버를 다시 시작하세요.<br>
  위치: <span class="code">${esc(s.keyFile||"server.py와 같은 폴더의 KEY.env")}</span>${hint}`;
}
function renderKeyNeeded(s){
  state.renderedKey=null; $("results").innerHTML=`<section class="panel"><h2>아직 조회할 수 없습니다</h2><p>서버에 인증키가 없어서 기상청 API를 호출하지 않았습니다. 지역·발표시각 선택과 화면 구조는 그대로 사용할 수 있습니다.</p>
  <ol class="steps"><li>공공데이터포털에서 ‘기상청_중기예보 조회서비스’·‘기상청_단기예보 조회서비스’ 활용신청 후 일반 인증키를 발급받습니다.</li>
  <li>${esc(s.keyFile||"KEY.env")} 파일에 <span class="code">KMA_SERVICE_KEY=발급받은_실제_인증키</span>를 저장합니다.</li>
  <li>서버 창에서 Ctrl+C로 종료한 뒤 서버실행.cmd를 다시 실행합니다.</li></ol></section>`;
}
function updateUsage(value,warning){$("status-usage").textContent=`${Number(value).toLocaleString()} / 9,000`; $("status-usage").classList.toggle("warn",Boolean(warning));}
function updateAdminAlert(s){
  const el=$("admin-alert"); let html="";
  if(s.providerHaltUntil) html=`<strong>외부 호출 중지</strong> 제공기관이 호출 제한 오류를 반환해 ${esc(timeLabel(s.providerHaltUntil))}까지 기상청 API를 호출하지 않습니다. 캐시 자료만 표시합니다.`;
  else if(s.limitReached) html=`<strong>외부 호출 중지</strong> 앱 자체 상한(최근 24시간 9,000회)에 도달했습니다. 캐시 자료만 표시합니다.`;
  else if(s.warning) html=`<strong>관리자 경고</strong> 최근 24시간 외부 호출이 ${Number(s.usage).toLocaleString()}회로 경고 기준 8,000회를 넘었습니다. 9,000회에서 외부 호출을 중지합니다.`;
  if(html){ html+=` <span class="small">같은 인증키를 다른 프로그램에서도 쓰면 공공데이터포털 집계와 다를 수 있습니다.</span>`; el.innerHTML=html; el.classList.remove("hidden"); }
  else el.classList.add("hidden");
}
function tick(){
  if(!state.autoEnabled) return;
  if(document.hidden){$("status-countdown").textContent="숨긴 탭 · 일시정지"; return;}
  if(state.busy){$("status-countdown").textContent="확인 중"; return;}
  state.seconds=Math.max(0,state.seconds-1); $("status-countdown").textContent=`${state.seconds}초 후`; updateRing();
  if(state.seconds===0) refresh(false);
}
function updateRing(){const ring=$("ring-fg"); if(!ring) return; const left=Math.min(1,state.seconds/REFRESH_SECONDS); ring.style.strokeDashoffset=String(100-left*100);}
function showMessage(text,type="warning"){const el=$("message"); el.className=`alert ${type}`; el.textContent=text;}
function hideMessage(){$("message").className="alert hidden";}
// 다음 자동 확인 시각. 서버가 알려 준 대기 시간(retryAfter)이 있으면 그 값을 따른다.
function schedule(seconds,floor=REFRESH_SECONDS){ state.seconds=Math.min(Math.max(floor,Number(seconds)||REFRESH_SECONDS),3600); }
function clearStatus(){ ["status-release","status-release-sub","status-checked","status-source"].forEach(id=>$(id).textContent="—"); }

const WAIT_CODES = new Set(["cooldown","backoff","inflight_failed"]);
async function refresh(manual){
  if(state.busy||(document.hidden&&!manual)) return;
  state.busy=true; $("refresh").disabled=true; $("refresh").classList.add("loading");
  const feature=encodeURIComponent(page), region=encodeURIComponent($("region").value), tmFc=encodeURIComponent($("release").value);
  try{
    const body=await getJSON(`/api/forecast?feature=${feature}&region=${region}&tmFc=${tmFc}`);
    const result=body.result, meta=body.meta;
    state.lastGood={result,meta};
    const viewKey=`${page}|${result.requestedCode}|${result.requestedRelease}`, sig=JSON.stringify(result.data);
    if(state.renderedKey!==viewKey || state.renderedSig!==sig){
      const sameView=state.renderedKey===viewKey;
      render(result,{animate:!sameView});
      if(sameView) flashNewBadge();  // 같은 조건인데 값이 바뀌면 새 발표 자료가 반영된 것
      state.renderedKey=viewKey; state.renderedSig=sig;
    }else{ document.querySelectorAll(".stale-badge").forEach(n=>n.remove()); }
    updateMeta(result,meta); hideMessage();
    const d=result.data;
    const hasData=page==="outlook"?Boolean(d?.text):page==="now"?Boolean(d&&Object.values(d).some(v=>v!==null&&v!==undefined)):Array.isArray(d)&&d.length>0;
    if(!hasData && tryOlderRelease("최신 발표 후보에 예보 값이 없어", meta.retryAfter)) return;
    if(meta.cache.startsWith("stale")){
      const why={stale_cooldown:`다른 조회와의 ${IS_GRID?5:30}초 호출 간격을 지키는 중이라`,stale_backoff:"이전 오류로 재시도 간격을 늘리는 중이라",
        stale_error:"이번 갱신이 실패해",stale_limit:"외부 호출이 중지된 상태라",stale_inflight:"동일 요청이 끝나지 않아"}[meta.cache]||"";
      showMessage(`${why} 서버에 저장된 이전 정상 자료를 표시합니다. 기상청 마지막 성공 조회: ${timeLabel(meta.fetchedAt)}${meta.retryAfter?` · 약 ${meta.retryAfter}초 후 다시 확인`:""}`, meta.cache==="stale_cooldown"?"info":"warning");
    }
    schedule(meta.retryAfter);
  }catch(error){
    const code=error.info?.code||"";
    if(code==="no_data" && tryOlderRelease("최신 발표 후보 자료가 아직 없어(응답 코드 03)", error.info.retryAfter)) return;
    if(WAIT_CODES.has(code)){
      const sec=Number(error.info.retryAfter)||REFRESH_SECONDS;
      showMessage(`${error.message} 약 ${sec}초 후 자동으로 다시 확인합니다.`,"info");
      if(!state.lastGood){ state.renderedKey=null; $("results").innerHTML=`<section class="panel loading"><h2>조회 대기 중</h2><p>${IS_GRID?"이 앱은 같은 서비스의 기상청 API 호출 사이에 최소 5초 간격을 둡니다.":"이 앱은 네 기능을 합쳐 기상청 API를 30초에 한 번만 호출합니다."} 순서가 되면 자동으로 표시됩니다.</p></section>`; }
      schedule(sec,3); return;
    }
    const prefix={provider_auth:"[인증·활용신청 오류] ",provider_limit:"[제공기관 호출 제한] ",provider_limit_halt:"[외부 호출 중지] ",app_limit:"[앱 호출 상한] ",
      network:"[네트워크·제공기관 연결 오류] ",local_server_down:"[로컬 서버 연결 실패] ",no_data:"[데이터 없음] ",invalid_response:"[응답 형식 오류] "}[code]||(code.startsWith("key_")?"[인증키 미설정] ":"");
    if(state.lastGood){ showMessage(`${prefix}${error.message} 아래는 이전 정상 자료입니다(기상청 마지막 성공 조회: ${timeLabel(state.lastGood.meta.fetchedAt)}).`,"error"); markStale(); }
    else { state.renderedKey=null; showMessage(prefix+error.message,"error"); $("results").innerHTML=`<section class="panel"><h2>데이터를 표시할 수 없습니다</h2><p>${esc(prefix+error.message)}</p></section>`; }
    if(code==="local_server_down"){ $("status-countdown").textContent="서버 연결 끊김"; }
    schedule(error.info?.retryAfter);
  }finally{
    state.busy=false; $("refresh").disabled=false; $("refresh").classList.remove("loading"); $("results").classList.remove("is-switching");
    getJSON("/api/status").then(s=>{state.status=s; updateUsage(s.usage,s.warning); updateAdminAlert(s); if(syncReleases(s)) state.seconds=Math.min(state.seconds,2);}).catch(()=>{});
  }
}
function tryOlderRelease(reason, retryAfter){
  const sel=$("release");
  if(state.releaseChosenByUser || sel.selectedIndex!==0 || sel.options.length<2) return false;
  state.fallbackFrom=sel.value; sel.selectedIndex=1; state.lastGood=null;
  const sec=Math.max(REFRESH_SECONDS,Number(retryAfter)||REFRESH_SECONDS); schedule(sec);
  showMessage(`${reason} ${IS_GRID?"직전":"최근 24시간 이내의 이전"} 발표본(${releaseLabel(sel.value)})을 약 ${sec}초 후 확인합니다.`,"info");
  return true;
}
function markStale(){ const head=document.querySelector("#results .panel"); if(head && !head.querySelector(".stale-badge")) head.insertAdjacentHTML("afterbegin",'<span class="badge stale-badge">이전 자료</span>'); }
function updateMeta(result,meta){
  $("status-release").textContent=fmtRelease(result.requestedRelease); $("status-release-sub").textContent=`${ageText(result.requestedRelease)} 발표`;
  $("status-checked").textContent=fmtClock(new Date(meta.checkedAt).getTime()/1000);
  $("status-source").textContent=meta.cache==="network"?"기상청 새 조회":`서버 캐시 · 기상청 조회 ${fmtClock(meta.fetchedAt)}`;
  updateUsage(meta.usage,meta.warning);
}

// ===================== 조회 결과 시각화 =====================
// 원칙: 응답에 있는 값만 그린다. 아이콘은 가이드 '하늘상태' 문구와 정확히 같을 때만 붙이고, 원문 글자를 항상 함께 둔다.
const REDUCED = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
const WX_SET = new Set(["맑음","구름많음","구름많고비","구름많고눈","구름많고비/눈","구름많고소나기","흐림","흐리고비","흐리고눈","흐리고비/눈","흐리고소나기"]);
function wxKind(text){
  if(isMissing(text)) return null;
  const t=String(text).replace(/\s+/g,"");
  if(!WX_SET.has(t)) return null;  // 목록에 없는 문구는 아이콘을 짐작하지 않는다
  const sky=t==="맑음"?"clear":t.startsWith("구름많")?"partly":"overcast";
  const pcp=t.includes("비/눈")?"sleet":t.includes("소나기")?"shower":t.includes("비")?"rain":t.includes("눈")?"snow":null;
  return {sky,pcp};
}
const CLOUD="M13 34h22a8 8 0 0 0 .8-15.96A11 11 0 0 0 14.6 20.2 7 7 0 0 0 13 34z";
function sun(cx,cy,r){
  let rays=""; for(let k=0;k<8;k++){const a=k*Math.PI/4,c=Math.cos(a),s=Math.sin(a);rays+=`<line x1="${(cx+c*(r+3)).toFixed(1)}" y1="${(cy+s*(r+3)).toFixed(1)}" x2="${(cx+c*(r+6)).toFixed(1)}" y2="${(cy+s*(r+6)).toFixed(1)}"/>`;}
  return `<g class="sun"><circle cx="${cx}" cy="${cy}" r="${r}"/>${rays}</g>`;
}
function precip(type){
  const drop=(x)=>`<line class="drop" x1="${x}" y1="34" x2="${x-2}" y2="41"/>`;
  const flake=(x,y)=>`<circle class="flake" cx="${x}" cy="${y}" r="2"/>`;
  if(type==="rain") return drop(17)+drop(25)+drop(33);
  if(type==="shower") return `<g class="heavy">${drop(19)+drop(28)}</g>`;
  if(type==="snow") return flake(17,37)+flake(25,41)+flake(33,37);
  return drop(18)+flake(26,39)+drop(34); // 비/눈
}
function wxIcon(text,size=""){ const k=wxKind(text); return k?wxSvg(k,size):""; }
function wxSvg(k,size=""){
  const up=k.pcp?' transform="translate(0 -5)"':"";
  let g=k.sky==="clear"?sun(24,24,8):(k.sky==="partly"?`<g${up}>${sun(31,15,6)}</g>`:"")+`<path class="${k.sky==="overcast"?"cloud dark":"cloud"}" d="${CLOUD}"${up}/>`;
  if(k.pcp) g+=precip(k.pcp);
  return `<svg class="wx ${size}" viewBox="0 0 48 48" aria-hidden="true">${g}</svg>`;
}
const UI_ICON={
  drop:'<path d="M12 3.5s6 6.4 6 10.6a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/>',
  thermo:'<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9.5v7"/>',
  calendar:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  alert:'<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  wave:'<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.1"/>',
  umbrella:'<path d="M3 12.5a9 9 0 0 1 18 0z"/><path d="M12 12.5v6a2 2 0 0 0 4 0"/>',
  doc:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'
};
const ui=(name,cls="")=>`<svg class="ui-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${UI_ICON[name]||""}</svg>`;
const slot=(r)=>`${md(r.date)}${r.period&&r.period!=="하루"?` ${r.period}`:""}`;
const HAS_PRECIP=/비|눈|소나기/;

function groupByDate(rows){const map=new Map();rows.forEach(r=>{if(!map.has(r.date))map.set(r.date,[]);map.get(r.date).push(r);});return [...map.entries()];}
function extreme(rows,key,pick){
  const valid=rows.filter(r=>!isMissing(r[key]));
  if(!valid.length) return null;
  const value=pick(...valid.map(r=>r[key])); const at=valid.filter(r=>r[key]===value).map(slot);
  return {value, where: at.length>2?`${at[0]} 외 ${at.length-1}구간`:at.join(", ")};
}
function stat(i,icon,label,value,unit,sub){
  const body=isMissing(value)?'<span class="missing">미제공</span>':`<span data-count="${esc(value)}">${esc(value)}</span><small>${esc(unit)}</small>`;
  return `<div class="stat" style="--i:${i}"><span class="stat-ic">${icon}</span><span class="stat-label">${esc(label)}</span><strong>${body}</strong><span class="stat-sub">${esc(sub||"")}</span></div>`;
}
function summaryFor(result){
  if(IS_GRID) return shortSummary(result);
  const rows=Array.isArray(result.data)?result.data:[];
  if(!rows.length) return "";
  const precipCount=rows.filter(r=>HAS_PRECIP.test(r.weather||"")).length;
  let cards=[];
  if(page==="land"){
    const hi=extreme(rows,"rainProbability",Math.max), lo=extreme(rows,"rainProbability",Math.min);
    cards=[stat(0,ui("drop"),"가장 높은 강수확률",hi?.value,"%",hi?.where),
      stat(1,ui("umbrella"),"비·눈 표현이 있는 구간",precipCount,`/${rows.length}구간`,"날씨 문구 기준"),
      stat(2,ui("drop","soft"),"가장 낮은 강수확률",lo?.value,"%",lo?.where)];
  }else if(page==="temperature"){
    const hi=extreme(rows,"max",Math.max), lo=extreme(rows,"min",Math.min);
    const spans=rows.filter(r=>!isMissing(r.min)&&!isMissing(r.max)).map(r=>({...r,span:r.max-r.min}));
    const sp=extreme(spans,"span",Math.max);
    cards=[stat(0,ui("thermo","warm"),"기간 중 예상 최고기온",hi?.value,"℃",hi?.where),
      stat(1,ui("thermo","cool"),"기간 중 예상 최저기온",lo?.value,"℃",lo?.where),
      stat(2,ui("spark"),"하루 기온 폭이 가장 큰 날",sp?.value,"℃",sp?.where)];
  }else if(page==="sea"){
    const hi=extreme(rows,"waveMax",Math.max), lo=extreme(rows,"waveMin",Math.min);
    cards=[stat(0,ui("wave","high"),"가장 높은 최고 예상파고",hi?.value,"m",hi?.where),
      stat(1,ui("wave"),"가장 낮은 최저 예상파고",lo?.value,"m",lo?.where),
      stat(2,ui("umbrella"),"비·눈 표현이 있는 구간",precipCount,`/${rows.length}구간`,"날씨 문구 기준")];
  }
  return cards.length?`<div class="stats">${cards.join("")}</div><p class="small">요약 카드는 응답 값 중 가장 큰 값과 작은 값을 고른 것이며, 새로 계산한 예보가 아닙니다.</p>`:"";
}

function metaPanel(result){
  const selected=state.regions.find(r=>r.code===result.requestedCode);
  const compare=(IS_GRID?{match:"요청·응답 격자 일치",mismatch:"요청·응답 격자 불일치",not_returned:"응답에 격자 없음 · 비교 불가"}:{match:"요청·응답 코드 일치",mismatch:"요청·응답 코드 불일치",not_returned:"응답에 코드 없음 · 비교 불가"})[result.codeComparison];
  const rows=Array.isArray(result.data)?result.data:[];
  const dates=[...new Set(rows.map(r=>r.date))];
  const rel=result.requestedRelease;
  const chips=IS_GRID?shortChips(result):[];
  if(!IS_GRID&&dates.length) chips.push(`${ui("calendar")}예보 ${md(dates[0])} ~ ${md(dates[dates.length-1])} · ${dates.length}일`);
  chips.push(`<span class="${result.codeComparison==="mismatch"?"bad":""}">${esc(compare)}</span>`);
  const facts=IS_GRID?shortFacts(result,selected):`<li>요청에 사용한 발표시각 <b>${esc(releaseLabel(rel))}</b> (tmFc <span class="code">${esc(rel)}</span>) — 응답에는 발표시각 필드가 없어 요청값을 따로 보관한 것입니다.</li>
    ${Array.isArray(result.data)?`<li>가이드 기준 06시 발표는 4~10일 후, 18시 발표는 5~10일 후 예보입니다.</li>
    <li>API totalCount <b>${esc(result.totalCount)}</b>건 → 한 항목 안의 날짜별 필드를 펼쳐 <b>${rows.length}</b>개 행으로 표시합니다. 두 수는 다를 수 있습니다.</li>`:""}
    <li>제공기관 결과코드 ${esc(result.providerResult?.code||"—")} ${esc(result.providerResult?.message||"")}</li>
    <li>${esc(CONFIG[page].codeName)} <span class="code">${esc(result.requestedCode)}</span> · 적용 범위: ${esc(selected?.scope||"")}</li>`;
  return `<section class="panel result-head">
    <div class="result-title"><div><p class="step">조회 결과</p><h2>${esc(selected?.name||result.requestedCode)} <span class="code">${IS_GRID&&selected?`${esc(selected.nx)},${esc(selected.ny)}`:esc(result.requestedCode)}</span></h2></div>
    <span id="new-badge" class="badge new hidden" role="status">새 예보 반영</span></div>
    <div class="chips">${chips.map(c=>`<span class="chip">${c}</span>`).join("")}</div>
    ${summaryFor(result)}
    <details class="acc"><summary>${ui("info")}조회 정보 자세히</summary><div class="acc-body"><ul class="facts">${facts}</ul></div></details>
  </section>`;
}
function rawDetails(result){return `<details class="acc raw"><summary>${ui("doc")}제공기관 원문 필드 보기</summary><div class="acc-body"><pre>${esc(JSON.stringify(result.rawItem,null,2))}</pre></div></details>`;}

// 그래프·표 전환 탭. 선택한 탭은 30초 갱신 뒤에도 유지한다.
state.tabs = state.tabs || {};
function tabs(id,items){
  const sel=Math.min(state.tabs[id]??0,items.length-1);
  return `<div class="tabs" data-tabs="${id}"><div class="tablist" role="tablist" aria-label="보기 방식">${items.map((t,i)=>`<button type="button" role="tab" id="${id}-t${i}" aria-controls="${id}-p${i}" aria-selected="${i===sel}" tabindex="${i===sel?0:-1}" data-index="${i}">${t.label}</button>`).join("")}</div>
  ${items.map((t,i)=>`<div class="tabpanel" role="tabpanel" id="${id}-p${i}" aria-labelledby="${id}-t${i}"${i===sel?"":" hidden"}>${t.html}</div>`).join("")}</div>`;
}
function selectTab(btn){
  const box=btn.closest(".tabs"); const id=box.dataset.tabs; const idx=Number(btn.dataset.index);
  state.tabs[id]=idx;
  box.querySelectorAll('[role="tab"]').forEach((b,i)=>{b.setAttribute("aria-selected",String(i===idx));b.tabIndex=i===idx?0:-1;});
  box.querySelectorAll('[role="tabpanel"]').forEach((p,i)=>{p.hidden=i!==idx; if(i===idx){p.classList.remove("swap");void p.offsetWidth;p.classList.add("swap");}});
}

// ---- 날짜별 타임라인 (육상·해상) ----
function timeline(rows,cell){
  return `<div class="timeline" role="list">${groupByDate(rows).map(([date,items],i)=>`<article class="day" role="listitem" style="--i:${i}">
    <header><strong>${md(date)}</strong><span>발표일 +${esc(items[0].dayOffset)}일</span></header>
    <div class="periods${items.length===1?" single":""}">${items.map(cell).join("")}</div></article>`).join("")}</div>`;
}
function weatherLine(text){return `<div class="wx-line">${wxIcon(text,"lg")}<span class="wx-text">${showValue(text)}</span></div>`;}
function rainGauge(v){
  if(isMissing(v)) return '<div class="gauge"><span class="gauge-label missing">강수확률 미제공</span></div>';
  const tier=v>=60?"r2":v>=30?"r1":"r0";
  return `<div class="gauge ${tier}" role="img" aria-label="강수확률 ${esc(v)}%"><span class="gauge-label">${ui("drop")}${esc(v)}%</span><span class="gauge-track"><span class="gauge-fill" style="--v:${Math.max(0,Math.min(100,Number(v)))}%"></span></span></div>`;
}
const WAVE_SCALE=4;
function waveTier(max){return isMissing(max)?"":max>=3?"high":max>=1.5?"mid":"low";}
function waveBar(lo,hi){
  if(isMissing(lo)&&isMissing(hi)) return '<div class="wave-mini"><span class="missing">예상파고 미제공</span></div>';
  const scale=Math.max(WAVE_SCALE,Number(hi)||0,Number(lo)||0);
  const a=isMissing(lo)?Number(hi):Number(lo), b=isMissing(hi)?Number(lo):Number(hi);
  const label=`${isMissing(lo)?"미제공":lo}~${isMissing(hi)?"미제공":hi}m`;
  return `<div class="wave-mini ${waveTier(hi)}" role="img" aria-label="예상파고 ${esc(label)}"><span class="gauge-label">${ui("wave")}${esc(label)}</span>
    <span class="gauge-track"><span class="wave-fill" style="--a:${(a/scale*100).toFixed(1)}%;--b:${(Math.max(b-a,0.08)/scale*100).toFixed(1)}%"></span></span></div>`;
}

// ---- SVG 그래프: 결측값은 0으로 그리지 않고 '미제공'으로 표시한다(보간 없음) ----
function chartFrame({rows,min,max,series,unit="",axisTitle="",height=280,tip,defs=""}){
  if(!rows.length) return '<p class="missing">그래프에 표시할 값이 없습니다.</p>';
  const W=Math.max(680,rows.length*78),H=height,p={l:56,r:16,t:28,b:58},iw=W-p.l-p.r,ih=H-p.t-p.b,range=(max-min)||1;
  // 날짜마다 같은 폭의 칸을 두고 가운데에 그린다(양 끝 값이 축 글자와 겹치지 않게).
  const colW=iw/rows.length, x=i=>p.l+colW*(i+0.5), y=v=>p.t+(max-v)*ih/range;
  let grid=""; for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,yy=y(value);grid+=`<line class="grid-line" x1="${p.l}" y1="${yy}" x2="${W-p.r}" y2="${yy}"/><text class="axis-text" x="${p.l-8}" y="${yy+4}" text-anchor="end">${+value.toFixed(1)}${unit}</text>`;}
  const labels=rows.map((r,i)=>`<text class="axis-text" x="${x(i)}" y="${H-30}" text-anchor="middle">${esc(dateLabel(r.date))}</text><text class="axis-text" x="${x(i)}" y="${H-14}" text-anchor="middle">${esc(r.period||"")}</text>`).join("");
  const marks=series.map(s=>s.render({rows,x,y,min,max,H,W,p})).join("");
  const cols=tip?rows.map((r,i)=>`<g class="col"><line class="guide" x1="${x(i)}" y1="${p.t}" x2="${x(i)}" y2="${H-p.b}"/><rect class="hit" x="${x(i)-colW/2}" y="${p.t-10}" width="${colW}" height="${ih+20}" data-tip="${esc(tip(r))}"/></g>`).join(""):"";
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(axisTitle)} 그래프. 같은 값은 수치표 탭에서 볼 수 있습니다."><defs>${defs}</defs><text class="axis-title" x="${p.l-48}" y="14">${esc(axisTitle)}</text>${grid}${marks}${labels}${cols}</svg><div class="tip" hidden></div></div>`;
}
const missingMark=(x,y)=>`<text class="missing-mark" x="${x}" y="${y}" text-anchor="middle">미제공</text>`;
const barSeries=(key)=>({render:({rows,x,y,p,H})=>rows.map((r,i)=>{const v=r[key];if(isMissing(v))return missingMark(x(i),H-p.b-6);const yy=y(v),base=y(0);
  return `<g><rect class="bar grow ${v>=60?"r2":v>=30?"r1":"r0"}" style="--i:${i}" x="${x(i)-13}" y="${Math.min(yy,base-1)}" width="26" height="${Math.max(1,base-yy)}" rx="4"/><text class="val fade" style="--i:${i}" x="${x(i)}" y="${Math.min(yy,base-1)-6}" text-anchor="middle">${v}%</text></g>`;}).join("")});
const rangeSeries=(loKey,hiKey,unit,fill)=>({render:({rows,x,y,p,H})=>rows.map((r,i)=>{
  const lo=r[loKey],hi=r[hiKey];
  if(isMissing(lo)&&isMissing(hi)) return missingMark(x(i),H-p.b-6);
  if(isMissing(lo)||isMissing(hi)){const v=isMissing(lo)?hi:lo,cls=isMissing(lo)?"max":"min";return `<g><circle class="dot-${cls} fade" style="--i:${i}" cx="${x(i)}" cy="${y(v)}" r="5"/><text class="val fade" style="--i:${i}" x="${x(i)+10}" y="${y(v)+4}">${v}${unit}</text><text class="missing-mark" x="${x(i)}" y="${H-p.b-6}" text-anchor="middle">${cls==="min"?"최고 미제공":"최저 미제공"}</text></g>`;}
  const top=y(hi),bot=y(lo);
  return `<g><rect class="range grow-c" style="--i:${i}" x="${x(i)-11}" y="${top}" width="22" height="${Math.max(3,bot-top)}" rx="11" fill="url(#${fill})"/>
    <text class="val val-max fade" style="--i:${i}" x="${x(i)}" y="${top-8}" text-anchor="middle">${hi}${unit}</text>
    <text class="val val-min fade" style="--i:${i}" x="${x(i)}" y="${bot+17}" text-anchor="middle">${lo}${unit}</text></g>`;}).join("")});
function tableFor(rows,heads,values){return `<div class="table-scroll"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${values(r).map(v=>`<td>${isMissing(v)?'<span class="missing">미제공</span>':v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;}
const wxCell=(text)=>`<span class="wx-cell">${wxIcon(text,"sm")}${showValue(text)}</span>`;

// ---- 페이지별 렌더 ----
function render(result,opts={}){
  if(IS_GRID) renderShortPage(result);
  else if(page==="outlook")renderOutlook(result);else if(page==="land")renderLand(result);else if(page==="temperature")renderTemperature(result);else renderSea(result);
  const el=$("results");
  el.classList.remove("is-switching");
  if(opts.animate && !REDUCED){ el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); clearTimeout(state.enterTimer); state.enterTimer=setTimeout(()=>el.classList.remove("enter"),1800); el.querySelectorAll("[data-count]").forEach(countUp); }
  observeReveals(el, opts.animate);
}

// 원문에 이미 있는 날짜 표현만 굵게 표시한다(이스케이프한 뒤 적용). 문장은 바꾸지 않는다.
const BOLD_DATE=new RegExp(`(${OutlookParse.DEXPR})`,"g");
function highlight(escaped){ return escaped.replace(BOLD_DATE,'<strong class="dt">$1</strong>'); }

// ---- 중기전망: 3줄 요약(비·기온·해상) + 자세히 보기 ----
// 요약에는 원문에 적힌 날짜·지역·기온·파고만 옮긴다. 숫자와 지역 이름은 원문 글자 그대로이고, 월은 발표일과 요일로 확인한 값이다.
const dot='<span class="dot"> · </span>';
const segText=(s)=>`<span class="sg"><b>${esc(s.date)}</b>${s.place?` ${esc(s.place)}`:""}</span>`;
function sumRow(kind,icon,label,body){
  return `<div class="sum-row ${kind}"><span class="sum-ic">${ui(icon)}</span><span class="sum-label">${esc(label)}</span><div class="sum-body">${body}</div></div>`;
}
function summaryRows(topics){
  const rain=new Map(), temp=[], sea=[];
  topics.filter(t=>t.complete).forEach(t=>t.paragraphs.forEach(p=>p.rows.forEach(r=>{
    if(r.type==="rain"){ if(!rain.has(r.kind)) rain.set(r.kind,[]); rain.get(r.kind).push(r); }
    else if(r.type==="temp") temp.push(r); else if(r.type==="sea") sea.push(r);
  })));
  const out=[];
  rain.forEach((rows,kind)=>out.push(sumRow("rain","umbrella",kind,rows.map(r=>`<div class="sum-line">${r.segs.map(segText).join(dot)}</div>`).join(""))));
  if(temp.length) out.push(sumRow("temp","thermo","기온",temp.map(r=>`<div class="sum-temp"><b class="when">${esc(r.date)}</b><span class="vals">아침 <em class="am">${esc(r.am[0])}~${esc(r.am[1])}℃</em>${dot}낮 <em class="dy">${esc(r.day[0])}~${esc(r.day[1])}℃</em>${r.trend?`<small class="note">${esc(r.trend)}</small>`:""}</span></div>`).join("")));
  sea.forEach(r=>out.push(sumRow("sea","wave","해상",`<div class="sum-line">${r.segs.map(segText).join(dot)}</div><div class="sum-line">물결 <b>${esc(r.low)}~${esc(r.high)}m</b>${r.qualifier?` <small class="note inline">${esc(r.qualifier)}</small>`:""}</div>`)));
  return out;
}
function moreItem(title,flag,inner,open){
  return `<details class="ol-item"${open?" open":""}><summary><span class="ol-item-title">${esc(title)}${flag?'<span class="flag">유의</span>':""}</span><span class="ol-hint"><span class="when-closed">원문 보기</span><span class="when-open">원문 접기</span></span><i class="ol-caret" aria-hidden="true"></i></summary><div class="ol-text">${inner}</div></details>`;
}
function renderOutlook(r){
  const text=r.data?.text;
  let body;
  if(!text){ body='<section class="panel"><p class="missing">전망문(wfSv)이 제공되지 않았습니다.</p></section>'; }
  else{
    const topics=OutlookParse.analyze(text,r.requestedRelease);
    const rows=summaryRows(topics), hasSummary=rows.length>0;
    const names={}; topics.forEach(t=>{names[t.topic]=(names[t.topic]||0)+1;});
    const rest=topics.filter(t=>!t.complete||!hasSummary);
    const items=rest.map(t=>{
      // 같은 이름의 주제가 여럿이면 첫 날짜를 붙여 구분한다.
      const first=t.paragraphs.flatMap(p=>p.rows).find(x=>x.type==="dates")?.dates[0];
      const title=names[t.topic]>1&&first?`${t.topic} · ${first}`:t.topic;
      return moreItem(title,/변동|유의|주의/.test(t.topic),t.paragraphs.map(p=>`<p>${highlight(esc(p.text))}</p>`).join(""),!hasSummary);
    }).join("");
    const full=moreItem("기상청 원문 전체",false,`<p class="outlook-text">${esc(text)}</p>`,false);
    body=(hasSummary?`<section class="panel ol-sum reveal">${rows.join("")}</section>
      <p class="small">비·기온·해상은 기상청 원문에 적힌 값만 옮긴 요약입니다(날짜의 월은 발표일과 요일로 확인). 수치 그래프로 바꾸지 않았고, 아래에서 원문을 볼 수 있습니다.</p>`
      :'<p class="small">요약할 수 있는 문장 형태가 아니어서 원문을 그대로 표시합니다.</p>')
      +`<section class="panel ol-more reveal"><h3 class="ol-more-title">${ui("doc")}자세히 보기</h3>${items}${full}</section>`;
  }
  $("results").innerHTML=metaPanel(r)+body+rawDetails(r);
}
function renderLand(r){
  const rows=r.data||[];
  const cell=x=>`<div class="period"><span class="tag">${esc(x.period)}</span>${weatherLine(x.weather)}${rainGauge(x.rainProbability)}</div>`;
  const chart=chartFrame({rows,min:0,max:100,unit:"%",axisTitle:"강수확률(%)",series:[barSeries("rainProbability")],
    tip:x=>`${dateLabel(x.date)} ${x.period} · ${x.weather||"날씨 미제공"} · 강수확률 ${isMissing(x.rainProbability)?"미제공":x.rainProbability+"%"}`});
  const table=tableFor(rows,["날짜","구분","날씨","강수확률(%)"],x=>[esc(dateLabel(x.date)),esc(x.period),wxCell(x.weather),showValue(x.rainProbability,"%")]);
  $("results").innerHTML=metaPanel(r)+
  `<section class="panel reveal"><div class="panel-head"><div><p class="step">날짜별 예보</p><h2>날씨와 강수확률</h2></div>
    <div class="legend"><span><i class="rain"></i>강수확률(%) — 강수량(mm)이 아닙니다</span><span>4~7일 후 오전·오후 / 8~10일 후 하루 단위</span></div></div>
    ${rows.length?timeline(rows,cell):'<p class="missing">예보 데이터가 없습니다.</p>'}</section>
  <section class="panel reveal">${tabs("land-view",[{label:"강수확률 그래프",html:chart},{label:"수치표",html:table}])}</section>`+rawDetails(r);
}
function renderTemperature(r){
  const rows=r.data||[];const values=rows.flatMap(x=>[x.min,x.max]).filter(x=>!isMissing(x));
  // 눈금이 정수로 떨어지도록 범위를 4의 배수로 맞춘다.
  const min=values.length?Math.floor(Math.min(...values)-3):0,max=values.length?min+Math.ceil((Math.max(...values)+3-min)/4)*4:12;
  const defs='<linearGradient id="tgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef8b45"/><stop offset="1" stop-color="#2f86a6"/></linearGradient>';
  const chart=chartFrame({rows,min,max,unit:"℃",axisTitle:"예상기온(℃)",defs,series:[rangeSeries("min","max","℃","tgrad")],height:300,
    tip:x=>`${dateLabel(x.date)} · 예상 최저 ${isMissing(x.min)?"미제공":x.min+"℃"} · 예상 최고 ${isMissing(x.max)?"미제공":x.max+"℃"}`});
  const table=tableFor(rows,["날짜","발표일 기준","예상 최저기온(℃)","예상 최고기온(℃)"],x=>[esc(dateLabel(x.date)),`${Number(x.dayOffset)}일 후`,showValue(x.min,"℃"),showValue(x.max,"℃")]);
  $("results").innerHTML=metaPanel(r)+
  `<section class="panel reveal"><div class="panel-head"><div><p class="step">날짜별 예상기온</p><h2>하루 기온 범위</h2></div>
    <div class="legend"><span><i class="tband"></i>막대 아래 끝 = 예상 최저(taMinN), 위 끝 = 예상 최고(taMaxN)</span></div></div>
    ${tabs("temp-view",[{label:"기온 범위 그래프",html:chart},{label:"수치표",html:table}])}
    <p class="small">예보값이며 실제 관측 기온이 아닙니다. 응답의 Low·High 범위 필드(예: taMin5Low)는 절대 기온인지 기준값과의 차이인지 공식 자료로 확인하지 못해 그래프에 쓰지 않았습니다.</p></section>`+rawDetails(r);
}
function renderSea(r){
  const rows=r.data||[];const values=rows.flatMap(x=>[x.waveMin,x.waveMax]).filter(x=>!isMissing(x)),max=values.length?Math.max(4,Math.ceil((Math.max(...values)+0.5)/2)*2):4;
  const cell=x=>`<div class="period"><span class="tag">${esc(x.period)}</span>${weatherLine(x.weather)}${waveBar(x.waveMin,x.waveMax)}</div>`;
  const defs='<linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#104b60"/><stop offset="1" stop-color="#7cc7d8"/></linearGradient>';
  const chart=chartFrame({rows,min:0,max,unit:"m",axisTitle:"예상파고(m)",defs,series:[rangeSeries("waveMin","waveMax","m","wgrad")],
    tip:x=>`${dateLabel(x.date)} ${x.period} · ${x.weather||"날씨 미제공"} · 예상파고 ${isMissing(x.waveMin)?"미제공":x.waveMin}~${isMissing(x.waveMax)?"미제공":x.waveMax}m`});
  const table=tableFor(rows,["날짜","구분","날씨","최저 예상파고(m)","최고 예상파고(m)"],x=>[esc(dateLabel(x.date)),esc(x.period),wxCell(x.weather),showValue(x.waveMin,"m"),showValue(x.waveMax,"m")]);
  $("results").innerHTML=metaPanel(r)+
  `<section class="panel reveal"><div class="panel-head"><div><p class="step">날짜별 예보</p><h2>날씨와 예상파고</h2></div>
    <div class="legend"><span><i class="wlow"></i>1.5m 미만</span><span><i class="wmid"></i>1.5~3m 미만</span><span><i class="whigh"></i>3m 이상</span><span>(이 앱의 표시 구분 · 공식 특보 기준 아님)</span></div></div>
    ${rows.length?timeline(rows,cell):'<p class="missing">예보 데이터가 없습니다.</p>'}</section>
  <section class="panel reveal">${tabs("sea-view",[{label:"파고 범위 그래프",html:chart},{label:"수치표",html:table}])}</section>`+rawDetails(r);
}

// ---- 효과 보조 함수 ----
function countUp(el){
  const raw=el.dataset.count, target=Number(raw); if(!Number.isFinite(target)) return;
  const dec=(raw.split(".")[1]||"").length, start=performance.now(), dur=650;
  const step=(now)=>{const t=Math.min(1,(now-start)/dur), e=1-Math.pow(1-t,3); el.textContent=(target*e).toFixed(dec); if(t<1) requestAnimationFrame(step); else el.textContent=raw;};
  requestAnimationFrame(step);
}
let revealObserver=null;
function observeReveals(root,animate){
  const items=root.querySelectorAll(".reveal");
  if(!animate || REDUCED || !("IntersectionObserver" in window)){ items.forEach(n=>n.classList.add("in")); return; }
  revealObserver?.disconnect();
  revealObserver=new IntersectionObserver(entries=>entries.forEach(en=>{if(en.isIntersecting){en.target.classList.add("in");revealObserver.unobserve(en.target);}}),{threshold:0});
  items.forEach(n=>revealObserver.observe(n));
  // 안전장치: 관찰이 늦어도 내용이 숨겨진 채 남지 않게 한다.
  clearTimeout(state.revealTimer); state.revealTimer=setTimeout(()=>root.querySelectorAll(".reveal:not(.in)").forEach(n=>n.classList.add("in")),1200);
}
function flashNewBadge(){const b=$("new-badge"); if(!b) return; b.classList.remove("hidden"); clearTimeout(state.badgeTimer); state.badgeTimer=setTimeout(()=>b.classList.add("hidden"),8000);}
function setupInteractions(){
  document.addEventListener("click",e=>{const t=e.target.closest('.tabs [role="tab"]'); if(t) selectTab(t);});
  document.addEventListener("keydown",e=>{const t=e.target.closest?.('.tabs [role="tab"]'); if(!t||!["ArrowLeft","ArrowRight"].includes(e.key)) return;
    const all=[...t.parentElement.querySelectorAll('[role="tab"]')]; const n=all[(all.indexOf(t)+(e.key==="ArrowRight"?1:all.length-1))%all.length]; n.focus(); selectTab(n);});
  // 그래프 값 확인: 날짜 열에 마우스를 올리거나 터치하면 안내선과 말풍선을 보여 준다.
  const showTip=(e)=>{const hit=e.target.closest?.(".hit"); if(!hit) return; const wrap=hit.closest(".chart-wrap"), tip=wrap.querySelector(".tip");
    const wr=wrap.getBoundingClientRect(), hr=hit.getBoundingClientRect(); tip.textContent=hit.dataset.tip; tip.hidden=false;
    const left=hr.left-wr.left+wrap.scrollLeft+hr.width/2; tip.style.left=`${Math.max(70+wrap.scrollLeft,Math.min(left,wrap.scrollLeft+wr.width-70))}px`; tip.style.top=`${Math.max(4,e.clientY-wr.top-54)}px`;};
  document.addEventListener("pointermove",showTip); document.addEventListener("pointerdown",showTip);
  document.addEventListener("pointerout",e=>{const hit=e.target.closest?.(".hit"); if(hit && !hit.contains(e.relatedTarget)){const tip=hit.closest(".chart-wrap").querySelector(".tip"); tip.hidden=true;}});
  // 스크롤하면 상단 메뉴만 반투명 유리 효과로 바뀐다.
  const header=document.querySelector(".site-header"); const onScroll=()=>header.classList.toggle("scrolled",window.scrollY>8);
  window.addEventListener("scroll",onScroll,{passive:true}); onScroll();
}

const CHAT_STORE="kma-chat-v1", CHAT_PENDING="kma-chat-pending-v1";
let chatComposing=false;
function chatHistory(){try{return JSON.parse(sessionStorage.getItem(CHAT_STORE)||"[]").filter(x=>x&&["user","assistant"].includes(x.role)&&typeof x.text==="string").slice(-20);}catch{return[];}}
function saveChat(items){sessionStorage.setItem(CHAT_STORE,JSON.stringify(items.slice(-20)));}
function addChat(role,text,extra=""){
  const items=chatHistory(); items.push({role,text:String(text).slice(0,4000)}); saveChat(items);
  const el=document.createElement("div"); el.className=`chat-message ${role}${extra?` ${extra}`:""}`; el.textContent=text;
  $("chat-messages").appendChild(el); $("chat-messages").scrollTop=$("chat-messages").scrollHeight; return el;
}
function restoreChat(){
  const items=chatHistory(); $("chat-messages").textContent="";
  if(!items.length)addChat("assistant","안녕하세요. 페이지 이동, 지역·발표시각 선택, 예보 조회와 현재 자료 설명을 도와드릴게요.");
  else items.forEach(x=>{const el=document.createElement("div");el.className=`chat-message ${x.role}`;el.textContent=x.text;$("chat-messages").appendChild(el);});
  $("chat-messages").scrollTop=$("chat-messages").scrollHeight;
}
function openChat(open=true){$("chat-panel").classList.toggle("hidden",!open);$("chat-open").classList.toggle("hidden",open);$("chat-open").setAttribute("aria-expanded",String(open));if(open)$("chat-input").focus();}
function setChatBusy(value){state.chatBusy=value;$("chat-send").disabled=value;$("chat-input").disabled=value;}
function chatContext(){return {page,region:$("region").value,publication:$("release").value};}
async function sendChat(text){
  text=text.trim(); if(!text||state.chatBusy)return; addChat("user",text); $("chat-input").value=""; setChatBusy(true);
  const thinking=document.createElement("div");thinking.className="chat-message assistant";thinking.innerHTML='<span class="chat-thinking" aria-label="응답 생성 중"><i></i><i></i><i></i></span>';$("chat-messages").appendChild(thinking);
  try{
    const history=chatHistory().slice(0,-1).slice(-8); const response=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({message:text,context:chatContext(),history})});
    const body=await response.json().catch(()=>({})); if(!response.ok)throw Object.assign(new Error(body.error?.message||`챗봇 오류 (${response.status})`),{info:body.error||{}});
    thinking.remove(); addChat("assistant",body.reply||"요청을 확인했습니다."); if(body.action)await executeChatAction(body.action);
  }catch(error){thinking.remove();addChat("assistant",error.message||"챗봇 요청에 실패했습니다.","error");}
  finally{setChatBusy(false);}
}
async function executeChatAction(action){
  const name=action?.name,args=action?.args||{};
  if(name==="navigate_page"){
    if(!CONFIG[args.page])throw new Error("허용되지 않은 페이지입니다.");
    if(args.page===page){addChat("assistant",`${CONFIG[page].title} 페이지가 이미 열려 있습니다.`);return;}
    sessionStorage.setItem(CHAT_PENDING,JSON.stringify(action));location.href=`/${args.page}`;return;
  }
  if(name==="select_region"){
    if(!CONFIG[args.page])throw new Error("허용되지 않은 페이지입니다.");
    if(args.page!==page){sessionStorage.setItem(CHAT_PENDING,JSON.stringify(action));location.href=`/${args.page}`;return;}
    if(!state.regions.some(r=>r.code===args.region_code))throw new Error("이 페이지에서 선택할 수 없는 지역입니다.");
    $("region").value=args.region_code;saveRegion(args.region_code);state.lastGood=null;updateRegionDetail();await refresh(true);addChat("assistant",`${state.regions.find(r=>r.code===args.region_code)?.name||args.region_code} 예보를 조회했습니다.`);return;
  }
  if(name==="select_publication"){
    if(!Array.from($("release").options).some(o=>o.value===args.publication))throw new Error("최근 24시간에 제공되는 발표본이 아닙니다.");
    $("release").value=args.publication;state.releaseChosenByUser=true;state.lastGood=null;await refresh(true);addChat("assistant",`${releaseLabel(args.publication)} 발표본을 조회했습니다.`);return;
  }
  if(name==="refresh_forecast"){await refresh(true);addChat("assistant","현재 선택 조건의 예보를 다시 확인했습니다.");return;}
  throw new Error("허용되지 않은 챗봇 동작입니다.");
}
function preparePendingAction(){
  try{const action=JSON.parse(sessionStorage.getItem(CHAT_PENDING)||"null");if(action?.name==="select_region"&&action.args?.page===page&&state.regions.some(r=>r.code===action.args.region_code)){$("region").value=action.args.region_code;saveRegion(action.args.region_code);}}catch{}
}
function finishPendingAction(){
  try{const action=JSON.parse(sessionStorage.getItem(CHAT_PENDING)||"null");if(!action)return;if(action.name==="navigate_page"&&action.args?.page===page)addChat("assistant",`${CONFIG[page].title} 페이지로 이동했습니다.`);else if(action.name==="select_region"&&action.args?.page===page){const r=state.regions.find(x=>x.code===action.args.region_code);addChat("assistant",`${r?.name||action.args.region_code} 지역을 선택하고 예보를 조회했습니다.`);}else return;sessionStorage.removeItem(CHAT_PENDING);openChat(true);}catch{sessionStorage.removeItem(CHAT_PENDING);}
}
function setupChat(){
  restoreChat();$("chat-model").textContent=state.status?.geminiStatus==="configured"?`${state.status.geminiModel} · 서버 연결`:"Gemini 키 설정 필요";
  $("chat-open").addEventListener("click",()=>openChat(true));$("chat-close").addEventListener("click",()=>openChat(false));
  $("chat-reset").addEventListener("click",()=>{sessionStorage.removeItem(CHAT_STORE);sessionStorage.removeItem(CHAT_PENDING);restoreChat();});
  $("chat-form").addEventListener("submit",e=>{e.preventDefault();sendChat($("chat-input").value);});
  $("chat-input").addEventListener("compositionstart",()=>chatComposing=true);$("chat-input").addEventListener("compositionend",()=>chatComposing=false);
  $("chat-input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing&&!chatComposing){e.preventDefault();$("chat-form").requestSubmit();}});
  document.querySelectorAll(".chat-suggestions button").forEach(b=>b.addEventListener("click",()=>sendChat(b.textContent)));
}

initialize().finally(setupChat);
