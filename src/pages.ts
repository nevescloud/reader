// Two surfaces, two audiences:
//   landingPage — normal browser, setup. HIG house-style over the web-conformance
//                 floor: system font, 44px targets, dark mode, focus rings, live region.
//   readerPage  — the e-reader's ~2012 WebKit. e-ink serif, paginated (not scrolled),
//                 ES5-only inline script (var / XHR / string-concat, -webkit- prefixes,
//                 px math from innerWidth/innerHeight — no flex/grid/vh/vw).
import { BASE, MCP_URL, READER_HOST } from "./util";

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
      <p>In its web browser, go to <b>${READER_HOST}</b>. A 5-character code appears on screen.</p>
    </li>
    <li>
      <h2>3&nbsp;&middot;&nbsp;Tell Claude the code</h2>
      <p>Say &ldquo;send that to my reader, code ABCDE.&rdquo; It appears in a couple of seconds, and updates live as Claude sends more.</p>
    </li>
  </ol>
  <p class=foot>No account, nothing saved. The code expires on its own.</p>
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
  body{font-family:Georgia,"Times New Roman",serif}
  a{color:#000;text-decoration:none}
  /* pairing */
  .pair{text-align:center;padding:54px 16px}
  .pair .lead{font-size:24px;color:#333;margin:0 0 24px}
  .pair .code{font-size:72px;font-weight:bold;letter-spacing:10px;margin:0 0 28px}
  .pair .hint{font-size:22px;color:#555;line-height:1.5}
  .pair .hint b{color:#000}
  .pair .wait{font-size:18px;color:#888;margin-top:40px}
  /* paginated reader */
  #page{position:fixed;top:0;left:0;right:0;bottom:0;overflow:hidden;display:none}
  #flow{line-height:1.5;-webkit-column-fill:auto;column-fill:auto}
  #flow h1{font-size:1.55em;line-height:1.15;margin:0 0 .5em}
  #flow h2{font-size:1.22em;line-height:1.25;margin:1em 0 .3em;font-weight:bold}
  #flow h3{font-size:1.1em;line-height:1.25;margin:1em 0 .3em;font-weight:bold}
  #flow h4{font-size:1em;margin:1em 0 .3em;font-weight:bold}
  #flow p{margin:0 0 .85em}
  #flow ul{margin:0 0 .85em;padding-left:1.2em}
  #flow img{max-width:100%;height:auto}
  #flow table{border-collapse:collapse;width:100%;margin:.9em 0;font-size:.82em}
  #flow th,#flow td{border:1px solid #000;padding:7px 9px;text-align:left;vertical-align:top}
  #flow th{font-weight:bold;background:#f0f0f0}
  #flow pre{background:#f4f4f4;padding:10px;font-size:.78em;overflow:hidden}
  #flow .svgwrap{margin:1em 0;text-align:center}
  #flow .svgwrap svg{max-width:100%;height:auto}
  #flow .choice{display:block;border:2px solid #000;border-radius:10px;padding:14px 16px;margin:12px 0;font-size:1em;text-align:center}
  #flow .sent{font-size:1em;font-weight:bold;padding:14px 0}
  /* tap-toggled control bar */
  #menu{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:2px solid #000;padding:10px 16px 14px;display:none;z-index:10}
  #menu .mrow{margin:8px 0}
  #menu .mbtn,#menu .qbtn{display:inline-block;border:1px solid #000;border-radius:22px;padding:9px 16px;margin:0 8px 0 0;font-size:20px}
  #menu .pageind{float:right;color:#555;font-size:18px;padding-top:10px}
  #menu .mhint{font-size:15px;color:#888;margin:2px 0 0}
</style></head><body>
<div id=h class=pair>
  <p class=lead>Your reading code</p>
  <p class=code>${code}</p>
  <p class=hint>In Claude, say:<br><b>&ldquo;send that to my reader, code ${code}&rdquo;</b></p>
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
<script>
(function(){
  var code=${JSON.stringify(code)};
  var base=${JSON.stringify(BASE)};
  var PAD=36, VPAD=46;
  var v=0, page=0, pages=1, menuOpen=false;
  var fontPx=parseInt(localStorage.getItem('lr_font'),10)||27;
  if(fontPx<18)fontPx=18; if(fontPx>46)fontPx=46;

  var h=document.getElementById('h'),
      pageEl=document.getElementById('page'),
      flow=document.getElementById('flow'),
      menu=document.getElementById('menu'),
      pageind=document.getElementById('pageind');

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
    pageind.innerHTML=(page+1)+' / '+pages;
  }
  function next(){ if(page<pages-1){page++;showPage();} }
  function prev(){ if(page>0){page--;showPage();} }
  function setFont(d){ fontPx+=d; if(fontPx<18)fontPx=18; if(fontPx>46)fontPx=46;
    try{localStorage.setItem('lr_font',fontPx);}catch(e){} page=0; paginate(); }
  function toggleMenu(open){ menuOpen=open; menu.style.display=open?'block':'none'; }

  function isBtn(t){ while(t&&t!==document){ if(t.tagName){ var tn=t.tagName.toLowerCase();
      if(tn==='a'||tn==='button') return true; } t=t.parentNode; } return false; }

  function onTap(e){
    if(isBtn(e.target||e.srcElement)) return;
    if(menuOpen){ toggleMenu(false); return; }
    var W=vw();
    var cx=(e.clientX!=null)?e.clientX:((e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientX:W/2);
    if(cx>W*0.66) next();
    else if(cx<W*0.34) prev();
    else toggleMenu(true);
  }

  function tap(label){
    var x=new XMLHttpRequest();
    x.open('GET',base+'/c/'+code+'?x=1&q='+encodeURIComponent(label),true);
    x.send();
    pageind.innerHTML='✓ sent';
    setTimeout(showPage,1500);
  }
  function mkChoice(label){
    var el=document.createElement('a'); el.className='choice'; el.href='#';
    el.appendChild(document.createTextNode(label));
    el.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); markChosen(el,label); tap(label); return false; };
    return el;
  }
  function markChosen(el,label){
    var wrap=el.parentNode; if(!wrap||!wrap.parentNode)return;
    var s=document.createElement('div'); s.className='sent';
    s.appendChild(document.createTextNode('✓ '+label));
    wrap.parentNode.replaceChild(s,wrap);
  }
  function renderDoc(d){
    flow.innerHTML=d.html||'';
    if(d.title){ var hh=document.createElement('h1'); hh.appendChild(document.createTextNode(d.title));
      flow.insertBefore(hh, flow.firstChild); document.title=d.title; }
    if(d.choices&&d.choices.length){ var wrap=document.createElement('div'); wrap.className='choices';
      for(var i=0;i<d.choices.length;i++) wrap.appendChild(mkChoice(d.choices[i])); flow.appendChild(wrap); }
    h.style.display='none'; pageEl.style.display='block';
    page=0; paginate();
    setTimeout(paginate,300); // settle after image/svg layout
  }

  document.getElementById('fminus').onclick=function(e){if(e&&e.preventDefault)e.preventDefault();setFont(-2);return false;};
  document.getElementById('fplus').onclick=function(e){if(e&&e.preventDefault)e.preventDefault();setFont(2);return false;};
  var allA=menu.getElementsByTagName('a');
  for(var k=0;k<allA.length;k++){ (function(btn){
    if(btn.getAttribute('data-q')==null) return;
    btn.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); toggleMenu(false); tap(btn.getAttribute('data-q')); return false; };
  })(allA[k]); }

  pageEl.onclick=onTap;
  if(window.addEventListener){ window.addEventListener('resize',function(){ paginate(); },false); }

  function poll(){
    var x=new XMLHttpRequest();
    x.open('GET',base+'/s/'+code+'?v='+v,true);
    x.onreadystatechange=function(){
      if(x.readyState===4){
        if(x.status===200){ try{ var d=JSON.parse(x.responseText);
          if(d&&d.v>v){ v=d.v; renderDoc(d); } }catch(e){} }
        setTimeout(poll,2500);
      }
    };
    x.send();
  }
  poll();
})();
</script>
</body></html>`;
}
