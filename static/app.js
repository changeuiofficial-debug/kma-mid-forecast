"use strict";

// 브라우저는 이 로컬 서버(/api/...)에만 요청한다. 인증키는 서버에만 있다.
const PAGE_BY_PATH = {"/":"outlook","/outlook":"outlook","/land":"land","/temperature":"temperature","/sea":"sea"};
const CONFIG = {
  outlook:{name:"getMidFcst",title:"중기전망",codeName:"지점번호 stnId",description:"권역별 서술형 기상전망(wfSv) 원문과 조회에 사용한 발표 정보를 확인합니다. 전망문은 수치 그래프로 바꾸지 않습니다."},
  land:{name:"getMidLandFcst",title:"중기육상예보",codeName:"육상 예보구역코드 regId",description:"날짜별 날씨와 강수확률(%)을 카드, 그래프, 표로 확인합니다. 4~7일 후는 오전·오후, 8~10일 후는 하루 단위입니다."},
  temperature:{name:"getMidTa",title:"중기기온",codeName:"기온 예보구역코드 regId",description:"첨부 Excel의 상세 기온 지점별 예상 최저·최고기온(℃)을 두 개의 선과 수치표로 비교합니다."},
  sea:{name:"getMidSeaFcst",title:"중기해상예보",codeName:"해상 예보구역코드 regId",description:"해역별 날씨와 최저·최고 예상파고(m) 범위를 확인합니다. 육상 지역과 자동으로 연결하지 않습니다."}
};
const page = PAGE_BY_PATH[location.pathname] || "outlook";
const REFRESH_SECONDS = 30;
const $ = (id) => document.getElementById(id);
const state = {regions:[], seconds:REFRESH_SECONDS, timer:null, status:null, busy:false, chatBusy:false,
  autoEnabled:true, lastGood:null, releaseChosenByUser:false, fallbackFrom:null};
// API에서 받은 문자열은 항상 이스케이프한 뒤 화면에 넣는다(HTML로 실행되지 않음).
const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const isMissing = (v) => v === null || v === undefined || v === "";
const showValue = (v, unit="") => isMissing(v) ? '<span class="missing">미제공</span>' : `${esc(v)}${unit}`;
const dateLabel = (iso) => new Intl.DateTimeFormat("ko-KR",{month:"numeric",day:"numeric",weekday:"short",timeZone:"Asia/Seoul"}).format(new Date(`${iso}T12:00:00+09:00`));
const releaseLabel = (v) => `${v.slice(0,4)}.${v.slice(4,6)}.${v.slice(6,8)} ${v.slice(8,10)}:${v.slice(10,12)} KST`;
const timeLabel = (sec) => sec ? new Date(sec*1000).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "—";

async function getJSON(url){
  let response;
  try{ response = await fetch(url,{headers:{Accept:"application/json"},cache:"no-store"}); }
  catch(_){ const e = new Error("로컬 서버에 연결할 수 없습니다. 서버실행.cmd 창(또는 python server.py 터미널)이 열려 있는지 확인해 주세요."); e.info={code:"local_server_down"}; throw e; }
  const body = await response.json().catch(() => ({}));
  if(!response.ok){const e = new Error(body.error?.message || `서버 오류 (${response.status})`); e.info=body.error||{}; throw e;}
  return body;
}

function setupPage(){
  const cfg=CONFIG[page]; document.title=`${cfg.title} | 기상청 중기예보`;
  $("feature-name").textContent=cfg.name; $("page-title").textContent=cfg.title; $("page-description").textContent=cfg.description;
  document.querySelectorAll("nav a").forEach(a=>{if(a.dataset.page===page){a.classList.add("active");a.setAttribute("aria-current","page");}});
}

