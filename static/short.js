"use strict";

// 단기예보 서비스 3개 페이지(현재 날씨 /now, 6시간 예보 /ultra, 단기예보 /short)의 화면.
// app.js의 공용 함수(esc, showValue, ui, tabs, rainGauge, tableFor, fmtDate 등)를 쓴다.
// 원칙: 응답에 있는 값만 그린다. 없는 값은 '미제공', 유효한 0은 그대로 보여 주고, 빠진 시각은 보간하지 않는다.

const PTY_KIND={1:"rain",2:"sleet",3:"snow",4:"shower",5:"rain",6:"sleet",7:"snow"};
const SKY_KIND={1:"clear",3:"partly",4:"overcast"};
// 하늘상태(SKY)·강수형태(PTY) 코드로 아이콘을 고른다. 하늘상태가 없는 실황은 강수가 있을 때만 구름+강수 아이콘을 쓴다.
function wxCodeIcon(sky,pty,size=""){
  const pcp=PTY_KIND[pty]||null, base=SKY_KIND[sky]||(pcp?"overcast":null);
  return base?wxSvg({sky:base,pcp},size):"";
}
const wxText=(r)=>[r.skyLabel,(r.pty>0&&r.ptyLabel)?r.ptyLabel:null].filter(Boolean).join(" · ")||"—";
const hourLabel=(t)=>`${t.slice(0,2)}시`;
const slotLabel=(r)=>`${fmtDate(r.date)} ${hourLabel(r.time)}`;
const unitVal=(v,u)=>isMissing(v)?null:`${v}${u}`;
function windCell(r){
  if(r.windText) return `${r.windText}${r.windLabel?` · ${r.windLabel}`:""}`;
  return isMissing(r.windSpeed)?null:`${r.windSpeed}m/s${r.windLabel?` · ${r.windLabel}`:""}`;
}
const windArrow=(deg)=>isMissing(deg)?"":`<svg class="wind-arrow" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${Number(deg)+180}deg)"><path d="M12 20V5M12 5l-4.5 4.5M12 5l4.5 4.5"/></svg>`;
const popTier=(v)=>v>=60?"r2":v>=30?"r1":"r0";

// ---- 요약 카드 ----
function shortSummary(result){
  const rows=Array.isArray(result.data)?result.data:[];
  if(page==="now"||!rows.length) return "";
  const withPop=rows.filter(r=>!isMissing(r.pop));
  const maxPop=withPop.length?Math.max(...withPop.map(r=>r.pop)):null;
  const popAt=withPop.filter(r=>r.pop===maxPop).map(slotLabel);
  const rainSlots=rows.filter(r=>r.pty>0).length;
  let cards;
  if(page==="ultra"){
    const t=rows.filter(r=>!isMissing(r.temp)).map(r=>r.temp);
    cards=[stat(0,ui("thermo","warm"),"6시간 중 기온 범위",t.length?`${Math.min(...t)}~${Math.max(...t)}`:null,"℃",t.length?`${hourLabel(rows[0].time)} ~ ${hourLabel(rows[rows.length-1].time)}`:""),
      stat(1,ui("drop"),"가장 높은 강수확률",maxPop,"%",popAt.length>2?`${popAt[0]} 외 ${popAt.length-1}곳`:popAt.join(", ")),
      stat(2,ui("umbrella"),"비·눈 예보 시각",rainSlots,`/${rows.length}개`,"강수형태 코드 기준")];
  }else{
    const daily=result.daily||[];
    const mx=daily.filter(d=>!isMissing(d.max)), mn=daily.filter(d=>!isMissing(d.min));
    const hi=mx.length?Math.max(...mx.map(d=>d.max)):null, lo=mn.length?Math.min(...mn.map(d=>d.min)):null;
    cards=[stat(0,ui("thermo","warm"),"예보 기간 최고기온",hi,"℃",mx.filter(d=>d.max===hi).map(d=>fmtDate(d.date)).join(", ")),
      stat(1,ui("thermo","cool"),"예보 기간 최저기온",lo,"℃",mn.filter(d=>d.min===lo).map(d=>fmtDate(d.date)).join(", ")),
      stat(2,ui("drop"),"가장 높은 강수확률",maxPop,"%",popAt.length>2?`${popAt[0]} 외 ${popAt.length-1}곳`:popAt.join(", "))];
  }
  return `<div class="stats">${cards.join("")}</div><p class="small">요약 카드는 응답 값 중 가장 큰 값과 작은 값을 고른 것이며, 새로 계산한 예보가 아닙니다.</p>`;
}

