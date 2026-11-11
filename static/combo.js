"use strict";

// 화면용 드롭다운. 원래 <select>는 값 저장소로 남겨 두고, 그 위에 직접 만든 목록을 얹는다.
// 다른 코드가 select.value / select.selectedIndex 를 바꾸면 화면 표시도 함께 바뀐다.
(function(){
  const escHtml=(v)=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const valueDesc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value");
  const indexDesc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"selectedIndex");
  const SHEET_QUERY="(max-width:640px)";
  let openCombo=null;

  // "서울 (11B10101)" 형태는 이름과 코드를 나누어 보여 준다. 그 밖의 문구는 그대로 둔다.
  function labelHtml(text){
    const m=String(text).match(/^(.*\S)\s+\(([^)]+)\)$/);
    if(!m) return `<span class="opt-name">${escHtml(text)}</span>`;
    const isCode=/^[A-Za-z0-9]+$/.test(m[2]);  // 영문·숫자만이면 지역 코드, 그 밖은 보조 설명
    return `<span class="opt-name">${escHtml(m[1])}</span><span class="${isCode?"opt-code":"opt-tag"}">${escHtml(m[2])}</span>`;
  }

  window.enhanceSelect=function(select,{label,searchable=false,placeholder="검색"}={}){
    if(select.dataset.combo) return select._combo;
    select.dataset.combo="1";
    const uid=select.id||`c${Math.random().toString(36).slice(2,7)}`;
    const wrap=document.createElement("div"); wrap.className="combo";
    wrap.innerHTML=`<button type="button" class="combo-btn" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${uid}-list"${label?` aria-labelledby="${label} ${uid}-val"`:""} id="${uid}-btn"><span class="combo-value" id="${uid}-val"></span><svg class="combo-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg></button>
      <div class="combo-pop" hidden>
        ${searchable?`<div class="combo-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17"/></svg><input type="text" role="searchbox" autocomplete="off" spellcheck="false" placeholder="${escHtml(placeholder)}" aria-label="${escHtml(placeholder)}" aria-controls="${uid}-list"></div>`:""}
        <ul class="combo-list" role="listbox" id="${uid}-list" ${label?`aria-labelledby="${label}"`:""}></ul>
        <p class="combo-empty" hidden>검색 결과가 없습니다.</p>
        <p class="combo-count" aria-live="polite"></p>
      </div>`;
    select.after(wrap);
    select.classList.add("native-hidden"); select.tabIndex=-1; select.setAttribute("aria-hidden","true");
    const btn=wrap.querySelector(".combo-btn"), pop=wrap.querySelector(".combo-pop"), list=wrap.querySelector(".combo-list");
    const input=wrap.querySelector(".combo-search input"), empty=wrap.querySelector(".combo-empty"), count=wrap.querySelector(".combo-count");
    const valueEl=wrap.querySelector(".combo-value");
    let items=[], active=-1, backdrop=null, typeahead="", typeTimer=null;

    function syncLabel(){
      const opt=select.options[select.selectedIndex];
      valueEl.innerHTML=opt?labelHtml(opt.textContent):'<span class="opt-name muted">선택하세요</span>';
    }
    function visible(){return items.filter(i=>!i.el.hidden);}
    function setActive(i,scroll=true){
      const vis=visible(); if(!vis.length){active=-1;return;}
      const target=Math.max(0,Math.min(i,vis.length-1)); active=target;
      items.forEach(it=>it.el.classList.remove("active"));
      const it=vis[target]; it.el.classList.add("active");
      (input||btn).setAttribute("aria-activedescendant",it.el.id);
      if(scroll) it.el.scrollIntoView({block:"nearest"});
    }
    function build(){
      items=[...select.options].map((o,i)=>{
        const li=document.createElement("li"); li.role="option"; li.id=`${uid}-o${i}`; li.dataset.value=o.value; li.dataset.text=o.textContent.toLowerCase();
        li.setAttribute("aria-selected",String(i===select.selectedIndex));
        li.innerHTML=`${labelHtml(o.textContent)}<svg class="opt-check" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>`;
        return {el:li,index:i};
      });
      list.replaceChildren(...items.map(i=>i.el));
    }
    function filter(q){
      const query=q.trim().toLowerCase(); let shown=0;
      items.forEach(it=>{const ok=!query||it.el.dataset.text.includes(query); it.el.hidden=!ok; if(ok) shown++;});
      empty.hidden=shown>0; list.hidden=shown===0;
      count.textContent=searchable?(query?`${shown}개 일치 / 전체 ${items.length}개`:`전체 ${items.length}개`):"";
      const sel=visible().findIndex(it=>it.index===select.selectedIndex); setActive(query?0:Math.max(sel,0),false);
    }
    function choose(it){
      if(!it) return;
      const changed=it.index!==select.selectedIndex;
      indexDesc.set.call(select,it.index); syncLabel();
      close(true);
      if(changed) select.dispatchEvent(new Event("change",{bubbles:true}));
    }
    function isSheet(){return window.matchMedia(SHEET_QUERY).matches;}
    function open(){
      if(openCombo&&openCombo!==api) openCombo.close();
      build(); pop.hidden=false; wrap.classList.add("open"); btn.setAttribute("aria-expanded","true"); openCombo=api;
      const sheet=isSheet(); wrap.classList.toggle("sheet",sheet);
      if(sheet){ backdrop=document.createElement("div"); backdrop.className="combo-backdrop"; document.body.appendChild(backdrop); document.body.classList.add("combo-lock"); backdrop.addEventListener("pointerdown",()=>close(true)); }
      else{ const r=btn.getBoundingClientRect(); wrap.classList.toggle("up", window.innerHeight-r.bottom<340 && r.top>window.innerHeight-r.bottom); }
      if(input) input.value=""; filter("");
      requestAnimationFrame(()=>{ wrap.classList.add("shown"); const a=visible()[active]; a?.el.scrollIntoView({block:"center"}); if(input&&!sheet) input.focus({preventScroll:true}); else if(input) input.focus({preventScroll:true}); });
    }
    function close(refocus=false){
      if(pop.hidden) return;
      pop.hidden=true; wrap.classList.remove("open","shown","up","sheet"); btn.setAttribute("aria-expanded","false");
      btn.removeAttribute("aria-activedescendant"); input?.removeAttribute("aria-activedescendant");
      backdrop?.remove(); backdrop=null; document.body.classList.remove("combo-lock");
      if(openCombo===api) openCombo=null;
      if(refocus) btn.focus({preventScroll:true});
    }
    function move(delta){const vis=visible(); if(!vis.length) return; setActive((active<0?0:active)+delta);}
    function onKey(e){
      const isOpen=!pop.hidden;
      if(!isOpen){
        if(["ArrowDown","ArrowUp","Enter"," "].includes(e.key)){ e.preventDefault(); open(); }
        else if(!searchable && e.key.length===1 && !e.ctrlKey && !e.metaKey){  // 목록을 열지 않고 글자로 이동
          typeahead+=e.key.toLowerCase(); clearTimeout(typeTimer); typeTimer=setTimeout(()=>typeahead="",600);
          const idx=[...select.options].findIndex(o=>o.textContent.toLowerCase().includes(typeahead));
          if(idx>=0 && idx!==select.selectedIndex){ indexDesc.set.call(select,idx); syncLabel(); select.dispatchEvent(new Event("change",{bubbles:true})); }
        }
        return;
      }
      switch(e.key){
        case "ArrowDown": e.preventDefault(); move(1); break;
        case "ArrowUp": e.preventDefault(); move(-1); break;
        case "Home": if(!input){e.preventDefault(); setActive(0);} break;
        case "End": if(!input){e.preventDefault(); setActive(visible().length-1);} break;
        case "PageDown": e.preventDefault(); move(6); break;
        case "PageUp": e.preventDefault(); move(-6); break;
        case "Enter": e.preventDefault(); choose(visible()[active]); break;
        case " ": if(!input){ e.preventDefault(); choose(visible()[active]); } break;
        case "Escape": e.preventDefault(); e.stopPropagation(); close(true); break;
        case "Tab": close(false); break;
      }
    }
    btn.addEventListener("click",()=>pop.hidden?open():close(true));
    btn.addEventListener("keydown",onKey);
    input?.addEventListener("keydown",onKey);
    input?.addEventListener("input",()=>filter(input.value));
    list.addEventListener("pointermove",e=>{const li=e.target.closest("li"); if(!li) return; const vis=visible(); const i=vis.findIndex(it=>it.el===li); if(i>=0&&i!==active) setActive(i,false);});
    list.addEventListener("click",e=>{const li=e.target.closest("li"); if(!li) return; choose(items.find(it=>it.el===li));});
    // 다른 코드가 select 값을 바꾸면 화면 표시를 맞춘다.
    Object.defineProperty(select,"value",{configurable:true,get(){return valueDesc.get.call(this);},set(v){valueDesc.set.call(this,v);syncLabel();}});
    Object.defineProperty(select,"selectedIndex",{configurable:true,get(){return indexDesc.get.call(this);},set(v){indexDesc.set.call(this,v);syncLabel();}});
    const api={close,sync:()=>{build();syncLabel();},open};
    select._combo=api; syncLabel();
    return api;
  };

  document.addEventListener("pointerdown",e=>{ if(openCombo && !e.target.closest(".combo") && !e.target.closest(".combo-backdrop")) openCombo.close(); });
  let lastWidth=window.innerWidth;
  window.addEventListener("resize",()=>{ if(window.innerWidth!==lastWidth){ lastWidth=window.innerWidth; if(openCombo) openCombo.close(); } });  // 모바일 키보드가 올라와 높이만 바뀔 때는 닫지 않는다
  window.addEventListener("pagehide",()=>{ document.body.classList.remove("combo-lock"); });
})();