async function initialize(){
  setupPage();
  try{
    const [status,regions]=await Promise.all([getJSON("/api/status"),getJSON("/api/regions")]);
    state.status=status; state.regions=regions[page];
    fillRegions(); fillReleases(status.releaseCandidates); updateKeyAlert(status); updateUsage(status.usage,status.warning); updateAdminAlert(status);
    $("region").addEventListener("change",()=>{saveRegion($("region").value); updateRegionDetail(); state.lastGood=null; clearStatus(); resetRelease(); refresh(true);});
    $("release").addEventListener("change",()=>{state.releaseChosenByUser=true; state.lastGood=null; clearStatus(); refresh(true);});
    $("refresh").addEventListener("click",()=>refresh(true));
    document.addEventListener("visibilitychange",()=>{ if(!document.hidden && state.autoEnabled && state.seconds<=0) refresh(false); });
    window.addEventListener("pagehide",()=>{ clearInterval(state.timer); state.timer=null; });
    state.autoEnabled = status.keyStatus==="configured";
    state.timer=setInterval(tick,1000); preparePendingAction(); updateRegionDetail();
    if(state.autoEnabled){ await refresh(false); }
    else { $("status-countdown").textContent="인증키 설정 후 시작"; renderKeyNeeded(status); }
    finishPendingAction();
  }catch(error){ showMessage(error.message,"error"); $("status-countdown").textContent="중지됨"; }
}