// ---- 시간 비례 그래프 (1시간·3시간 간격이 섞여 있어도 간격이 왜곡되지 않게) ----
const tsOf=(r)=>Date.UTC(+r.date.slice(0,4),+r.date.slice(5,7)-1,+r.date.slice(8,10),+r.time.slice(0,2),+r.time.slice(3,5))/60000;
function timeFrame(rows,{height=240,hourPx=12}={}){
  const t0=tsOf(rows[0]), t1=tsOf(rows[rows.length-1]), hours=Math.max(1,(t1-t0)/60);
  const p={l:46,r:22,t:30,b:58}, pad=16, W=Math.max(680,Math.round(hours*hourPx+p.l+p.r)), iw=W-p.l-p.r, ih=height-p.t-p.b;
  // 양끝에 여백(pad)을 둬 첫·마지막 점이 축에 붙지 않게 한다. x는 시각에 비례한다.
  const x=(r)=>rows.length===1?p.l+iw/2:p.l+pad+(tsOf(r)-t0)/(t1-t0)*(iw-2*pad);
  return {p,W,H:height,iw,ih,x,t0,t1,hours};
}
function timeAxis(rows,f,labelEvery){
  let out="",lastDate="";
  rows.forEach(r=>{
    const x=f.x(r);
    if(r.date!==lastDate){ lastDate=r.date;
      out+=`<line class="day-line" x1="${x}" y1="${f.p.t-6}" x2="${x}" y2="${f.H-f.p.b+22}"/><text class="axis-title" x="${x+4}" y="${f.H-f.p.b+36}">${esc(fmtDate(r.date))}</text>`; }
    if(Number(r.time.slice(0,2))%labelEvery===0) out+=`<text class="axis-text" x="${x}" y="${f.H-f.p.b+16}" text-anchor="middle">${Number(r.time.slice(0,2))}시</text>`;
  });
  return out;
}
function timeHits(rows,f,tip){
  return rows.map((r,i)=>{
    const xs=f.x(r), l=i?(xs+f.x(rows[i-1]))/2:f.p.l, rr=i<rows.length-1?(xs+f.x(rows[i+1]))/2:f.W-f.p.r;
    return `<g class="col"><line class="guide" x1="${xs}" y1="${f.p.t}" x2="${xs}" y2="${f.H-f.p.b}"/><rect class="hit" x="${l}" y="${f.p.t-6}" width="${Math.max(6,rr-l)}" height="${f.ih+12}" data-tip="${esc(tip(r))}"/></g>`;
  }).join("");
}
function tempChart(rows,field,tip){
  const valid=rows.filter(r=>!isMissing(r[field]));
  if(!valid.length) return '<p class="missing">그래프에 표시할 기온이 없습니다.</p>';
  const f=timeFrame(rows), vals=valid.map(r=>r[field]);
  const min=Math.floor(Math.min(...vals)-2), max=min+Math.ceil((Math.max(...vals)+2-min)/4)*4, range=(max-min)||1;
  const y=(v)=>f.p.t+(max-v)*f.ih/range;
  let grid=""; for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,yy=y(v);grid+=`<line class="grid-line" x1="${f.p.l}" y1="${yy}" x2="${f.W-f.p.r}" y2="${yy}"/><text class="axis-text" x="${f.p.l-8}" y="${yy+4}" text-anchor="end">${Math.round(v)}℃</text>`;}
  // 결측 시각은 선을 끊는다(보간하지 않음)
  const segs=[]; let cur=[];
  rows.forEach(r=>{ if(isMissing(r[field])){ if(cur.length) segs.push(cur); cur=[]; } else cur.push(r); }); if(cur.length) segs.push(cur);
  const line=segs.map(sg=>`<polyline class="tline" points="${sg.map(r=>`${f.x(r)},${y(r[field])}`).join(" ")}"/>`).join("");
  const dense=rows.length>14, dots=valid.map(r=>`<circle class="tdot${dense?" small":""}" cx="${f.x(r)}" cy="${y(r[field])}" r="${dense?2.6:4.5}"/>`).join("");
  // 값 라벨: 점이 적으면 모두, 많으면 날짜별 최고·최저 시각에만
  let labelRows=valid;
  if(dense){ const byDate={}; valid.forEach(r=>{(byDate[r.date]=byDate[r.date]||[]).push(r);});
    labelRows=Object.values(byDate).flatMap(g=>{ const hi=Math.max(...g.map(r=>r[field])), lo=Math.min(...g.map(r=>r[field])); return [g.find(r=>r[field]===hi), g.length>3?g.find(r=>r[field]===lo):null].filter(Boolean); }); }
  const labels=labelRows.map(r=>`<text class="val" x="${f.x(r)}" y="${y(r[field])-9}" text-anchor="middle">${r[field]}</text>`).join("");
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${f.W} ${f.H}" style="min-width:${Math.min(f.W,1100)}px" role="img" aria-label="시간별 기온 그래프(℃). 같은 값은 수치표 탭에서 볼 수 있습니다."><text class="axis-title" x="4" y="14">기온(℃)</text>${grid}${timeAxis(rows,f,rows.length>14?6:1)}${line}${dots}${labels}${timeHits(rows,f,tip)}</svg><div class="tip" hidden></div></div>`;
}
function popChart(rows,tip){
  const valid=rows.filter(r=>!isMissing(r.pop));
  if(!valid.length) return '<p class="missing">강수확률이 제공되지 않았습니다.</p>';
  const f=timeFrame(rows,{height:190}), y=(v)=>f.p.t+(100-v)*f.ih/100, bw=Math.max(5,Math.min(22,f.iw/rows.length*0.7));
  let grid=""; [0,50,100].forEach(v=>{const yy=y(v);grid+=`<line class="grid-line" x1="${f.p.l}" y1="${yy}" x2="${f.W-f.p.r}" y2="${yy}"/><text class="axis-text" x="${f.p.l-8}" y="${yy+4}" text-anchor="end">${v}%</text>`;});
  const bars=rows.map((r,i)=>isMissing(r.pop)?"":`<rect class="bar ${popTier(r.pop)}" x="${f.x(r)-bw/2}" y="${Math.min(y(r.pop),y(0)-1)}" width="${bw}" height="${Math.max(1,y(0)-y(r.pop))}" rx="2"/>`).join("");
  const labels=rows.length<=14?valid.map(r=>`<text class="val" x="${f.x(r)}" y="${Math.min(y(r.pop),y(0)-1)-5}" text-anchor="middle">${r.pop}%</text>`).join(""):"";
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${f.W} ${f.H}" style="min-width:${Math.min(f.W,1100)}px" role="img" aria-label="시간별 강수확률 그래프(%)"><text class="axis-title" x="4" y="14">강수확률(%)</text>${grid}${timeAxis(rows,f,rows.length>14?6:1)}${bars}${labels}${timeHits(rows,f,tip)}</svg><div class="tip" hidden></div></div>`;
}
const hourTip=(r)=>`${slotLabel(r)} · ${wxText(r)} · 기온 ${isMissing(r.temp)?"미제공":r.temp+"℃"} · 강수확률 ${isMissing(r.pop)?"미제공":r.pop+"%"}`;

