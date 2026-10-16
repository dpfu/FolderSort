/** Repeatable UI CPU benchmark. Uses generated images in a fresh browser profile. */
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const url = process.env.PERF_URL || 'http://127.0.0.1:4190/';
const count = Number(process.env.PERF_IMAGES || 3000);
const label = process.env.PERF_LABEL || 'current';
const cachedClip = process.env.PERF_CLIP === '1';
let features = [];
if (cachedClip) {
 const source = await fs.readFile(new URL('../src/contentSimilarity.ts', import.meta.url), 'utf8');
 const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
 const content = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
 features = Array.from({ length: count }, (_, index) => content.packVector(content.normalizeVector(Float32Array.from({ length: 512 }, (_, dimension) => Math.sin(index * .7 + dimension * .3)))));
}
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(String(error)));
const session = await context.newCDPSession(page);
await session.send('Performance.enable');
const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(({name,value}) => [name,value]));
const results = {};
async function measure(name, action) {
 const before = await metrics(), start = performance.now();
 await action();
 const after = await metrics();
 results[name] = { wallMs: +(performance.now()-start).toFixed(1), mainThreadMs: +((after.TaskDuration-before.TaskDuration)*1000).toFixed(1), scriptMs: +((after.ScriptDuration-before.ScriptDuration)*1000).toFixed(1), layoutMs: +((after.LayoutDuration-before.LayoutDuration)*1000).toFixed(1) };
}
try {
 await page.goto(url);
 await page.evaluate(async ({count,features}) => {
  const db = await new Promise((resolve,reject) => { const r=indexedDB.open('sortboard-image-library-minimal',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');ctx.fillStyle='#789ec7';ctx.fillRect(0,0,160,120);ctx.fillStyle='white';ctx.fillText('Performance fixture',8,60);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const tx=db.transaction(['projects','meta','categories','images','assets'],'readwrite');
  tx.objectStore('projects').put({id:'perf',name:'Performance fixture',createdAt:1,updatedAt:1,settings:{clipEnabled:false}},'perf');tx.objectStore('meta').put('perf','activeProjectId');
  for(let i=0;i<100;i++)tx.objectStore('categories').put({id:`stash-${i}`,projectId:'perf',name:`Stash ${i}`,createdAt:1,layoutInitialized:true},`stash-${i}`);
  for(let i=0;i<count;i++){
   const id=`image-${String(i).padStart(4,'0')}`, assigned=i>=count/2, onBoard=!assigned&&i<300;
   tx.objectStore('images').put({id,projectId:'perf',path:`${id}.png`,mime:'image/png',size:blob.size,addedAt:1,fileModifiedAt:1,categoryId:assigned?`stash-${i%100}`:null,...(features[i]?{clip:features[i]}:{}),stashOrder:i,placement:onBoard?'board':'tray',...(onBoard?{boardX:32+i%7*200,boardY:120+Math.floor(i/7)*200,boardScope:null}:{})},id);
   tx.objectStore('assets').put(blob,id);tx.objectStore('assets').put(blob,`thumbnail:v1:${id}`);
  }
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{count,features});
 await measure('restoreProject', async () => {
  await page.reload();
  await expect(page.getByRole('heading',{name:'Performance fixture',exact:true})).toBeVisible();
  if(cachedClip)await expect(page.getByRole('region',{name:'CLIP indexing'}).getByRole('status')).toHaveText(`Off · ${count.toLocaleString('en-US')} saved`);
 });
 await expect(page.getByRole('heading',{name:'Performance fixture',exact:true})).toBeVisible();
 await measure('openBoard',async()=>{await page.getByRole('button',{name:'Open sorting workspace'}).click();await expect(page.getByTestId('card-image-0000')).toBeVisible();});
 await page.waitForFunction(()=>document.querySelectorAll('.sorting-workspace__board img').length>10);
 await page.waitForTimeout(500);
 await session.send('Profiler.enable');await session.send('Profiler.start');
 await measure('select60',()=>page.evaluate(async()=>{
  for(let i=0;i<60;i++){
   const card=document.querySelector(`[data-testid="card-image-000${i%2}"]`);if(!card)throw new Error('Missing fixture card');
   card.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:0}));
   await new Promise(requestAnimationFrame);
  }
 }));
 await measure('pileScroll90',()=>page.evaluate(async()=>{
  const pile=document.querySelector('.sorting-workspace__tray-scroll');
  for(let i=0;i<90;i++){pile.scrollLeft=120*i;await new Promise(requestAnimationFrame);}
 }));
 await measure('boardPan90',()=>page.evaluate(async()=>{
  const board=document.querySelector('[data-testid="board-root"]');const top=board.scrollTop;
  for(let i=0;i<90;i++){board.scrollTop=top+20*i;await new Promise(requestAnimationFrame);}
 }));
 const {profile}=await session.send('Profiler.stop');
 const byId=new Map(profile.nodes.map(node=>[node.id,node]));const samples=new Map();
 for(let i=0;i<(profile.samples||[]).length;i++){const node=byId.get(profile.samples[i]);const key=node.callFrame.functionName||`(anonymous:${node.callFrame.lineNumber})`;samples.set(key,(samples.get(key)||0)+(profile.timeDeltas?.[i]||0));}
 const topFunctions=[...samples].sort((a,b)=>b[1]-a[1]).slice(0,22).map(([name,microseconds])=>({name,ms:Math.round(microseconds/1000)}));
 if(process.env.PERF_PROFILE)await fs.writeFile(process.env.PERF_PROFILE,JSON.stringify(profile));
 console.log(JSON.stringify({label,url,count,cachedClip,results,topFunctions,pageErrors:errors},null,2));
 expect(errors).toEqual([]);
} finally {await context.close();await browser.close();}
