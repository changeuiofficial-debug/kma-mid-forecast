"use strict";

// 사이드 탭: 좁은 화면의 메뉴 열기/닫기, 데이터 안내 대화상자 열기/닫기.
(function(){
  const side=document.getElementById("side"), btn=document.getElementById("menu-btn");
  if(side&&btn){
    const set=(open)=>{side.classList.toggle("open",open); btn.setAttribute("aria-expanded",String(open));};
    btn.addEventListener("click",()=>set(!side.classList.contains("open")));
    document.addEventListener("keydown",e=>{if(e.key==="Escape"&&side.classList.contains("open")){set(false);btn.focus();}});
    window.matchMedia("(min-width:1024px)").addEventListener("change",e=>{if(e.matches) set(false);});
  }
  const dlg=document.getElementById("method-dialog");
  if(dlg){
    const open=()=>{ if(typeof dlg.showModal==="function"){ if(!dlg.open) dlg.showModal(); } else dlg.setAttribute("open",""); };
    const close=()=>{ if(typeof dlg.close==="function") dlg.close(); else dlg.removeAttribute("open"); };
    document.querySelectorAll(".js-method-open").forEach(b=>b.addEventListener("click",open));
    document.getElementById("method-close")?.addEventListener("click",close);
    dlg.addEventListener("click",e=>{if(e.target===dlg) close();});  // 바깥(어두운 배경)을 누르면 닫힘
  }
})();
