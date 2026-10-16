/** Compare saved CLIP cache work with a prior revision, in one browser process.
 * No images, inference, model downloads or approximate results are involved. */
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { chromium } from '@playwright/test';
const baseline = process.env.PERF_BASELINE || '2031e3f';
const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
const before = compile(execFileSync('git', ['show', `${baseline}:src/contentSimilarity.ts`], { encoding: 'utf8' }));
const after = compile(await fs.readFile(new URL('../src/contentSimilarity.ts', import.meta.url), 'utf8'));
const browser = await chromium.launch();
try {
 const page = await browser.newPage();
 const report = await page.evaluate(async ({before,after,count}) => {
  const versions={before:await import(before),after:await import(after)};
  const vectors=Array.from({length:count},(_,index)=>versions.before.normalizeVector(Float32Array.from({length:512},(_,dimension)=>Math.sin(index*.7+dimension*.3))));
  const saved=vectors.map(versions.before.packVector);
  for(let i=0;i<count;i++)if(versions.after.packVector(vectors[i]).vector!==saved[i].vector)throw new Error('Cache bytes changed');
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const results={};
  for(const [name,action] of [
   ['validateSavedIndex',module=>{if(saved.filter(module.hasCurrentContent).length!==count)throw new Error('Invalid fixture index');}],
   ['decodeSavedIndex',module=>{for(const item of saved)module.unpackVector(item);}],
   ['encodeIndex',module=>{for(const vector of vectors)module.packVector(vector);}],
  ]){
   const samples={before:[],after:[]};action(versions.before);action(versions.after);
   for(let round=0;round<7;round++)for(const key of round%2?['after','before']:['before','after']){const start=performance.now();action(versions[key]);samples[key].push(performance.now()-start);}
   const oldMs=median(samples.before),newMs=median(samples.after);
   results[name]={beforeMedianMs:+oldMs.toFixed(2),afterMedianMs:+newMs.toFixed(2),speedup:+(oldMs/newMs).toFixed(1)};
  }
  return {count,browser:navigator.userAgent,nativeBase64:typeof Uint8Array.fromBase64==='function',results};
 }, {before,after,count:Number(process.env.PERF_IMAGES||3000)});
 console.log(JSON.stringify({baseline,...report},null,2));
} finally {await browser.close();}