function saveRegion(code){ try{ localStorage.setItem(`kma-region-${page}`,code); }catch(_){} }
function loadRegion(){ try{ return localStorage.getItem(`kma-region-${page}`); }catch(_){ return null; } }
function fillRegions(){
  const saved=loadRegion();
  $("region").innerHTML=state.regions.map(r=>`<option value="${esc(r.code)}">${esc(r.name)} (${esc(r.code)})</option>`).join("");
  if(state.regions.some(r=>r.code===saved)) $("region").value=saved;
}
function fillReleases(values){
  $("release").innerHTML=values.map((v,i)=>`<option value="${v}">${i===0?"최신 후보 · ":"이전 발표 · "}${releaseLabel(v)} (${v.slice(8,10)==="06"?"4~10일 후":"5~10일 후"})</option>`).join("");
}
function resetRelease(){ if(!state.releaseChosenByUser) $("release").selectedIndex=0; state.fallbackFrom=null; }
function updateRegionDetail(){
  const r=state.regions.find(x=>x.code===$("region").value); if(!r) return;
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
  $("results").innerHTML=`<section class="panel"><h2>아직 조회할 수 없습니다</h2><p>서버에 인증키가 없어서 기상청 API를 호출하지 않았습니다. 지역·발표시각 선택과 화면 구조는 그대로 사용할 수 있습니다.</p>
  <ol class="steps"><li>공공데이터포털에서 ‘기상청_중기예보 조회서비스’ 활용신청 후 일반 인증키를 발급받습니다.</li>
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
  state.seconds=Math.max(0,state.seconds-1); $("status-countdown").textContent=`${state.seconds}초 후`;
  if(state.seconds===0) refresh(false);
}
function showMessage(text,type="warning"){const el=$("message"); el.className=`alert ${type}`; el.textContent=text;}
function hideMessage(){$("message").className="alert hidden";}
// 다음 자동 확인 시각. 서버가 알려 준 대기 시간(retryAfter)이 있으면 그 값을 따른다.
function schedule(seconds,floor=REFRESH_SECONDS){ state.seconds=Math.min(Math.max(floor,Number(seconds)||REFRESH_SECONDS),3600); }
function clearStatus(){ ["status-release","status-success","status-checked","status-source"].forEach(id=>$(id).textContent="—"); }

const WAIT_CODES = new Set(["cooldown","backoff","inflight_failed"]);
async function refresh(manual){
  if(state.busy||(document.hidden&&!manual)) return;
  state.busy=true; $("refresh").disabled=true;
  const feature=encodeURIComponent(page), region=encodeURIComponent($("region").value), tmFc=encodeURIComponent($("release").value);
  try{
    const body=await getJSON(`/api/forecast?feature=${feature}&region=${region}&tmFc=${tmFc}`);
    const result=body.result, meta=body.meta;
    state.lastGood={result,meta};
    render(result); updateMeta(result,meta); hideMessage();
    const hasData=page==="outlook"?Boolean(result.data?.text):Array.isArray(result.data)&&result.data.length>0;
    if(!hasData && tryOlderRelease("최신 발표 후보에 예보 값이 없어", meta.retryAfter)) return;
    if(meta.cache.startsWith("stale")){
      const why={stale_cooldown:"다른 조회와의 30초 호출 간격을 지키는 중이라",stale_backoff:"이전 오류로 재시도 간격을 늘리는 중이라",
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
      if(!state.lastGood) $("results").innerHTML=`<section class="panel loading"><h2>조회 대기 중</h2><p>이 앱은 네 기능을 합쳐 기상청 API를 30초에 한 번만 호출합니다. 순서가 되면 자동으로 표시됩니다.</p></section>`;
      schedule(sec,3); return;
    }
    const prefix={provider_auth:"[인증·활용신청 오류] ",provider_limit:"[제공기관 호출 제한] ",provider_limit_halt:"[외부 호출 중지] ",app_limit:"[앱 호출 상한] ",
      network:"[네트워크·제공기관 연결 오류] ",local_server_down:"[로컬 서버 연결 실패] ",no_data:"[데이터 없음] ",invalid_response:"[응답 형식 오류] "}[code]||(code.startsWith("key_")?"[인증키 미설정] ":"");
    if(state.lastGood){ showMessage(`${prefix}${error.message} 아래는 이전 정상 자료입니다(기상청 마지막 성공 조회: ${timeLabel(state.lastGood.meta.fetchedAt)}).`,"error"); markStale(); }
    else { showMessage(prefix+error.message,"error"); $("results").innerHTML=`<section class="panel"><h2>데이터를 표시할 수 없습니다</h2><p>${esc(prefix+error.message)}</p></section>`; }
    if(code==="local_server_down"){ $("status-countdown").textContent="서버 연결 끊김"; }
    schedule(error.info?.retryAfter);
  }finally{
    state.busy=false; $("refresh").disabled=false;
    getJSON("/api/status").then(s=>{state.status=s; updateUsage(s.usage,s.warning); updateAdminAlert(s);}).catch(()=>{});
  }
}
function tryOlderRelease(reason, retryAfter){
  const sel=$("release");
  if(state.releaseChosenByUser || sel.selectedIndex!==0 || sel.options.length<2) return false;
  state.fallbackFrom=sel.value; sel.selectedIndex=1; state.lastGood=null;
  const sec=Math.max(REFRESH_SECONDS,Number(retryAfter)||REFRESH_SECONDS); schedule(sec);
  showMessage(`${reason} 최근 24시간 이내의 이전 발표본(${releaseLabel(sel.value)})을 약 ${sec}초 후 확인합니다.`,"info");
  return true;
}
function markStale(){ const head=document.querySelector("#results .panel"); if(head && !head.querySelector(".stale-badge")) head.insertAdjacentHTML("afterbegin",'<span class="badge stale-badge">이전 자료</span>'); }
function updateMeta(result,meta){
  $("status-release").textContent=releaseLabel(result.requestedRelease);
  $("status-success").textContent=timeLabel(meta.fetchedAt);
  $("status-checked").textContent=new Date(meta.checkedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});
  $("status-source").textContent={network:"기상청 API 새 조회",fresh:"서버 캐시(30초 이내)",shared:"동시 요청 공유"}[meta.cache]||"서버 캐시(이전 자료)";
  updateUsage(meta.usage,meta.warning);
}

function metaPanel(result){
  const selected=state.regions.find(r=>r.code===result.requestedCode);
  const compare={match:"요청·응답 코드 일치",mismatch:"요청·응답 코드 불일치",not_returned:"응답에 코드 없음 · 비교 불가"}[result.codeComparison];
  const rows=Array.isArray(result.data)?result.data:[];
  const dates=[...new Set(rows.map(r=>r.date))];
  const period=dates.length?`${dateLabel(dates[0])} ~ ${dateLabel(dates[dates.length-1])} (${dates.length}일)`:"—";
  const counts=Array.isArray(result.data)?`<li>API totalCount <b>${esc(result.totalCount)}</b>건 → 한 항목 안의 날짜별 필드를 펼쳐 <b>${rows.length}</b>개 행으로 표시 (두 수는 다를 수 있습니다)</li>`:"";
  return `<section class="panel"><div class="panel-head"><div><p class="step">조회 결과</p><h2>${esc(selected?.name||result.requestedCode)}</h2>
  <p>${esc(CONFIG[page].codeName)} <span class="code">${esc(result.requestedCode)}</span> · ${esc(selected?.scope||"")}</p></div>
  <span class="badge ${result.codeComparison==="mismatch"?"bad":""}">${compare}</span></div>
  <ul class="facts"><li>요청에 사용한 발표시각(tmFc) <b>${esc(releaseLabel(result.requestedRelease))}</b> — 응답에는 발표시각 필드가 없어 요청값을 별도로 보관한 것입니다.</li>
  ${Array.isArray(result.data)?`<li>실제 응답의 예보 기간: <b>${esc(period)}</b> (가이드 기준 06시 발표 4~10일 후, 18시 발표 5~10일 후)</li>`:""}${counts}
  <li>제공기관 결과코드 ${esc(result.providerResult?.code||"—")} ${esc(result.providerResult?.message||"")}</li></ul>`;
}
function rawDetails(result){return `<details><summary>제공기관 원문 필드 보기</summary><pre>${esc(JSON.stringify(result.rawItem,null,2))}</pre></details></section>`;}
function render(result){if(page==="outlook")renderOutlook(result);else if(page==="land")renderLand(result);else if(page==="temperature")renderTemperature(result);else renderSea(result);}
function renderOutlook(r){
  const text=r.data?.text;
  const paragraphs=text?text.split(/\n+/).map(line=>line.trim()).filter(Boolean).map(line=>`<p>${esc(line)}</p>`).join(""):'<p class="missing">전망문(wfSv)이 제공되지 않았습니다.</p>';
  $("results").innerHTML=metaPanel(r)+`<div class="outlook-text">${paragraphs}</div><p class="small">전망문은 원문 그대로 줄 단위로만 나누어 표시하며, 원문에 없는 수치를 만들거나 그래프로 바꾸지 않습니다.</p>${rawDetails(r)}`;
}

// ---- 그래프: SVG로 직접 그린다. 결측값은 0으로 그리지 않고 선을 끊는다(보간 없음). ----
function chartFrame({rows,min,max,series,unit="",axisTitle="",height=280}){
  if(!rows.length) return '<p class="missing">그래프에 표시할 값이 없습니다.</p>';
  const W=Math.max(680,rows.length*78),H=height,p={l:56,r:44,t:28,b:58},iw=W-p.l-p.r,ih=H-p.t-p.b,range=(max-min)||1;
  const x=i=>p.l+(rows.length===1?iw/2:i*iw/(rows.length-1)), y=v=>p.t+(max-v)*ih/range;
  let grid=""; for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,yy=y(value);grid+=`<line class="grid-line" x1="${p.l}" y1="${yy}" x2="${W-p.r}" y2="${yy}"/><text class="axis-text" x="${p.l-8}" y="${yy+4}" text-anchor="end">${+value.toFixed(1)}${unit}</text>`;}
  const labels=rows.map((r,i)=>`<text class="axis-text" x="${x(i)}" y="${H-30}" text-anchor="middle">${esc(dateLabel(r.date))}</text><text class="axis-text" x="${x(i)}" y="${H-14}" text-anchor="middle">${esc(r.period||"")}</text>`).join("");
  const marks=series.map(s=>s.render({rows,x,y,min,max,H,W,p})).join("");
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s=>s.label).join(", "))} 그래프 (단위 ${esc(unit)})"><text class="axis-title" x="${p.l-44}" y="14">${esc(axisTitle)}</text>${grid}${marks}${labels}</svg></div>`;
}
const missingMark=(x,y)=>`<text class="missing-mark" x="${x}" y="${y}" text-anchor="middle">미제공</text>`;
const lineSeries=(key,label,cls,unit)=>({label,render:({rows,x,y,p,H})=>{
  let segments=[],current=[],gaps="";
  rows.forEach((r,i)=>{const v=r[key];if(isMissing(v)){if(current.length)segments.push(current);current=[];gaps+=cls==="min"?missingMark(x(i),H-p.b-6):"";}else current.push([x(i),y(v),v,r]);});
  if(current.length)segments.push(current);
  return segments.map(seg=>`<polyline class="line-${cls}" points="${seg.map(q=>`${q[0]},${q[1]}`).join(" ")}"/>${seg.map(q=>`<g class="pt"><circle class="dot-${cls}" cx="${q[0]}" cy="${q[1]}" r="5"><title>${esc(dateLabel(q[3].date))} ${label} ${q[2]}${unit}</title></circle><text class="val val-${cls}" x="${q[0]}" y="${q[1]+(cls==="min"?18:-10)}" text-anchor="middle">${q[2]}</text></g>`).join("")}`).join("")+gaps;}});
