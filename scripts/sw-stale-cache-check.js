const vm=require("vm"),fs=require("fs");
async function run(file){
  const listeners={}; const stores=new Map(); const seen=[];
  // Simulated HTTP cache: serves the OLD copy unless the request bypasses/revalidates it
  const OLD="OLD-CSS", NEW="NEW-CSS";
  const mkRes=(b)=>({ok:true,status:200,_b:b,clone(){return this},text:async()=>b,json:async()=>({}),headers:{get:()=>null}});
  const fetchStub=async(input,init={})=>{
    const url=typeof input==="string"?input:input.url; const mode=(init.cache)||(input.cache)||"default";
    seen.push({url,mode});
    const bypass=mode==="reload"||mode==="no-cache"||mode==="no-store";
    return mkRes(url.endsWith(".css")?(bypass?NEW:OLD):(bypass?"NEW":"OLD"));
  };
  const caches={
    keys:async()=>[...stores.keys()],
    delete:async k=>stores.delete(k),
    open:async n=>{ if(!stores.has(n)) stores.set(n,new Map()); const m=stores.get(n);
      return {put:async(r,res)=>{m.set(typeof r==="string"?r:r.url,res)},match:async r=>m.get(typeof r==="string"?r:r.url),
              addAll:async urls=>{for(const u of urls){const res=await fetchStub(u); m.set(u,res)}}}},
    match:async(r,o)=>{const m=stores.get(o&&o.cacheName);return m&&m.get(typeof r==="string"?r:r.url)}
  };
  class Request{constructor(u,i={}){this.url=u;this.cache=i.cache;this.method="GET";this.headers={get:()=>null}}}
  const self={location:{hostname:"localhost",origin:"http://localhost"},addEventListener:(t,f)=>listeners[t]=f,skipWaiting:async()=>{},clients:{claim:async()=>{},matchAll:async()=>[]},registration:{update:async()=>{}}};
  const ctx={self,caches,fetch:fetchStub,Request,Response:{error:()=>({error:true})},URL,console};
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(file,"utf8"),ctx);
  let p; listeners.install({waitUntil:x=>{p=x}}); await p;
  const cached=await (await caches.open([...stores.keys()].find(k=>k.startsWith("beu-shell-")))).match("/css/style.css");
  const precached=await cached.text();
  // now a page request for the stylesheet through the fetch handler
  let resp; listeners.fetch({request:new Request("http://localhost/css/style.css"),respondWith:x=>{resp=x}});
  const served=await (await resp).text();
  return {precached,served};
}
(async()=>{
  // usage: node scripts/sw-stale-cache-check.js [path/to/another/service-worker.js]
  const swPath=require("path").join(__dirname,"..","service-worker.js");
  const after=await run(swPath);
  const before=process.argv[2]?await run(process.argv[2]):null;
  if(before)console.log("COMPARE   -> precached style.css:",before.precached," | served to page:",before.served);
  console.log("CURRENT   -> precached style.css:",after.precached," | served to page:",after.served,(after.precached==="NEW-CSS"&&after.served==="NEW-CSS")?"(OK: fresh)":"(STALE!)");
})();