// ---- 현재 날씨(초단기실황) ----
function renderNow(r){
  const d=r.data||{}, base=r.requestedRelease;
  const hasPty=d.pty>0, icon=hasPty?wxCodeIcon(null,d.pty,"xl"):`<span class="now-noicon">${ui("thermo")}</span>`;
  const tile=(label,value,sub,fx)=>`<div class="now-tile"${fx?` data-fx="${fx}"`:""}><span class="lab">${esc(label)}</span><strong>${isMissing(value)?'<span class="missing">미제공</span>':value}</strong>${sub?`<small>${sub}</small>`:""}</div>`;
  const wind=isMissing(d.windSpeed)?null:`${windArrow(d.windDir)}<span data-count="${esc(d.windSpeed)}">${esc(d.windSpeed)}</span><small class="u">m/s</small>`;
  const rain=isMissing(d.rain1h)?null:`<span data-count="${esc(d.rain1h)}">${esc(d.rain1h)}</span><small class="u">mm</small>`;
  const rows=[["T1H","기온",d.temperature,"℃"],["RN1","1시간 강수량",d.rain1h,"mm"],["REH","습도",d.humidity,"%"],["WSD","풍속",d.windSpeed,"m/s"],["VEC","풍향",d.windDir,"°"],["UUU","동서바람성분(동+, 서-)",d.windU,"m/s"],["VVV","남북바람성분(북+, 남-)",d.windV,"m/s"],["PTY","강수형태 코드",d.pty,d.ptyLabel?`(${d.ptyLabel})`:""]];
  const table=tableFor(rows,["코드","항목","값","단위"],x=>[`<span class="code">${esc(x[0])}</span>`,esc(x[1]),showValue(x[2]),esc(x[3])]);
  $("results").innerHTML=metaPanel(r)+`<section class="panel reveal now-hero"><div class="now-main">
    <div class="now-ic">${icon}</div>
    <div><p class="step">${esc(fmtDate(`${base.slice(0,4)}-${base.slice(4,6)}-${base.slice(6,8)}`))} ${esc(base.slice(8,10))}:${esc(base.slice(10,12))} 관측</p>
    <div class="now-temp">${isMissing(d.temperature)?'<span class="missing">미제공</span>':`<span data-count="${esc(d.temperature)}">${esc(d.temperature)}</span><small>℃</small>`}</div>
    <p class="now-pty">${esc(d.ptyLabel||"강수형태 미제공")}</p></div></div>
    <div class="now-tiles">${tile("습도",isMissing(d.humidity)?null:`<span data-count="${esc(d.humidity)}">${esc(d.humidity)}</span><small class="u">%</small>`,"","humid")}${tile("1시간 강수량",rain,"","rain")}
    ${tile("풍속",wind,d.windLabel?`${esc(d.windLabel)}${isMissing(d.windDir)?"":` · ${esc(d.windDir)}°`}`:"","wind")}</div>
    <p class="small">예보가 아니라 해당 예보 구역의 대표 AWS(자동기상관측) 관측값입니다. 하늘상태(맑음·흐림)는 실황에 포함되지 않아 표시하지 않습니다. 풍향은 바람이 불어오는 방향이며 화살표는 바람이 향하는 쪽입니다.</p></section>
    <section class="panel reveal"><h2>관측 항목</h2><div class="gap"></div>${table}</section>`+rawDetails(r);
}

