"use strict";

// 카드 호버 효과 장식 레이어를 붙인다. 값과 무관한 연출이며 aria-hidden, 마우스를 올렸을 때만 CSS가 움직인다.
// 어떤 효과를 쓸지는 카드의 라벨·날씨 문구를 보고 정한다. 맞는 주제가 없으면 아무것도 붙이지 않는다.
(function(){
  const n=(k,cls,extra="")=>Array.from({length:k},(_,i)=>`<b class="${cls}" style="--i:${i}"${extra}></b>`).join("");
  const LAYERS={
    humid:()=>'<b class="lvl"></b>'+n(5,"bub"),
    wave:()=>'<b class="lvl"></b>'+n(2,"bub"),
    rain:()=>n(22,"drop"),
    snow:()=>n(18,"flake"),
    cold:()=>n(18,"flake"),
    wind:()=>n(5,"gust"),
    sun:()=>'<b class="rays"></b><b class="orb"></b>',
    cloud:()=>n(3,"cl"),
    warm:()=>'<b class="heat"></b>'+n(6,"ember"),
    spark:()=>n(7,"tw")
  };
  const fxHtml=(t)=>`<i class="fx" data-t="${t}" aria-hidden="true">${LAYERS[t]()}</i>`;

  // 날씨 문구 -> 효과(눈이 비보다 우선, 비/눈은 눈)
  function weatherTheme(text){
    if(/눈/.test(text)) return "snow";
    if(/비|소나기/.test(text)) return "rain";
    if(/맑/.test(text)) return "sun";
    if(/구름|흐/.test(text)) return "cloud";
    return null;
  }
  // 요약 카드 라벨 -> 효과
  function statTheme(label){
    if(/파고/.test(label)) return "wave";
    if(/최저/.test(label)) return "cold";
    if(/최고/.test(label)) return "warm";
    if(/기온\s*폭/.test(label)) return "spark";
    if(/기온/.test(label)) return "warm";
    if(/강수|비·눈|비/.test(label)) return "rain";
    if(/풍|바람/.test(label)) return "wind";
    if(/습/.test(label)) return "humid";
    return null;
  }
  function attach(host,theme){
    if(!theme||!LAYERS[theme]||host.dataset.fxd) return;
    host.dataset.fxd="1"; host.classList.add("fxh");
    host.insertAdjacentHTML("beforeend",fxHtml(theme));
  }
  function decorate(root){
    root.querySelectorAll(".now-tile[data-fx]").forEach(el=>attach(el,el.dataset.fx));
    root.querySelectorAll(".stat").forEach(el=>{
      const label=el.querySelector(".stat-label");
      attach(el,statTheme(label?label.textContent:""));
    });
    root.querySelectorAll(".day").forEach(el=>{
      const host=el.querySelector(".periods"); if(!host) return;
      const texts=[...el.querySelectorAll(".wx-text")].map(x=>x.textContent);
      // 오전·오후 중 눈/비가 하나라도 있으면 그쪽을 우선한다.
      attach(host,weatherTheme(texts.join(" ")));
    });
    root.querySelectorAll(".sum-row").forEach(el=>{
      const t=el.classList.contains("rain")?(/눈/.test(el.querySelector(".sum-label")?.textContent||"")?"snow":"rain"):el.classList.contains("temp")?"warm":el.classList.contains("sea")?"wave":null;
      attach(el,t);
    });
  }
  let queued=false;
  function schedule(){ if(queued) return; queued=true; setTimeout(()=>{queued=false; const r=document.getElementById("results"); if(r) decorate(r);},30); }
  function start(){
    const r=document.getElementById("results"); if(!r) return;
    new MutationObserver(schedule).observe(r,{childList:true,subtree:true});
    schedule();
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start); else start();
})();
