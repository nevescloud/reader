// Two surfaces, two audiences:
//   landingPage — normal browser, setup. HIG house-style over the web-conformance
//                 floor: system font, 44px targets, dark mode, focus rings, live region.
//   readerPage  — the e-reader's ~2012 WebKit. e-ink serif, paginated (not scrolled),
//                 ES5-only inline script (var / XHR / string-concat, -webkit- prefixes,
//                 px math from innerWidth/innerHeight — no flex/grid/vh/vw).
import { BASE, MCP_URL, READER_URL } from "./util";

export function landingPage(): string {
  const mcpUrl = MCP_URL;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<meta name=color-scheme content="light dark">
<title>Read it on your e-reader</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;line-height:1.5;color:#1d1d1f;background:#fff;-webkit-font-smoothing:antialiased;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;
    padding:max(24px,env(safe-area-inset-top)) 24px 64px}
  main{max-width:36rem;margin:0 auto}
  h1{font-size:2.2rem;line-height:1.08;letter-spacing:-.022em;font-weight:700;margin:3rem 0 .5rem}
  .sub{font-size:1.2rem;color:#6e6e73;margin:0 0 3rem}
  ol{list-style:none;padding:0;margin:0;display:grid;gap:2rem}
  h2{font-size:1.05rem;font-weight:600;margin:0 0 .35rem}
  li p{margin:.35rem 0}
  .url{display:flex;gap:.5rem;align-items:stretch;margin-top:.75rem}
  .url code{flex:1;min-width:0;font:1rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;
    background:#f5f5f7;border-radius:12px;padding:0 1rem;display:flex;align-items:center;overflow:auto}
  button{min-height:44px;min-width:44px;padding:0 1.1rem;font-size:1rem;font-weight:600;color:#fff;
    background:#0071e3;border:0;border-radius:12px;cursor:pointer;-webkit-appearance:none;white-space:nowrap}
  button:hover{background:#0077ed}
  button:focus-visible,code:focus-visible{outline:3px solid #0071e3;outline-offset:2px}
  .foot{margin-top:3rem;color:#86868b;font-size:.95rem}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  @media (prefers-color-scheme:dark){
    body{background:#000;color:#f5f5f7}.sub{color:#a1a1a6}
    .url code{background:#1c1c1e}.foot{color:#6e6e73}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<main>
  <h1>Read it on your e-reader</h1>
  <p class=sub>Send anything Claude writes &mdash; a long answer, a draft, a synthesis &mdash; straight to your Kindle or Kobo, and read it on e-ink instead of a screen.</p>
  <ol>
    <li>
      <h2>1&nbsp;&middot;&nbsp;Connect Claude</h2>
      <p>Add this as a custom MCP server in your Claude app (one-time, sign in with GitHub):</p>
      <div class=url><code id=u tabindex=0>${mcpUrl}</code><button id=c type=button>Copy</button></div>
    </li>
    <li>
      <h2>2&nbsp;&middot;&nbsp;Open this page on your e-reader</h2>
      <p>In its web browser, go to <b>${READER_URL}</b>. A 5-character code appears on screen.</p>
    </li>
    <li>
      <h2>3&nbsp;&middot;&nbsp;Tell Claude the code</h2>
      <p>Say &ldquo;send that to my reader, code ABCDE.&rdquo; It appears in a couple of seconds, and updates live as Claude sends more.</p>
    </li>
  </ol>
  <p class=foot>No account. Nothing you read is stored &mdash; content expires on its own. Claude remembers only your reader code, so you pair once.</p>
  <p class=foot>Reading on this device right now? <a href="${BASE}/new">Get a code</a> &mdash; some e-readers aren't auto-detected.</p>
</main>
<span id=live role=status aria-live=polite class=sr></span>
<script>
  var b=document.getElementById('c'),u=document.getElementById('u'),live=document.getElementById('live');
  b.addEventListener('click',function(){
    var done=function(){b.textContent='Copied';live.textContent='Address copied to clipboard';
      setTimeout(function(){b.textContent='Copy';},1600);};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u.textContent).then(done,done);}
    else{var r=document.createRange();r.selectNodeContents(u);var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');}catch(e){}done();}
  });
</script>
</body></html>`;
}

export function readerPage(code: string): string {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Reader ${code}</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:#fff;color:#000;-webkit-text-size-adjust:100%}
  body{font-family:Georgia,"Times New Roman",serif;width:100%} /* old Kindle WebKit misreports clientWidth without an explicit body width */
  a{color:#000;text-decoration:none}
  /* pairing */
  .pair{text-align:center;padding:54px 16px}
  .pair .lead{font-size:24px;color:#333;margin:0 0 24px}
  .pair .code{font-size:72px;font-weight:bold;letter-spacing:10px;margin:0 0 28px}
  .pair .hint{font-size:22px;color:#555;line-height:1.5}
  .pair .hint b{color:#000}
  .pair .alt{font-size:18px;color:#888;line-height:1.45;margin-top:22px}
  .pair .wait{font-size:18px;color:#888;margin-top:40px}
  /* paginated reader — absolute, not fixed: position:fixed is documented broken
     on Kindle-era WebKit; with the document never scrolling they're equivalent */
  #page{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;display:none}
  #flow{line-height:1.5;-webkit-column-fill:auto;column-fill:auto}
  #flow h1{font-size:1.55em;line-height:1.15;margin:0 0 .5em}
  #flow h2{font-size:1.22em;line-height:1.25;margin:1em 0 .3em;font-weight:bold}
  #flow h3{font-size:1.1em;line-height:1.25;margin:1em 0 .3em;font-weight:bold}
  #flow h4{font-size:1em;margin:1em 0 .3em;font-weight:bold}
  #flow p{margin:0 0 .85em;text-align:justify;-webkit-hyphens:auto;-moz-hyphens:auto;hyphens:auto}
  #flow ul,#flow ol{margin:0 0 .85em;padding-left:1.4em}
  #flow blockquote{margin:0 0 .85em;padding-left:.8em;border-left:3px solid #000;font-style:italic}
  #flow code{font-family:"Courier New",monospace;font-size:.85em;background:#f0f0f0;padding:1px 4px}
  #flow hr{border:none;border-top:1px solid #000;margin:1.2em 0}
  #flow img{max-width:100%;height:auto}
  #flow table{border-collapse:collapse;width:100%;margin:.9em 0;font-size:.82em}
  #flow th,#flow td{border:1px solid #000;padding:7px 9px;text-align:left;vertical-align:top}
  #flow th{font-weight:bold;background:#f0f0f0}
  #flow pre{background:#f4f4f4;padding:10px;font-size:.78em;overflow:hidden;
    white-space:pre-wrap;word-wrap:break-word} /* wrap, don't clip — overflow:hidden alone ate every line wider than the column */
  #flow tr{-webkit-column-break-inside:avoid;page-break-inside:avoid;break-inside:avoid} /* a row split across a page turn is unreadable; the table still breaks between rows */
  #flow li.i1{margin-left:1.1em}
  #flow li.i2{margin-left:2.2em}
  #flow li.i3{margin-left:3.3em}
  #flow .svgwrap{margin:1em 0;text-align:center}
  #flow .svgwrap svg{max-width:100%;height:auto}
  #flow .choice{display:block;border:2px solid #000;border-radius:10px;padding:14px 16px;margin:12px 0;font-size:1em;text-align:center;
    -webkit-column-break-inside:avoid;page-break-inside:avoid;break-inside:avoid} /* a button split across a page turn is untappable */
  #flow .sent{font-size:1em;font-weight:bold;padding:14px 0}
  /* tap-toggled control bar */
  #menu{position:absolute;left:0;right:0;bottom:0;background:#fff;border-top:2px solid #000;padding:10px 16px 14px;display:none;z-index:10}
  #menu .mrow{margin:8px 0}
  #menu .mbtn,#menu .qbtn{display:inline-block;border:1px solid #000;border-radius:22px;padding:9px 16px;margin:0 8px 0 0;font-size:20px}
  #menu .pageind{float:right;color:#555;font-size:18px;padding-top:10px}
  #menu .mhint{font-size:15px;color:#888;margin:2px 0 0}
  /* always-on progress footer (Kindle-style), sits in the bottom page margin */
  #foot{position:absolute;left:0;right:0;bottom:0;height:36px;line-height:36px;text-align:center;
    color:#999;font-size:15px;background:#fff;display:none;z-index:5;pointer-events:none}
</style></head><body>
<div id=h class=pair>
  <p class=lead>Your reading code</p>
  <p class=code>${code}</p>
  <p class=hint>In Claude, say:<br><b>&ldquo;send that to my reader, code ${code}&rdquo;</b></p>
  <p class=alt>&mdash; or just snap a photo of this screen and attach it to Claude. It reads the code and sends.</p>
  <p class=alt>Bookmark this page &mdash; the code stays yours when you come back.</p>
  <p class=wait>Waiting&hellip; this page updates on its own.</p>
</div>
<div id=page><div id=flow></div></div>
<div id=menu>
  <div class=mrow>
    <a href="#" id=fminus class=mbtn>A&minus;</a>
    <a href="#" id=fplus class=mbtn>A+</a>
    <span id=pageind class=pageind></span>
  </div>
  <div class=mrow>
    <a href="#" class=qbtn data-q="&#8635; simpler">&#8635; simpler</a>
    <a href="#" class=qbtn data-q="&#8594; more">&#8594; more</a>
    <a href="#" class=qbtn data-q="&#9998; explain">&#9998; explain</a>
  </div>
  <p class=mhint>Tap left / right edge to turn the page &middot; center for this menu</p>
</div>
<div id=foot></div>
<script>
(function(){
  var code=${JSON.stringify(code)};
  var base=${JSON.stringify(BASE)};
  var PAD=36, VPAD=46;
  var v=0, page=0, pages=1, menuOpen=false, lastHtml='';
  var fontPx=27; // localStorage can be disabled outright on e-readers — a throw here killed the whole script
  try{fontPx=parseInt(localStorage.getItem('lr_font'),10)||27;}catch(e){}
  if(fontPx<18)fontPx=18; if(fontPx>46)fontPx=46;
  var lastActive=+new Date();
  function active(){lastActive=+new Date();}
  // The Kindle browser reloads/crashes freely; remember where we were so a cold
  // reload of the same doc version lands on the same page, not page 1.
  var savedPos=null;
  try{var sp=(localStorage.getItem('lr_pos')||'').split(':');
    if(sp[0]===code)savedPos={v:parseInt(sp[1],10),page:parseInt(sp[2],10)};}catch(e){}

  var h=document.getElementById('h'),
      pageEl=document.getElementById('page'),
      flow=document.getElementById('flow'),
      menu=document.getElementById('menu'),
      pageind=document.getElementById('pageind'),
      foot=document.getElementById('foot');

  function vw(){return window.innerWidth||document.documentElement.clientWidth;}
  function vh(){return window.innerHeight||document.documentElement.clientHeight;}

  function layout(){
    var W=vw(), H=vh(), colW=W-2*PAD;
    flow.style.fontSize=fontPx+'px';
    flow.style.height=(H-2*VPAD)+'px';
    flow.style.width=colW+'px'; // content-box = exactly one column, so a lone column can't expand to fill and clip the right edge
    flow.style.paddingTop=VPAD+'px';
    flow.style.paddingBottom=VPAD+'px';
    flow.style.paddingLeft=PAD+'px';
    flow.style.paddingRight=PAD+'px';
    flow.style.webkitColumnWidth=colW+'px';
    flow.style.MozColumnWidth=colW+'px';
    flow.style.columnWidth=colW+'px';
    flow.style.webkitColumnGap=(2*PAD)+'px';
    flow.style.MozColumnGap=(2*PAD)+'px';
    flow.style.columnGap=(2*PAD)+'px';
  }
  function paginate(){
    layout();
    var W=vw();
    pages=Math.max(1, Math.round(flow.scrollWidth/W)); // round: each column adds ~a full W to scrollWidth, so a partial last column still rounds up — and no spurious trailing blank page
    if(page>=pages)page=pages-1; if(page<0)page=0;
    showPage();
  }
  function showPage(){
    var x=-page*vw();
    flow.style.webkitTransform='translateX('+x+'px)';
    flow.style.transform='translateX('+x+'px)';
    // the Kindle document is always scrollable regardless of overflow:hidden —
    // pin it back after every page turn (window.scrollTo doesn't exist there)
    try{document.documentElement.scrollTop=0;document.body.scrollTop=0;}catch(e){}
    var pct=(pages>1)?Math.round(page/(pages-1)*100):100;
    var label=(page+1)+' / '+pages+' · '+pct+'%';
    pageind.innerHTML=label; foot.innerHTML=label;
    try{localStorage.setItem('lr_pos',code+':'+v+':'+page);}catch(e){}
  }
  function next(){ if(page<pages-1){page++;active();showPage();} }
  function prev(){ if(page>0){page--;active();showPage();} }
  function setFont(d){ fontPx+=d; if(fontPx<18)fontPx=18; if(fontPx>46)fontPx=46;
    try{localStorage.setItem('lr_font',fontPx);}catch(e){}
    var frac=(pages>1)?(page/(pages-1)):0;   // hold the reading position through the reflow
    paginate();
    page=Math.round(frac*(pages-1)); if(page>=pages)page=pages-1; if(page<0)page=0;
    showPage(); }
  function toggleMenu(open){ menuOpen=open; menu.style.display=open?'block':'none'; }

  function isBtn(t){ while(t&&t!==document){ if(t.tagName){ var tn=t.tagName.toLowerCase();
      if(tn==='a'||tn==='button') return true; } t=t.parentNode; } return false; }

  function onTap(e){
    active();
    if(isBtn(e.target||e.srcElement)) return;
    if(menuOpen){ toggleMenu(false); return; }
    var W=vw();
    var cx=(e.clientX!=null)?e.clientX:((e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientX:W/2);
    if(cx>W*0.66) next();
    else if(cx<W*0.34) prev();
    else toggleMenu(true);
  }

  // Feedback lands in the always-on footer (the menu — and pageind with it — is
  // usually closed by the time a tap is sent). onFail lets a choice restore its
  // buttons: on flaky e-reader wifi a silently lost tap left the exercise stuck.
  function tap(label,onFail,kind){
    active(); // a tap means an answer is coming — poll fast for it
    var x=new XMLHttpRequest();
    x.open('GET',base+'/c/'+code+'?x=1&v='+v+'&k='+(kind||'a')+'&q='+encodeURIComponent(label),true);
    x.onreadystatechange=function(){
      if(x.readyState===4){
        if(x.status>=200&&x.status<300){
          // Quick actions have no waiting question — the request sits until
          // Claude next looks. Say so, and keep saying so (no revert timer);
          // any page turn or new doc naturally reclaims the footer.
          if(kind==='q'){ foot.innerHTML='✓ '+label+' — Claude will see it'; }
          else { foot.innerHTML='✓ sent'; setTimeout(showPage,1500); }
          pollNow();
        }
        else { if(onFail)onFail(); foot.innerHTML='✗ not sent — tap again'; setTimeout(showPage,2500); }
      }
    };
    x.send();
    foot.innerHTML='sending…';
  }
  function mkChoice(label){
    var el=document.createElement('a'); el.className='choice'; el.href='#';
    el.appendChild(document.createTextNode(label));
    el.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); chose(el,label); return false; };
    return el;
  }
  function chose(el,label){
    var wrap=el.parentNode; if(!wrap||!wrap.parentNode)return;
    var s=document.createElement('div'); s.className='sent';
    s.appendChild(document.createTextNode('✓ '+label));
    wrap.parentNode.replaceChild(s,wrap);
    paginate(); // buttons collapsed to one line — repaginate so the page count isn't stale
    tap(label,function(){ if(s.parentNode){ s.parentNode.replaceChild(wrap,s); paginate(); } });
  }
  function applyPos(isAppend,wasAtEnd,frac,curV){
    // Position carries over only when the new doc *extends* the old one (Claude
    // appending to a live doc). A replacement — a quiz reveal, a fresh answer —
    // always starts at the top; anchoring it to the old position showed the
    // tail of the reveal when the choices had spilled onto the last page.
    if(!isAppend){
      page=0;
      if(savedPos&&savedPos.v===curV&&savedPos.page>0&&savedPos.page<pages)page=savedPos.page; // same doc after a reload: resume
    }
    else if(wasAtEnd)page=pages-1;     // was reading the tail: follow new content
    else page=Math.round(frac*(pages-1)); // hold the same place through the reflow
    if(page>=pages)page=pages-1; if(page<0)page=0;
    showPage();
  }
  function renderDoc(d){
    var firstDoc=(pageEl.style.display!=='block');
    var raw=d.html||'';
    var isAppend=!!lastHtml&&raw.indexOf(lastHtml)===0&&raw.length>lastHtml.length;
    lastHtml=raw;
    if(savedPos&&savedPos.v!==d.v)savedPos=null; // a different doc than the one we reloaded from
    var wasAtEnd=(page>=pages-1);
    var frac=(pages>1)?(page/(pages-1)):0;
    flow.innerHTML=raw;
    if(d.title){ var hh=document.createElement('h1'); hh.appendChild(document.createTextNode(d.title));
      flow.insertBefore(hh, flow.firstChild); document.title=d.title; }
    if(d.choices&&d.choices.length){ var wrap=document.createElement('div'); wrap.className='choices';
      for(var i=0;i<d.choices.length;i++) wrap.appendChild(mkChoice(d.choices[i])); flow.appendChild(wrap); }
    h.style.display='none'; pageEl.style.display='block'; foot.style.display='block';
    layout(); pages=Math.max(1, Math.round(flow.scrollWidth/vw()));
    applyPos(isAppend,wasAtEnd,frac,d.v);
    setTimeout(function(){ layout(); pages=Math.max(1, Math.round(flow.scrollWidth/vw())); applyPos(isAppend,wasAtEnd,frac,d.v); },300); // settle after image/svg layout, then re-anchor
    if(firstDoc){ // the how-to lives in the (hidden) menu — surface it once, in the footer
      setTimeout(function(){ foot.innerHTML='Tap right edge to turn the page · center for menu'; },350);
      setTimeout(showPage,9000); // any page turn restores the label sooner
    }
  }

  document.getElementById('fminus').onclick=function(e){if(e&&e.preventDefault)e.preventDefault();setFont(-2);return false;};
  document.getElementById('fplus').onclick=function(e){if(e&&e.preventDefault)e.preventDefault();setFont(2);return false;};
  var allA=menu.getElementsByTagName('a');
  for(var k=0;k<allA.length;k++){ (function(btn){
    if(btn.getAttribute('data-q')==null) return;
    btn.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); toggleMenu(false); tap(btn.getAttribute('data-q'),null,'q'); return false; };
  })(allA[k]); }

  pageEl.onclick=onTap;
  if(window.addEventListener){ window.addEventListener('resize',function(){
    var frac=(pages>1)?(page/(pages-1)):0; // rotation reflows the page count — hold the reading position like setFont does
    paginate();
    page=Math.round(frac*(pages-1)); if(page>=pages)page=pages-1; if(page<0)page=0;
    showPage();
  },false); }

  // Wi-Fi held awake is the battery cost on e-ink — back off when idle, snap
  // back to 2.5s on any interaction or new content.
  function pollDelay(){ var idle=(+new Date())-lastActive;
    return idle<300000?2500:(idle<1800000?10000:30000); }
  // One timer handle for the whole loop: pollNow() reschedules instead of
  // spawning a second loop alongside an in-flight request.
  var pollTimer=null;
  function schedule(ms){ if(pollTimer)clearTimeout(pollTimer); pollTimer=setTimeout(poll,ms); }
  function pollNow(){ schedule(600); } // a tap just landed — the reply is close
  function poll(){
    var x=new XMLHttpRequest();
    var settled=false;
    function again(){ if(settled)return; settled=true; schedule(pollDelay()); }
    // watchdog: a hung XHR (flaky e-reader wifi) used to stop polling forever
    var dog=setTimeout(function(){ try{x.abort();}catch(e){} again(); },20000);
    x.open('GET',base+'/s/'+code+'?v='+v+'&p='+page+'&n='+pages,true); // p/n: reading-position heartbeat
    x.onreadystatechange=function(){
      if(x.readyState===4){
        clearTimeout(dog);
        if(x.status===200){ try{ var d=JSON.parse(x.responseText);
          // !== not >: after the session's 6h TTL wipe the server restarts at v=1,
          // and a page left open (holding a higher v) would otherwise go silently deaf
          if(d&&d.v&&d.v!==v){ v=d.v; active(); renderDoc(d); } }catch(e){} }
        again();
      }
    };
    x.send();
  }
  poll();
})();
</script>
</body></html>`;
}
