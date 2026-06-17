// Two surfaces, two audiences:
//   landingPage — normal browser, setup. HIG house-style over the web-conformance
//                 floor: system font, 44px targets, dark mode, focus rings, live region.
//   readerPage  — the e-reader's ~2012 WebKit. e-ink serif, no flex/grid, ES5-only
//                 inline script (var / XHR / string-concat — no template literals).
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
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Reader ${code}</title>
<style>
  html,body{margin:0;padding:0;background:#fff;color:#000}
  body{font-family:Georgia,"Times New Roman",serif;font-size:26px;line-height:1.55;padding:40px;-webkit-text-size-adjust:100%}
  a{color:#000}
  h1{font-size:42px;line-height:1.2;margin:0 0 16px 0}
  article{font-size:27px}
  article p{margin:0 0 1em 0}
  article img{max-width:100%;height:auto}
  article h2,article h3,article h4{font-weight:bold;line-height:1.25;margin:1.1em 0 .25em}
  article h2{font-size:32px}
  article h3{font-size:29px}
  article h4{font-size:27px}
  .pair{text-align:center;padding:54px 16px}
  .pair .lead{font-size:24px;color:#333;margin:0 0 24px}
  .pair .code{font-size:72px;font-weight:bold;letter-spacing:10px;margin:0 0 28px}
  .pair .hint{font-size:22px;color:#555;line-height:1.5}
  .pair .hint b{color:#000}
  .pair .wait{font-size:18px;color:#888;margin-top:40px}
  /* tap-to-choose + quick actions */
  .choices{margin:8px 0 0}
  .choice{display:block;border:2px solid #000;border-radius:10px;padding:18px 20px;margin:14px 0;font-size:25px;text-align:center;text-decoration:none;color:#000}
  .sent{font-size:24px;font-weight:bold;padding:18px 0;color:#000}
  .qa{margin-top:40px;border-top:1px solid #999;padding-top:14px}
  .qa .qatitle{font-size:18px;color:#777;margin-right:6px}
  .qa .qbtn{display:inline-block;border:1px solid #000;border-radius:22px;padding:9px 16px;margin:6px 8px 0 0;font-size:19px;text-decoration:none;color:#000}
</style></head><body>
<div id=h class=pair>
  <p class=lead>Your reading code</p>
  <p class=code>${code}</p>
  <p class=hint>In Claude, say:<br><b>&ldquo;send that to my reader, code ${code}&rdquo;</b></p>
  <p class=wait>Waiting&hellip; this page updates on its own.</p>
</div>
<h1 id=t style="display:none"></h1>
<article id=a></article>
<div id=choices class=choices></div>
<div id=qa class=qa style="display:none">
  <span class=qatitle>Quick:</span>
  <a href="#" class=qbtn data-q="&#8635; simpler">&#8635; simpler</a>
  <a href="#" class=qbtn data-q="&#8594; more">&#8594; more</a>
  <a href="#" class=qbtn data-q="&#9998; explain">&#9998; explain</a>
</div>
<script>
(function(){
  var code=${JSON.stringify(code)};
  var base=${JSON.stringify(BASE)};
  var v=0;
  var h=document.getElementById('h'),t=document.getElementById('t'),a=document.getElementById('a'),
      cw=document.getElementById('choices'),qa=document.getElementById('qa');

  function tap(label){
    var x=new XMLHttpRequest();
    x.open('GET',base+'/c/'+code+'?x=1&q='+encodeURIComponent(label),true);
    x.send();
    var s=document.createElement('div'); s.className='sent';
    s.appendChild(document.createTextNode('✓ Sent: '+label));
    cw.innerHTML=''; cw.appendChild(s);
  }
  function mkbtn(label){
    var el=document.createElement('a'); el.className='choice'; el.href='#';
    el.appendChild(document.createTextNode(label));
    el.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); tap(label); return false; };
    return el;
  }
  function renderChoices(list){
    cw.innerHTML='';
    if(list&&list.length){ for(var i=0;i<list.length;i++) cw.appendChild(mkbtn(list[i])); }
  }
  var qbtns=qa.getElementsByTagName('a');
  for(var k=0;k<qbtns.length;k++){ (function(btn){
    btn.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); tap(btn.getAttribute('data-q')); return false; };
  })(qbtns[k]); }

  function poll(){
    var x=new XMLHttpRequest();
    x.open('GET',base+'/s/'+code+'?v='+v,true);
    x.onreadystatechange=function(){
      if(x.readyState===4){
        if(x.status===200){
          try{
            var d=JSON.parse(x.responseText);
            if(d&&d.v>v){
              v=d.v;
              if(d.title){document.title=d.title;t.textContent=d.title;t.style.display='block';}
              a.innerHTML=d.html;
              renderChoices(d.choices);
              h.style.display='none'; qa.style.display='block';
              window.scrollTo(0,0);
            }
          }catch(e){}
        }
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
