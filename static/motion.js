"use strict";

// 패럴렉스: 스크롤 위치(0~320px)를 CSS 변수 --sy 로 알려 준다. 어떤 요소가 얼마나 움직일지는 CSS가 정한다.
// 모션 줄이기 설정이면 아무것도 하지 않는다.
(function(){
  if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root=document.documentElement;
  const set=()=>root.style.setProperty("--sy",String(Math.min(320,Math.max(0,window.scrollY||0))));
  window.addEventListener("scroll",set,{passive:true}); set();
})();