const barSeries=(key,label)=>({label,render:({rows,x,y,p,H})=>rows.map((r,i)=>{const v=r[key];if(isMissing(v))return missingMark(x(i),H-p.b-6);const yy=y(v),base=y(0);return `<g class="pt"><rect class="bar" x="${x(i)-13}" y="${Math.min(yy,base-1)}" width="26" height="${Math.max(1,base-yy)}" rx="3"><title>${esc(dateLabel(r.date))} ${esc(r.period)} ${label} ${v}%</title></rect><text class="val" x="${x(i)}" y="${Math.min(yy,base-1)-6}" text-anchor="middle">${v}%</text></g>`;}).join("")});

function groupByDate(rows){const map=new Map();rows.forEach(r=>{if(!map.has(r.date))map.set(r.date,[]);map.get(r.date).push(r);});return [...map.entries()];}
function renderLand(r){
  const rows=r.data||[];
  const cards=groupByDate(rows).map(([date,items])=>`<article class="weather-card"><span class="date">${esc(dateLabel(date))} · 발표일 기준 ${esc(items[0].dayOffset)}일 후</span>${items.map(x=>`<div class="period-row"><span class="tag">${esc(x.period)}</span><strong>${showValue(x.weather)}</strong><span class="metric">강수확률 ${showValue(x.rainProbability,"%")}</span></div>`).join("")}</article>`).join("");
  const chart=chartFrame({rows,min:0,max:100,unit:"%",axisTitle:"강수확률(%)",series:[barSeries("rainProbability","강수확률")]});
  const table=tableFor(rows,["날짜","구분","날씨","강수확률(%)"],x=>[esc(dateLabel(x.date)),esc(x.period),showValue(x.weather),showValue(x.rainProbability,"%")]);
  $("results").innerHTML=metaPanel(r)+`<div class="cards">${cards||'<p class="missing">예보 데이터가 없습니다.</p>'}</div>${rawDetails(r)}
  <section class="panel"><div class="panel-head"><div><p class="step">강수확률</p><h2>날짜별 강수확률 (%)</h2></div></div>
  <div class="legend"><span><i class="rain"></i>강수확률(비·눈이 올 가능성, %)</span><span>강수량(mm)이 아닙니다 · 값이 없으면 ‘미제공’</span></div>${chart}</section>
  <section class="panel"><h2>예보 수치표</h2>${table}</section>`;
}
function renderTemperature(r){
  const rows=r.data||[];const values=rows.flatMap(x=>[x.min,x.max]).filter(x=>!isMissing(x));
  // 눈금이 정수로 떨어지도록 범위를 4의 배수로 맞춘다.
  const min=values.length?Math.floor(Math.min(...values)-2):0,max=values.length?min+Math.ceil((Math.max(...values)+2-min)/4)*4:12;
  const chart=chartFrame({rows,min,max,unit:"℃",axisTitle:"예상기온(℃)",series:[lineSeries("min","예상 최저기온","min","℃"),lineSeries("max","예상 최고기온","max","℃")]});
  const table=tableFor(rows,["날짜","발표일 기준","예상 최저기온(℃)","예상 최고기온(℃)"],x=>[esc(dateLabel(x.date)),`${Number(x.dayOffset)}일 후`,showValue(x.min,"℃"),showValue(x.max,"℃")]);
  $("results").innerHTML=metaPanel(r)+`<div class="legend"><span><i class="min"></i>예상 최저기온(taMinN)</span><span><i class="max"></i>예상 최고기온(taMaxN)</span></div>${chart}
  <p class="small">예보값이며 실제 관측 기온이 아닙니다. 응답의 Low·High 범위 필드(예: taMin5Low)는 절대 기온인지 기준값과의 차이인지 공식 자료로 확인하지 못해 그래프에 쓰지 않았습니다. 원문 필드에서 확인할 수 있습니다.</p>${rawDetails(r)}
  <section class="panel"><h2>예상기온 수치표</h2>${table}</section>`;
}
function renderSea(r){
  const rows=r.data||[];const values=rows.flatMap(x=>[x.waveMin,x.waveMax]).filter(x=>!isMissing(x)),max=values.length?Math.max(4,Math.ceil((Math.max(...values)+0.5)/4)*4):4;
  const wave={label:"예상파고 범위",render:({rows,x,y,p,H})=>rows.map((v,i)=>{
    const lo=!isMissing(v.waveMin), hi=!isMissing(v.waveMax);
    if(!lo&&!hi) return missingMark(x(i),H-p.b-6);
    const title=`${dateLabel(v.date)} ${v.period} 최저 ${lo?v.waveMin+"m":"미제공"} · 최고 ${hi?v.waveMax+"m":"미제공"}`;
    return `<g class="pt"><title>${esc(title)}</title>${lo&&hi?`<line class="wave-range" x1="${x(i)}" y1="${y(v.waveMin)}" x2="${x(i)}" y2="${y(v.waveMax)}"/>`:""}${lo?`<circle class="dot-min" cx="${x(i)}" cy="${y(v.waveMin)}" r="5"/><text class="val val-min" x="${x(i)+10}" y="${y(v.waveMin)+4}">${v.waveMin}</text>`:""}${hi?`<circle class="dot-max" cx="${x(i)}" cy="${y(v.waveMax)}" r="5"/><text class="val val-max" x="${x(i)+10}" y="${y(v.waveMax)+4}">${v.waveMax}</text>`:""}</g>`;}).join("")};
  const chart=chartFrame({rows,min:0,max,unit:"m",axisTitle:"예상파고(m)",series:[wave]});
  const table=tableFor(rows,["날짜","구분","날씨","최저 예상파고(m)","최고 예상파고(m)"],x=>[esc(dateLabel(x.date)),esc(x.period),showValue(x.weather),showValue(x.waveMin,"m"),showValue(x.waveMax,"m")]);
  $("results").innerHTML=metaPanel(r)+`<div class="legend"><span><i class="min"></i>최저 예상파고(whNA…)</span><span><i class="max"></i>최고 예상파고(whNB…)</span><span><i class="range"></i>최저~최고 범위</span></div>${chart}${rawDetails(r)}
  <section class="panel"><h2>해상예보 수치표</h2>${table}</section>`;
}
function tableFor(rows,heads,values){return `<div class="table-scroll"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${values(r).map(v=>`<td>${isMissing(v)?'<span class="missing">미제공</span>':v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;}

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