// ---- 6시간 예보(초단기예보) ----
function renderUltra(r){
  const rows=r.data||[];
  const card=(x,i)=>`<article class="day" role="listitem" style="--i:${i}"><header><strong>${esc(hourLabel(x.time))}</strong><span>${esc(fmtDate(x.date))}</span></header>
    <div class="periods single"><div class="period">${`<div class="wx-line">${wxCodeIcon(x.sky,x.pty,"lg")}<span class="wx-text">${esc(wxText(x))}</span></div>`}
    <div class="big-temp">${isMissing(x.temp)?'<span class="missing">기온 미제공</span>':`${esc(x.temp)}<small>℃</small>`}</div>${rainGauge(x.pop)}
    <ul class="mini"><li>습도 ${showValue(x.humidity,"%")}</li><li>바람 ${windCell(x)?esc(windCell(x)):'<span class="missing">미제공</span>'}</li><li>강수량 ${x.rain?esc(x.rain):'<span class="missing">미제공</span>'}</li></ul></div></div></article>`;
  const table=tableFor(rows,["시각","날씨","기온(℃)","강수확률(%)","1시간 강수량","습도(%)","바람"],x=>[esc(slotLabel(x)),`<span class="wx-cell">${wxCodeIcon(x.sky,x.pty,"sm")}${esc(wxText(x))}</span>`,showValue(x.temp,"℃"),showValue(x.pop,"%"),x.rain?esc(x.rain):null,showValue(x.humidity,"%"),windCell(x)?esc(windCell(x)):null]);
  $("results").innerHTML=metaPanel(r)+`<section class="panel reveal"><div class="panel-head"><div><p class="step">앞으로 6시간</p><h2>시간별 예보</h2></div>
    <div class="legend"><span>매시 30분에 새 발표 · 같은 시각의 값도 발표마다 바뀔 수 있습니다</span></div></div>
    ${rows.length?`<div class="timeline" role="list">${rows.map(card).join("")}</div>`:'<p class="missing">예보 데이터가 없습니다.</p>'}</section>
    <section class="panel reveal">${tabs("ultra-view",[{label:"기온·강수확률 그래프",html:tempChart(rows,"temp",hourTip)+popChart(rows,hourTip)},{label:"수치표",html:table}])}</section>`+rawDetails(r);
}

