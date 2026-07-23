// Two surfaces, two audiences:
//   landingPage — normal browser, setup. HIG house-style over the web-conformance
//                 floor: system font, 44px targets, dark mode, focus rings, live region.
//   readerPage  — the e-reader's ~2012 WebKit. e-ink serif, paginated (not scrolled),
//                 ES5-only inline script (var / XHR / string-concat, -webkit- prefixes,
//                 px math from innerWidth/innerHeight — no flex/grid/vh/vw).
import { ADD_TO_CLAUDE_URL, MCP_URL, READER_URL } from "./util";

// Official Claude spark (Simple Icons path, brand coral) — decorative next to the
// "Add to Claude" label, so aria-hidden.
const CLAUDE_SPARK = `<svg aria-hidden=true focusable=false fill="#D97757" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>`;

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
  button:focus-visible,code:focus-visible,.cta:focus-visible{outline:3px solid #0071e3;outline-offset:2px}
  .cta{display:inline-flex;align-items:center;gap:.6rem;min-height:48px;padding:.6rem 1.4rem;margin:.75rem 0 .25rem;
    border:1px solid #d2d2d7;border-radius:12px;background:#fff;color:inherit;text-decoration:none;
    font-size:1.05rem;font-weight:600}
  .cta:hover{background:#f5f5f7}
  .cta svg{width:22px;height:22px;flex:none}
  .or{color:#6e6e73;font-size:.95rem}
  .foot{margin-top:3rem;color:#86868b;font-size:.95rem}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  @media (prefers-color-scheme:dark){
    body{background:#000;color:#f5f5f7}.sub{color:#a1a1a6}
    .url code{background:#1c1c1e}.foot{color:#6e6e73}
    .cta{background:#1c1c1e;border-color:#3a3a3c}
    .cta:hover{background:#2c2c2e}
    .or{color:#a1a1a6}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<main>
  <h1>Read it on your e-reader</h1>
  <p class=sub>Send anything Claude writes &mdash; a long answer, a draft, a synthesis &mdash; straight to your Kindle or Kobo, and read it on e-ink instead of a screen.</p>
  <ol>
    <li>
      <h2>1&nbsp;&middot;&nbsp;Connect Claude</h2>
      <p>One click &mdash; opens Claude with this connector prefilled; review it and press <b>Add</b>:</p>
      <a class=cta href="${ADD_TO_CLAUDE_URL.replace(/&/g, "&amp;")}">${CLAUDE_SPARK}Add to Claude</a>
      <p class=or>Or paste the address yourself (Claude &rarr; Settings &rarr; Connectors &rarr; Add custom connector):</p>
      <div class=url><code id=u tabindex=0>${mcpUrl}</code><button class=copy data-copy=u type=button>Copy</button></div>
      <p class=or>Or, in Claude Code:</p>
      <div class=url><code id=cc tabindex=0>claude mcp add --transport http reader ${mcpUrl}</code><button class=copy data-copy=cc type=button>Copy</button></div>
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
  <p class=foot>No account, no sign-in. Nothing you read is stored &mdash; content expires on its own. The code on your screen is the only key.</p>
  <p class=foot>Want to read on this device instead &mdash; phone, tablet, or an e-reader that wasn't auto-detected? <a href="/new">Get a code</a>.</p>
</main>
<span id=live role=status aria-live=polite class=sr></span>
<script>
  var live=document.getElementById('live');
  var copies=document.querySelectorAll('.copy');
  for(var i=0;i<copies.length;i++)(function(b){
    var u=document.getElementById(b.getAttribute('data-copy'));
    b.addEventListener('click',function(){
      var done=function(){b.textContent='Copied';live.textContent='Copied to clipboard';
        setTimeout(function(){b.textContent='Copy';},1600);};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u.textContent).then(done,done);}
      else{var r=document.createRange();r.selectNodeContents(u);var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');}catch(e){}done();}
    });
  })(copies[i]);
</script>
</body></html>`;
}

export function readerPage(code: string): string {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Reader ${code}</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:#fff;color:#000;-webkit-text-size-adjust:100%;overscroll-behavior:none}
  body{font-family:Georgia,"Times New Roman",serif;width:100%;touch-action:manipulation} /* old Kindle WebKit misreports clientWidth without an explicit body width; unknown props (overscroll/touch-action) it just ignores */
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
  #flow span.mark{background:#000;color:#fff} /* inline only — no border/padding, so highlighting never reflows the columns */
  /* explain-mode selection tray (same absolute-bottom pattern as #menu) */
  #selbar{position:absolute;left:0;right:0;bottom:0;background:#fff;border-top:2px solid #000;padding:10px 16px 14px;display:none;z-index:11}
  #selbar .spreview{font-size:17px;color:#555;margin:0 0 8px;overflow:hidden;white-space:nowrap}
  #selbar .sbtn{display:inline-block;border:2px solid #000;border-radius:22px;padding:10px 18px;margin:0 10px 0 0;font-size:20px;font-weight:bold}
  /* tap-toggled control bar */
  #menu{position:absolute;left:0;right:0;bottom:0;background:#fff;border-top:2px solid #000;padding:10px 16px 14px;display:none;z-index:10}
  #menu .mrow{margin:8px 0}
  #menu .mbtn,#menu .qbtn{display:inline-block;border:1px solid #000;border-radius:22px;padding:9px 16px;margin:0 8px 0 0;font-size:20px}
  #menu .pageind{float:right;color:#555;font-size:18px;padding-top:10px}
  #menu .mhint{font-size:15px;color:#888;margin:2px 0 0}
  /* always-on progress footer (Kindle-style), sits in the bottom page margin */
  #foot{position:absolute;left:0;right:0;bottom:0;height:36px;line-height:36px;text-align:center;
    color:#999;font-size:15px;background:#fff;display:none;z-index:5;pointer-events:none}
  /* OLED/mobile night reading. E-ink never sees this: Kindle-era WebKit doesn't
     know prefers-color-scheme, so the whole block evaluates false there. */
  @media (prefers-color-scheme:dark){
    html,body{background:#000;color:#ddd}
    a{color:#ddd}
    .pair .lead{color:#ccc}.pair .hint{color:#aaa}.pair .hint b{color:#fff}
    #flow blockquote{border-left-color:#ddd}
    #flow code{background:#222}
    #flow hr{border-top-color:#ddd}
    #flow th,#flow td{border-color:#ddd}
    #flow th{background:#222}
    #flow pre{background:#1a1a1a}
    #flow span.mark{background:#fff;color:#000}
    #flow .svgwrap svg{filter:invert(1)} /* diagrams are grayscale by design (e-ink), so a plain invert is exact */
    #flow .choice{border-color:#ddd}
    #selbar,#menu,#foot{background:#000;border-top-color:#ddd}
    #selbar .sbtn,#menu .mbtn,#menu .qbtn{border-color:#ddd}
  }
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
    <a href="#" id=qexplain class=qbtn>&#9998; explain&hellip;</a>
  </div>
  <p class=mhint>Tap left / right edge to turn the page &middot; center for this menu</p>
</div>
<div id=selbar>
  <p class=spreview id=spreview></p>
  <a href="#" id=sbword class=sbtn>Explain word</a>
  <a href="#" id=sbsent class=sbtn>Sentence</a>
  <a href="#" id=sbcancel class=sbtn>Cancel</a>
</div>
<div id=foot role=status aria-live=polite></div>
<script>
(function(){
  var code=${JSON.stringify(code)};
  var PAD=36, VPAD=46;
  var v=0, page=0, pages=1, menuOpen=false, lastHtml='';
  // 21px Georgia ≈ book-body size on e-ink; the old 27 default read as large-print.
  // Per-device A−/A+ (persisted in lr_font) tunes from here; 18–46 clamp.
  var fontPx=21; // localStorage can be disabled outright on e-readers — a throw here killed the whole script
  try{fontPx=parseInt(localStorage.getItem('lr_font'),10)||21;}catch(e){}
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
      foot=document.getElementById('foot'),
      selbar=document.getElementById('selbar'),
      spreview=document.getElementById('spreview'),
      sbword=document.getElementById('sbword'),
      sbsent=document.getElementById('sbsent');
  // explain mode: armed via menu ✎ explain…; the next content tap designates a
  // word (caretRangeFromPoint) or a block (fallback), confirmed in #selbar.
  var exMode=false, exSel=null, exMark=null;

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
    if(swiped){swiped=false;return;} // this click is the tail of a swipe, not a tap
    active();
    if(isBtn(e.target||e.srcElement)) return;
    if(menuOpen){ toggleMenu(false); return; }
    var W=vw();
    var cx=(e.clientX!=null)?e.clientX:((e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientX:W/2);
    if(exMode){ // whole surface designates while armed — text sits under the page-turn thirds too
      var cy=(e.clientY!=null)?e.clientY:((e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientY:vh()/2);
      pickAt(cx,cy,e.target||e.srcElement);
      return;
    }
    if(cx>W*0.66) next();
    else if(cx<W*0.34) prev();
    else toggleMenu(true);
  }

  // Feedback lands in the always-on footer (the menu — and pageind with it — is
  // usually closed by the time a tap is sent). onFail lets a choice restore its
  // buttons: on flaky e-reader wifi a silently lost tap left the exercise stuck.
  function tap(label,onFail,kind,extra){
    active(); // a tap means an answer is coming — poll fast for it
    var x=new XMLHttpRequest();
    x.open('GET','/c/'+code+'?x=1&v='+v+'&k='+(kind||'a')+'&q='+encodeURIComponent(label)+(extra||''),true);
    x.onreadystatechange=function(){
      if(x.readyState===4){
        if(x.status>=200&&x.status<300){
          // Quick actions and explain-requests have no waiting question — the
          // request sits until Claude next looks. Say so, and keep saying so
          // (no revert timer); any page turn or new doc reclaims the footer.
          if(kind==='q'){ foot.innerHTML='✓ '+label+' — Claude will see it'; }
          else if(kind==='e'){ foot.innerHTML='✓ explain requested — Claude will see it'; }
          else { foot.innerHTML='✓ sent'; setTimeout(showPage,1500); }
          pollNow();
        }
        else { if(onFail)onFail(); foot.innerHTML='✗ not sent — tap again'; setTimeout(showPage,2500); }
      }
    };
    x.send();
    foot.innerHTML='sending…';
  }

  // ---- explain mode: designate a word / sentence / block for the driving
  // session to explain in context. Wire: k=e, q=quote, b/a=anchors, g=granularity.
  var WCH=/[A-Za-z0-9À-ɏ'’-]/;
  function collapse(s){ return (s||'').replace(/\s+/g,' ').replace(/^ | $/g,''); }
  function inFlow(n){ while(n){ if(n===flow) return true; n=n.parentNode; } return false; }
  function inSvg(n){ while(n&&n!==flow){ if(n.nodeType===1&&n.tagName&&n.tagName.toLowerCase()==='svg') return true; n=n.parentNode; } return false; }
  function nearestBlock(n){
    while(n&&n!==flow){
      if(n.nodeType===1){ var t=n.tagName.toLowerCase();
        if(t==='p'||t==='li'||t==='blockquote'||t==='h1'||t==='h2'||t==='h3'||t==='h4'||t==='td'||t==='th'||t==='pre'||t==='div') return n; }
      n=n.parentNode;
    }
    return null;
  }
  function armExplain(){
    exMode=true; clearSel(); hideSelbar();
    foot.innerHTML='&#9998; Tap any word to explain it &middot; tap here to cancel';
    foot.style.pointerEvents='auto';
    foot.onclick=function(){ cancelExplain(); };
  }
  function cancelExplain(){
    exMode=false; clearSel(); hideSelbar();
    foot.style.pointerEvents='none'; foot.onclick=null;
    showPage(); // restores the page label in the footer
  }
  function clearSel(){
    if(exMark&&exMark.parentNode){
      var p=exMark.parentNode;
      p.replaceChild(document.createTextNode(exMark.firstChild?exMark.firstChild.data:''),exMark);
      try{p.normalize();}catch(e){}
    }
    exMark=null; exSel=null;
  }
  function hideSelbar(){ selbar.style.display='none'; }
  function pickAt(x,y,tgt){
    clearSel(); // before hit-testing: normalize() from a prior selection must not invalidate the new node
    var node=null, off=0;
    try{
      if(document.caretRangeFromPoint){
        var r=document.caretRangeFromPoint(x,y);
        if(r&&r.startContainer&&r.startContainer.nodeType===3&&inFlow(r.startContainer)&&!inSvg(r.startContainer)){
          node=r.startContainer; off=r.startOffset;
        }
      }
    }catch(e){ node=null; }
    if(node){ selectWord(node,off); return; }
    // fallback: block-level target (also the path for SVG labels and engines without caretRangeFromPoint)
    var el=tgt&&inFlow(tgt)?tgt:(document.elementFromPoint?document.elementFromPoint(x,y):null);
    var blk=el?nearestBlock(el.nodeType===3?el.parentNode:el):null;
    if(blk){ exSel={mode:'b',blockEl:blk}; showSelbar(); }
    else { foot.innerHTML='&#9998; Nothing there &mdash; tap a word, or tap here to cancel'; }
  }
  function selectWord(node,off){
    var t=node.data||'';
    var i=off; if(i>=t.length)i=t.length-1; if(i<0)i=0;
    if(!WCH.test(t.charAt(i))){ // tapped between words — nudge to the nearest word char
      var j=1,found=-1;
      while(j<=2&&found<0){
        if(i-j>=0&&WCH.test(t.charAt(i-j)))found=i-j;
        else if(i+j<t.length&&WCH.test(t.charAt(i+j)))found=i+j;
        j++;
      }
      if(found<0){ var blk0=nearestBlock(node.parentNode); if(blk0){ exSel={mode:'b',blockEl:blk0}; showSelbar(); } return; }
      i=found;
    }
    var s=i,e2=i;
    while(s>0&&WCH.test(t.charAt(s-1)))s--;
    while(e2<t.length-1&&WCH.test(t.charAt(e2+1)))e2++;
    var word=t.substring(s,e2+1);
    var mid=node.splitText(s); mid.splitText(e2+1-s);
    var sp=document.createElement('span'); sp.className='mark';
    mid.parentNode.replaceChild(sp,mid); sp.appendChild(mid);
    exMark=sp;
    exSel={mode:'w',word:word,blockEl:nearestBlock(sp)};
    showSelbar();
  }
  function showSelbar(){
    while(spreview.firstChild)spreview.removeChild(spreview.firstChild);
    if(exSel.mode==='w'){
      spreview.appendChild(document.createTextNode('“'+exSel.word+'”'));
      sbword.innerHTML='Explain word'; sbsent.style.display='inline-block';
    } else {
      var bt=collapse(exSel.blockEl?exSel.blockEl.textContent:'');
      spreview.appendChild(document.createTextNode('“'+bt.substring(0,60)+(bt.length>60?'…':'')+'”'));
      sbword.innerHTML='Explain this block'; sbsent.style.display='none';
    }
    selbar.style.display='block';
  }
  function offsetInBlock(blk,target){ // document-order textContent offset of target's text start within blk
    var o=0, done=false;
    function walk(n){
      if(done)return;
      if(n===target){done=true;return;}
      if(n.nodeType===3){o+=n.data.length;return;}
      for(var i=0;i<n.childNodes.length;i++)walk(n.childNodes[i]);
    }
    walk(blk);
    return done?o:-1;
  }
  function sentenceAround(){ // expand the marked word to sentence bounds within its block's textContent
    var blk=exSel.blockEl; if(!blk||!exMark)return null;
    var full=blk.textContent||'';
    var o=offsetInBlock(blk,exMark); if(o<0)return null;
    var s=o;
    while(s>0){ var ch=full.charAt(s-1); if((ch==='.'||ch==='!'||ch==='?')&&/\s/.test(full.charAt(s)||' ')) break; s--; }
    var j=o+exSel.word.length;
    while(j<full.length){ var c2=full.charAt(j); j++; if(c2==='.'||c2==='!'||c2==='?') break; }
    return {text:collapse(full.substring(s,j)),start:s,end:j,full:full};
  }
  function sendExplain(gran){
    var q='',b='',a2='';
    if(gran==='block'||!exMark){
      gran='block';
      q=collapse(exSel.blockEl?exSel.blockEl.textContent:'').substring(0,300);
    } else if(gran==='sentence'){
      var sn=sentenceAround();
      if(!sn){ gran='word'; }
      else{
        q=sn.text.substring(0,300);
        b=collapse(sn.full.substring(sn.start<80?0:sn.start-80,sn.start));
        a2=collapse(sn.full.substring(sn.end,sn.end+80));
      }
    }
    if(gran==='word'){
      var blk=exSel.blockEl, o=blk?offsetInBlock(blk,exMark):-1;
      q=exSel.word;
      if(blk&&o>=0){ var full=blk.textContent||'';
        b=collapse(full.substring(o<80?0:o-80,o));
        a2=collapse(full.substring(o+q.length,o+q.length+80));
      }
    }
    if(!q){ cancelExplain(); return; }
    var extra='&g='+gran+(b?'&b='+encodeURIComponent(b):'')+(a2?'&a='+encodeURIComponent(a2):'');
    hideSelbar(); clearSel();
    exMode=false; foot.style.pointerEvents='none'; foot.onclick=null;
    tap(q,null,'e',extra);
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
    if(exMode)cancelExplain(); else clearSel(); // stale marks/offsets must not outlive their doc
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
  document.getElementById('qexplain').onclick=function(e){if(e&&e.preventDefault)e.preventDefault();toggleMenu(false);armExplain();return false;};
  sbword.onclick=function(e){if(e&&e.preventDefault)e.preventDefault();sendExplain(exSel&&exSel.mode==='w'?'word':'block');return false;};
  sbsent.onclick=function(e){if(e&&e.preventDefault)e.preventDefault();sendExplain('sentence');return false;};
  document.getElementById('sbcancel').onclick=function(e){if(e&&e.preventDefault)e.preventDefault();clearSel();hideSelbar();
    foot.innerHTML='&#9998; Tap any word to explain it &middot; tap here to cancel';return false;}; // deselect, stay armed — a mis-tap is cheap
  var allA=menu.getElementsByTagName('a');
  for(var k=0;k<allA.length;k++){ (function(btn){
    if(btn.getAttribute('data-q')==null) return;
    btn.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); toggleMenu(false); tap(btn.getAttribute('data-q'),null,'q'); return false; };
  })(allA[k]); }

  pageEl.onclick=onTap;
  // Swipe page-turns (phones/tablets). A ≥60px horizontal drag turns the page;
  // browsers don't synthesize a click after a real drag, but the swiped flag suppresses
  // one on any engine that does. Armed explain-mode and the menu keep tap-only
  // semantics, so a swipe there does nothing.
  var swX=null,swY=null,swiped=false;
  if(pageEl.addEventListener){
    pageEl.addEventListener('touchstart',function(e){
      var t=e.touches&&e.touches[0]; swX=t?t.clientX:null; swY=t?t.clientY:null; swiped=false;
    },false);
    pageEl.addEventListener('touchend',function(e){
      if(swX==null)return;
      var t=e.changedTouches&&e.changedTouches[0]; if(!t)return;
      var dx=t.clientX-swX, dy=t.clientY-swY; swX=null;
      if(menuOpen||exMode)return;
      if(Math.abs(dx)>60&&Math.abs(dy)<50){ swiped=true; active(); if(dx<0)next(); else prev(); }
    },false);
  }
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
    x.open('GET','/s/'+code+'?v='+v+'&p='+page+'&n='+pages,true); // p/n: reading-position heartbeat
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
