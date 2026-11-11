"use strict";

// 중기전망 원문(wfSv)에서 '이미 적혀 있는' 날짜·지역·기온·파고만 뽑아 내는 파서.
// 원칙: 숫자와 지역 이름은 원문 글자를 그대로 쓴다. 확신할 수 없는 문장은 뽑지 않고(complete=false) 원문을 그대로 보여 주게 한다.
// DOM을 쓰지 않아 Node에서도 테스트할 수 있다.
(function(root){
  // 뒤에 "기온"이 바로 오면(아침 기온은, 낮 기온은) 시간대가 아니라 기온 설명의 시작이다.
  const PERIOD="(?:오전|오후|새벽|아침|낮|저녁|밤)(?!\\s*기온)";
  const DATE="\\d{1,2}일\\([월화수목금토일]\\)";
  const DEXPR=`${DATE}(?:\\s*${PERIOD})?(?:\\s*~\\s*${DATE}(?:\\s*${PERIOD})?)?`;
  const NUM="-?\\d+(?:\\.\\d+)?";
  const RANGE=`(${NUM})\\s*~\\s*(${NUM})`;
  const reLead=new RegExp("^"+DEXPR);
  const reAnyDate=new RegExp(DEXPR,"g");
  const WEEK="일월화수목금토";

  // 원문의 '15일(일)'에는 월이 없다. 발표일 전후 날짜 중 '일'과 '요일'이 모두 맞는 날을 찾아 11/15(일)로 바꾼다. 못 찾으면 원문 표기를 쓴다.
  function resolveDay(day,weekday,tmFc){
    const y=Number(tmFc.slice(0,4)), m=Number(tmFc.slice(4,6)), d=Number(tmFc.slice(6,8));
    for(let off=-3;off<=14;off++){
      const t=new Date(Date.UTC(y,m-1,d+off));
      if(t.getUTCDate()===day && WEEK[t.getUTCDay()]===weekday) return `${t.getUTCMonth()+1}/${day}(${weekday})`;
    }
    return `${day}(${weekday})`;
  }
  function fmtExpr(expr,tmFc){
    return expr.replace(/(\d{1,2})일\(([월화수목금토일])\)/g,(_,d,w)=>resolveDay(Number(d),w,tmFc)).replace(/\s*~\s*/g," ~ ").replace(/\s+/g," ").trim();
  }

  // 평년과 비교하는 표현(평년과 비슷하거나 조금 높음 등). 정해진 표현일 때만 뽑는다.
  function trendOf(text){
    const i=text.indexOf("평년"); if(i<0) return null;
    const tail=text.slice(i).replace(/\([^)]*\)/g,"");
    const table=[[/비슷하거나\s*조금\s*높/,"평년과 비슷하거나 조금 높음"],[/비슷하거나\s*조금\s*낮/,"평년과 비슷하거나 조금 낮음"],
      [/조금\s*높/,"평년보다 조금 높음"],[/조금\s*낮/,"평년보다 조금 낮음"],[/비슷/,"평년과 비슷"],[/높/,"평년보다 높음"],[/낮/,"평년보다 낮음"]];
    const sentence=tail.split(/[.]/)[0];
    for(const [re,label] of table) if(re.test(sentence)) return label;
    return null;
  }

  function splitSegments(head,tmFc){
    if(!head) return null;
    const segs=head.split(/,\s*/).map(s=>{
      const m=s.match(reLead); if(!m) return null;
      const place=s.slice(m[0].length).trim();
      if(place.length>16) return null;
      return {date:fmtExpr(m[0],tmFc),place};
    });
    return segs.every(Boolean)?segs:null;
  }

  function parseRain(text,tmFc){
    const m=text.match(/에\s*(비\/눈|소나기|눈|비)가\s*내리[^.]*\.?\s*$/); if(!m) return null;
    const segs=splitSegments(text.slice(0,m.index).trim(),tmFc); if(!segs) return null;
    return {type:"rain",kind:m[1],segs,complete:true};
  }
  function parseSea(text,tmFc){
    const k=text.search(/\s*물결/); const w=text.match(new RegExp(`${RANGE}\\s*m`)); if(k<0||!w) return null;
    const segs=splitSegments(text.slice(0,k).replace(/에\s*$/,"").trim(),tmFc); if(!segs) return null;
    const q=text.match(/m로\s*([^.]*?)\s*일겠/);
    return {type:"sea",segs,low:w[1],high:w[2],qualifier:q?q[1].trim():"",complete:true};
  }
  function parseTemp(sentence,tmFc){
    const am=sentence.match(new RegExp(`아침\\s*기온은?\\s*${RANGE}\\s*℃`)), dy=sentence.match(new RegExp(`낮\\s*기온은?\\s*${RANGE}\\s*℃`));
    if(!am||!dy) return null;
    const lead=sentence.match(reLead), trend=trendOf(sentence);
    return {type:"temp",date:lead?fmtExpr(lead[0],tmFc):"",am:[am[1],am[2]],day:[dy[1],dy[2]],trend,complete:Boolean(lead&&trend)};
  }

  // 한 문단(주제 카드의 한 줄)을 해석한다. rows: 화면에 칩으로 보여 줄 항목, complete: 칩만으로 문장 내용을 모두 담았는지.
  function parseParagraph(text,tmFc){
    const t=String(text).trim();
    const sentences=t.split(/(?<=[다요]\.)\s+/).filter(Boolean);
    if(sentences.length<=1){
      const one=parseRain(t,tmFc)||parseSea(t,tmFc)||parseTemp(t,tmFc);
      if(one) return {rows:[one],complete:one.complete};
    }else{
      const rows=sentences.map(s=>parseTemp(s,tmFc)).filter(Boolean);
      const dates=uniqueDates(t,tmFc);
      if(rows.length) return {rows:[...(dates.length?[{type:"dates",dates}]:[]),...rows],complete:false};
    }
    const dates=uniqueDates(t,tmFc);
    return {rows:dates.length?[{type:"dates",dates}]:[],complete:false};
  }
  function uniqueDates(text,tmFc){
    const seen=[]; for(const m of text.matchAll(reAnyDate)){const f=fmtExpr(m[0],tmFc); if(!seen.includes(f)) seen.push(f);} return seen;
  }

  // 주제 카드 나누기: 원문의 ○, * 표시와 (주제) 기준
  function splitTopics(text){
    const secs=[]; let cur=null;
    for(const raw of String(text).split(/\r?\n/)){
      const line=raw.trim(); if(!line) continue;
      const m=line.match(/^(?:[○◦•●*※]|o)\s*\(([^)]{1,15})\)\s*(.*)$/);
      if(m){cur={topic:m[1],lines:m[2]?[m[2]]:[]};secs.push(cur);}
      else if(cur) cur.lines.push(line);
      else {cur={topic:"개요",lines:[line]};secs.push(cur);}
    }
    return secs;
  }
  function analyze(text,tmFc){
    return splitTopics(text).map(s=>{
      const paragraphs=s.lines.map(l=>({text:l,...parseParagraph(l,tmFc)}));
      return {topic:s.topic,paragraphs,complete:paragraphs.every(p=>p.complete)};
    });
  }

  const api={DEXPR,analyze,splitTopics,parseParagraph,resolveDay,fmtExpr,trendOf};
  if(typeof module!=="undefined"&&module.exports) module.exports=api; else root.OutlookParse=api;
})(typeof window!=="undefined"?window:globalThis);
