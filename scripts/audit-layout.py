# Layout audit: flags card rows that leave a card alone and body text wider than ~90 characters.
# Run: python3 -m http.server 8765 (in repo root), then python3 scripts/audit-layout.py 390,768,1280,1512
import sys, json, asyncio
from playwright.async_api import async_playwright
PAGES=["index.html","products.html","company.html","build.html","learn.html","store.html","investors.html","defender.html","smartpump.html","contact.html","card.html","privacy.html","media/index.html","media/access.html"]
WIDTHS=[int(w) for w in (sys.argv[1] if len(sys.argv)>1 else "1280,1440,1512,1728").split(",")]
JS=r"""
() => {
 const out={orphans:[],wide:[]};
 const sel=el=>{let s=el.tagName.toLowerCase();if(el.id)s+='#'+el.id;if(el.className&&typeof el.className=='string')s+='.'+el.className.trim().split(/\s+/).join('.');return s};
 const path=el=>{const p=[];while(el&&el!==document.body&&p.length<3){p.unshift(sel(el));el=el.parentElement}return p.join(' > ')};
 for(const el of document.querySelectorAll('body *')){
   const cs=getComputedStyle(el);
   const isGrid=cs.display.includes('grid'); const isWrap=cs.display.includes('flex')&&cs.flexWrap==='wrap'&&cs.flexDirection.startsWith('row');
   if(!isGrid&&!isWrap) continue;
   const kids=[...el.children].filter(k=>{const r=k.getBoundingClientRect();const c=getComputedStyle(k);return r.width>0&&r.height>0&&c.position!=='absolute'});
   if(kids.length<3) continue;
   // skip small inline chip/button rows
   if(kids.every(k=>k.getBoundingClientRect().height<60)) continue;
   const rows={};for(const k of kids){const t=Math.round(k.getBoundingClientRect().top);rows[t]=(rows[t]||0)+1}
   const counts=Object.keys(rows).map(Number).sort((a,b)=>a-b).map(t=>rows[t]);
   if(counts.length>1&&counts[0]>1&&counts[counts.length-1]<counts[0]) out.orphans.push({el:path(el),rows:counts,n:kids.length});
 }
 for(const el of document.querySelectorAll('p,li,.lede,blockquote,dd')){
   const r=el.getBoundingClientRect(); if(!r.width||el.textContent.trim().length<90) continue;
   const fs=parseFloat(getComputedStyle(el).fontSize); const ch=r.width/(fs*0.5);
   if(ch>90 && !el.closest(".deck .foot,.slide.cover")) out.wide.push({el:path(el),w:Math.round(r.width),ch:Math.round(ch),t:el.textContent.trim().slice(0,50)});
 }
 return out;
}
"""
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for w in WIDTHS:
      pg=await b.new_page(viewport={"width":w,"height":900})
      for u in PAGES:
        await pg.goto("http://localhost:8765/"+u, wait_until="load")
        r=await pg.evaluate(JS)
        for o in r["orphans"]: print(f"[{w}] ORPHAN {u}: {o['el']} rows={o['rows']}")
        for o in r["wide"]: print(f"[{w}] WIDE {u}: {o['el']} {o['w']}px ~{o['ch']}ch :: {o['t']}")
      await pg.close()
    await b.close()
asyncio.run(main())