// ---- 단기예보 ----
function dayRepresentative(rows){ return rows.find(x=>x.time==="12:00")||rows.find(x=>!isMissing(x.sky))||rows[0]; }
function renderShort(r){
  const rows=r.data||[], daily=r.daily||[];
  const byDate=new Map(); rows.forEach(x=>{ if(!byDate.has(x.date)) byDate.set(x.date,[]); byDate.get(x.date).push(x); });
  const cards=daily.map((d,i)=>{
    const slots=byDate.get(d.date)||[], rep=slots.length?dayRepresentative(slots):null, pops=slots.filter(x=>!isMissing(x.pop)).map(x=>x.pop);
    return `<article class="day" role="listitem" style="--i:${i}"><header><strong>${esc(fmtDate(d.date))}</strong><span>${slots.length}개 시각</span></header>
      <div class="periods single"><div class="period">${rep?`<div class="wx-line">${wxCodeIcon(rep.sky,rep.pty,"lg")}<span class="wx-text">${esc(wxText(rep))}<small class="note inline"> ${esc(hourLabel(rep.time))} 기준</small></span></div>`:""}
      <div class="range-line"><span class="am">최저 ${showValue(d.min,"℃")}</span><span class="dy">최고 ${showValue(d.max,"℃")}</span></div>
      ${pops.length?rainGauge(Math.max(...pops)):rainGauge(null)}<small class="note">최대 강수확률</small></div></div></article>`;
  }).join("");
  const table=tableFor(rows,["시각","날씨","기온(℃)","강수확률(%)","강수량","적설","습도(%)","바람","간격"],x=>[esc(slotLabel(x)),`<span class="wx-cell">${wxCodeIcon(x.sky,x.pty,"sm")}${esc(wxText(x))}</span>`,showValue(x.temp,"℃"),showValue(x.pop,"%"),x.rain?esc(x.rain):null,x.snow?esc(x.snow):null,showValue(x.humidity,"%"),windCell(x)?esc(windCell(x)):null,x.step==="3h"?"3시간":"1시간"]);
  const hasWave=rows.some(x=>!isMissing(x.wave)&&x.wave>0);
  $("results").innerHTML=metaPanel(r)+`<section class="panel reveal"><div class="panel-head"><div><p class="step">날짜별 예보</p><h2>최저·최고기온과 강수확률</h2></div>
    <div class="legend"><span>하루 하늘상태는 낮 12시 값입니다 · 하루 대표값이 아닙니다</span></div></div>
    ${cards?`<div class="timeline" role="list">${cards}</div>`:'<p class="missing">예보 데이터가 없습니다.</p>'}
    <p class="small">오늘의 최저기온은 02시 발표본에만 있고, 예보 마지막 날은 00시 한 시각만 제공될 수 있어 해당 값은 ‘미제공’으로 표시합니다. 예보 후반(글피 등)은 3시간 간격이며 강수량·적설·풍속은 코드값(약한 비, 약한 바람 등)으로 제공됩니다.${hasWave?" 파고(WAV)는 해상 격자에서만 값이 있습니다.":""}</p></section>
    <section class="panel reveal">${tabs("short-view",[{label:"시간별 그래프",html:tempChart(rows,"temp",hourTip)+popChart(rows,hourTip)},{label:"시간별 수치표",html:`<div class="table-tall">${table}</div>`}])}</section>`+rawDetails(r);
}

// ---- 결과 머리의 칩·조회 정보 ----
function shortChips(result){
  const rows=Array.isArray(result.data)?result.data:[], b=result.requestedRelease;
  if(page==="now") return [`${ui("calendar")}관측 ${esc(b.slice(8,10))}:${esc(b.slice(10,12))} 기준`];
  if(!rows.length) return [];
  const first=rows[0], last=rows[rows.length-1];
  const end=first.date===last.date?hourLabel(last.time):slotLabel(last);  // 같은 날이면 날짜를 반복하지 않는다
  return [`${ui("calendar")}예보 ${esc(slotLabel(first))} ~ ${esc(end)} · ${rows.length}개 시각`];
}
function shortFacts(result,selected){
  const b=result.requestedRelease, rows=Array.isArray(result.data)?result.data:[];
  const count=page==="now"?`API totalCount <b>${esc(result.totalCount)}</b>건 = 관측 항목(기온·습도·바람 등)의 수입니다.`
    :`API totalCount <b>${esc(result.totalCount)}</b>건 → 같은 시각의 항목(기온·습도·바람 등)을 묶어 <b>${rows.length}</b>개 시각으로 표시합니다. 두 수는 다릅니다.`;
  return `<li>요청에 사용한 발표시각 <b>${esc(releaseLabel(b))}</b> (base_date <span class="code">${esc(b.slice(0,8))}</span> · base_time <span class="code">${esc(b.slice(8,12))}</span>)</li>
    <li>${esc(CONFIG[page].cycle)}</li><li>${count}</li>
    <li>제공기관 결과코드 ${esc(result.providerResult?.code||"—")} ${esc(result.providerResult?.message||"")}</li>
    <li>격자 <span class="code">X ${esc(result.grid?.nx??"—")}</span> <span class="code">Y ${esc(result.grid?.ny??"—")}</span>${selected?` · 같은 격자를 쓰는 지역 ${esc(selected.n)}곳`:""} · 격자 단위 예보라 행정동 단위 정밀 예보가 아닙니다.</li>`;
}

function renderShortPage(result){
  if(page==="now") renderNow(result); else if(page==="ultra") renderUltra(result); else renderShort(result);
}
