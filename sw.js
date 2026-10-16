/* The Real World – Service Worker
   - Eigene Dateien: erst Netz (max. 4 s), sonst gespeicherte Version → Updates kommen sofort an
   - Bibliotheken/Schriften: aus dem Speicher
   - Supabase-Anfragen werden NICHT gespeichert (die App merkt sich den Spielstand selbst, pro Benutzer) */
const P="realworld-questlog-",V=P+"v5";
const CORE=['./','index.html','gamemaster.html','manifest.json','shared/style.css','shared/config.js','shared/questlog.js','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','icons/favicon-32.png'];
const EXTRA=["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js","https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"];
const CDN=/fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net/;
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(V);await c.addAll(CORE);await Promise.allSettled(EXTRA.map(u=>c.add(u)));await self.skipWaiting();})());});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith(P)&&k!==V)await caches.delete(k);await self.clients.claim();})());});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);if(u.protocol!=='https:'&&u.protocol!=='http:')return;
  let s=null;
  if(u.origin===location.origin){if(!u.pathname.startsWith(new URL(self.registration.scope).pathname))return;s='nf';}
  else if(CDN.test(u.host))s='cf';
  if(s)e.respondWith(handle(r,s));
});
async function handle(r,s){
  const c=await caches.open(V);
  const nav=r.mode==='navigate';
  const hit=await c.match(r,{ignoreSearch:nav});
  const net=()=>fetch(r).then(async res=>{if(res.ok||res.type==='opaque')await c.put(r,res.clone());return res;});
  if(s==='cf')return hit||net();
  try{return await Promise.race([net(),new Promise((_,j)=>setTimeout(j,4000))]);}
  catch(_){return hit||(nav?await c.match('index.html'):null)||Response.error();}
}
