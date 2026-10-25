import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.join(process.env.BB_THREAD_STORAGE, 'subway-v2');
const base = 'http://127.0.0.1:5190';
const targets = await (await fetch('http://127.0.0.1:9340/json/list')).json();
const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.onopen = resolve);
let sequence = 0;
const pending = new Map(), errors = [];
socket.onmessage = event => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (!msg.id) return;
  const request = pending.get(msg.id); pending.delete(msg.id);
  if (msg.error) request.reject(Error(JSON.stringify(msg.error))); else request.resolve(msg.result);
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(expression) {
  for (let i = 0; i < 160; i++) { const result = await evaluate(expression); if (result) return result; await pause(100); }
  throw Error('Timed out: ' + expression);
}
async function shot(name) {
  const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(output, name + '.png'), Buffer.from(capture.data, 'base64'));
}
async function viewport(width, height, dpr = 1) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false }); await pause(250);
}
async function navigate(role) {
  await call('Page.navigate', { url: `${base}/src/plugins/subway/subway-dashboard.browser.html?view=${role}` });
  await wait('!!window.__subwayDashboardCheck'); await pause(450); await evaluate('document.fonts.ready');
}
async function click(selector, index = 0) {
  const p = await evaluate(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if(!e) throw Error('Missing '+${JSON.stringify(selector)}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 }); await pause(60);
}
await mkdir(output, { recursive: true });
await call('Runtime.discardConsoleEntries'); await call('Runtime.enable'); await call('Page.enable');
if(process.argv.includes('--site')) {
  await viewport(1360,860);
  await call('Page.navigate',{url:'https://yamanote-3d.com/?lang=en&mode=audio'});await pause(4500);
  console.log(JSON.stringify(await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,title:b.title,aria:b.getAttribute('aria-label')})),canvases:[...document.querySelectorAll('canvas')].map(c=>({w:c.width,h:c.height,rect:c.getBoundingClientRect().toJSON()}))})`),null,2));
  await shot('reference-site-initial');socket.close();process.exit(0);
}
if(process.argv.includes('--site-act')) {
  console.log(JSON.stringify(await evaluate(`({links:[...document.querySelectorAll('a')].map(e=>({text:e.textContent,href:e.href})),selects:[...document.querySelectorAll('select')].map(e=>({id:e.id,name:e.name,options:[...e.options].map(o=>({v:o.value,t:o.textContent}))}))})`)));
  await evaluate(`([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Board the train'))?.click();undefined`);await pause(8000);
  console.log(JSON.stringify(await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,title:b.title,aria:b.getAttribute('aria-label')})),canvases:[...document.querySelectorAll('canvas')].map(c=>({w:c.width,h:c.height,rect:c.getBoundingClientRect().toJSON()}))})`)));
  await shot('reference-site-boarded');socket.close();process.exit(0);
}
if(process.argv.includes('--site-display')) {
  await evaluate(`document.querySelector('button[aria-label^="Audio only"]')?.click();undefined`);await pause(8000);
  console.log(JSON.stringify(await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,title:b.title,aria:b.getAttribute('aria-label')})),canvases:[...document.querySelectorAll('canvas')].map(c=>({w:c.width,h:c.height,rect:c.getBoundingClientRect().toJSON()}))})`)));
  console.log(JSON.stringify({errors,resources:await evaluate(`performance.getEntriesByType('resource').slice(-8).map(r=>({name:r.name,bytes:r.transferSize,duration:r.duration,status:r.responseStatus}))`)}));
  await shot('reference-site-display');socket.close();process.exit(0);
}
if(process.argv.includes('--site-retry') || process.argv.includes('--site-clean')) {
  await viewport(1360,860);await call('Page.navigate',{url:'https://yamanote-3d.com/?lang=en&mode=audio'});await pause(2500);
  await evaluate(`([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Board the train')).dataset.v2Board='true';undefined`);
  await click('[data-v2-board]');await pause(500);await click('button[aria-label^="Audio only"]');await pause(5000);
  console.log(JSON.stringify(await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,title:b.title,aria:b.getAttribute('aria-label')})),canvases:[...document.querySelectorAll('canvas')].map(c=>({w:c.width,h:c.height,rect:c.getBoundingClientRect().toJSON()}))})`)));
  await shot('reference-site-display');
  if(process.argv.includes('--site-clean')) {
    await click('button[title="Subtitles"]');
    for(let i=0;i<6;i++) {
      const rect=await evaluate(`document.querySelector('canvas').getBoundingClientRect().toJSON()`);
      const capture=await call('Page.captureScreenshot',{format:'png',clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:1},captureBeyondViewport:true});
      await writeFile(path.join(output,'reference-site-clean-'+i+'.png'),Buffer.from(capture.data,'base64'));await pause(1800);
    }
    await call('Page.navigate',{url:'about:blank'});
  }
  socket.close();process.exit(0);
}
if(process.argv.includes('--site-cycle')) {
  await click('button[aria-label="Full-screen display"]');await pause(500);
  const captures=[];
  for(let i=0;i<16;i++) {
    const rect=await evaluate(`document.querySelector('canvas').getBoundingClientRect().toJSON()`);
    const capture=await call('Page.captureScreenshot',{format:'png',clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:1},captureBeyondViewport:true});
    const name='reference-site-lcd-'+i+'.png';await writeFile(path.join(output,name),Buffer.from(capture.data,'base64'));
    captures.push({name,body:await evaluate('document.body.innerText.slice(0,300)')});await pause(1800);
  }
  await writeFile(path.join(output,'reference-site-cycle.json'),JSON.stringify(captures,null,2));
  console.log(JSON.stringify(captures));socket.close();process.exit(0);
}
if(process.argv.includes('--inspect')) {
  console.log(JSON.stringify(await evaluate(`({probe:window.__canvasProbe,canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,rect:c.getBoundingClientRect().toJSON(),alpha:c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[3],parent:c.parentElement.outerHTML.slice(0,500),ancestors:[...function*(e){while(e){yield {tag:e.tagName,visible:e.getAttribute('data-visible-page'),hidden:e.getAttribute('aria-hidden'),style:e.getAttribute('style')};e=e.parentElement}}(c)].slice(0,8)}))})`),null,2));
  socket.close();process.exit(0);
}
await call('Page.addScriptToEvaluateOnNewDocument', { source: `
  (()=>{if(window.__canvasProbe)return;
  window.__canvasProbe={resets:0,clears:0,paints:0,blankFrames:0};
  const isScene=c=>c?.matches?.('canvas[data-skin-input="scene"]');
  for(const key of ['width','height']) {
    const d=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key);
    Object.defineProperty(HTMLCanvasElement.prototype,key,{...d,set(v){if(isScene(this))window.__canvasProbe.resets++;d.set.call(this,v);}});
  }
  for(const key of ['clearRect','drawImage']) {
    const original=CanvasRenderingContext2D.prototype[key];
    CanvasRenderingContext2D.prototype[key]=function(...args){if(isScene(this.canvas))window.__canvasProbe[key==='clearRect'?'clears':'paints']++;return original.apply(this,args);};
  }
  function sample(){for(const c of document.querySelectorAll('canvas[data-skin-input="scene"]')) {
    const r=c.getBoundingClientRect(),frame=c.closest('.dashboard-page-frame'); if(r.width && r.height && (!frame || frame.dataset.visiblePage==='true')) {
      const a=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data[3];
      if(!a)window.__canvasProbe.blankFrames++;
    }
  }requestAnimationFrame(sample);}requestAnimationFrame(sample);})();
` });

const results = { lifecycle: [], screenshots: [], errors, browser: 'owned Vite5190/CDP9340; isolated profile; mocked IPC' };
for (const [width,height,dpr] of [[1920,480,1],[780,424,1],[1920,480,2],[780,424,2]]) {
  await viewport(width,height,dpr); await navigate('main');
  await wait('window.__subwayDashboardCheck.runtimeOwner() && window.__subwayDashboardCheck.snapshot().scene');
  await evaluate('window.__subwayDashboardCheck.suspend()'); await pause(300);
  const before = await evaluate(`(async()=>({probe:{...window.__canvasProbe},lifecycle:{...(await import('/src/plugins/subway/scene.ts')).subwaySceneLifecycle},canvas:document.querySelector('canvas[data-skin-input="scene"]')===window.__sceneIdentity}))()`);
  await evaluate('window.__sceneIdentity=document.querySelector(\'canvas[data-skin-input="scene"]\'); undefined');
  for (let i=0;i<8;i++) await click(`[data-visible-page="true"] [data-skin-slot="strip"] button[data-dashboard-tile]`,i);
  await evaluate('window.__subwayDashboardCheck.unrelatedSetting();window.__subwayDashboardCheck.publish();undefined'); await pause(250);
  const after = await evaluate(`(async()=>{const c=document.querySelector('canvas[data-skin-input="scene"]'),r=c.getBoundingClientRect();return{probe:{...window.__canvasProbe},lifecycle:{...(await import('/src/plugins/subway/scene.ts')).subwaySceneLifecycle},same:c===window.__sceneIdentity,backing:[c.width,c.height],css:[r.width,r.height],dpr:devicePixelRatio,calls:window.__subwayDashboardCheck.slotActionCalls()}})()`);
  assert(after.same); assert.equal(after.calls,8);
  assert.equal(after.probe.resets,before.probe.resets); assert.equal(after.probe.clears,before.probe.clears);
  assert.equal(after.probe.paints,before.probe.paints); assert.deepEqual(after.lifecycle,before.lifecycle);
  assert.equal(after.probe.blankFrames,before.probe.blankFrames);
  assert(Math.abs(after.backing[0]-after.css[0]*dpr)<2 && Math.abs(after.backing[1]-after.css[1]*dpr)<2);
  results.lifecycle.push({width,height,dpr,before,after});
  const pageBefore=await evaluate('({...window.__canvasProbe})');
  for(const direction of ['Next','Previous','Next','Previous']) {
    await click(`[data-visible-page="true"] [aria-label="${direction} page"]`);await pause(400);
  }
  const pageAfter=await evaluate(`(async()=>({probe:{...window.__canvasProbe},created:(await import('/src/plugins/subway/scene.ts')).subwaySceneLifecycle.created}))()`);
  assert.equal(pageAfter.probe.blankFrames,pageBefore.blankFrames,'transparent incoming page frame');
  assert.equal(pageAfter.probe.resets,pageBefore.resets,'incoming page backing reset');
  assert.equal(pageAfter.probe.clears,pageBefore.clears);assert.equal(pageAfter.created,after.lifecycle.created);
  results.lifecycle.at(-1).pages={firstAndRepeatedVisits:true,before:pageBefore,after:pageAfter};
  for(const line of ['yamanote','hibiya','sakaisuji']) {
    await evaluate(`window.__subwayDashboardCheck.setLine('${line}')`); await pause(300);
    const name=`${line}-${width}x${height}-dpr${dpr}`;await shot(name);results.screenshots.push(name+'.png');
  }
  if(dpr===1) {
    await evaluate('globalThis.isTauri=true;undefined');
    for(let i=0;i<3;i++) await click('[data-visible-page="true"] canvas[data-skin-input="scene"]');
    await wait(`document.querySelector('[data-visible-page="true"] [role="dialog"]')?.parentElement.getAttribute('aria-hidden')==='false'`);await pause(250);
    const selector='[data-visible-page="true"] [aria-label="Parameters for Change Subway line"]';
    const hit=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,e=document.elementFromPoint(x,y);return{x,y,hit:e===b||b.contains(e),gap:e?.classList.contains('dashboard-drag-gap')}})()`);
    assert(hit.hit&&!hit.gap,'native drag gap covers Params');await click(selector);
    await wait(`document.querySelector('${selector}')?.getAttribute('aria-expanded')==='true'`);
    assert.equal(await evaluate('document.querySelector(\'[data-visible-page="true"] [role="dialog"]\').querySelectorAll(\'[role="combobox"]\').length'),3);
    results.lifecycle.at(-1).quickActionPointerHit=hit;await shot(`quick-actions-${width}x${height}`);
    await click('[data-visible-page="true"] [role="dialog"] [aria-label="Close quick actions"]');
    await evaluate('globalThis.isTauri=false;undefined');
  }
}
await viewport(1360,860);await navigate('panel');
await click('nav[aria-label="Main navigation"] button[aria-label="Layout"]');
await wait('document.querySelector(\'canvas[data-skin-input="scene"]\')');await pause(500);
await evaluate('window.__sceneIdentity=document.querySelector(\'canvas[data-skin-input="scene"]\');undefined');
const editorBefore=await evaluate('({...window.__canvasProbe})');
await click('[data-skin-slot="strip"] [aria-label^="Move or select"]');await pause(2100);
const editorAfter=await evaluate('({...window.__canvasProbe})');
assert.deepEqual(editorAfter,editorBefore);assert(await evaluate('window.__sceneIdentity===document.querySelector(\'canvas[data-skin-input="scene"]\')'));
assert.equal(await evaluate('document.querySelectorAll(\'[data-corner]\').length'),4);
await shot('editor-1360x860');
for(const view of ['map','cab','display']) {await click(`[data-skin-view-tab="${view}"]`);await pause(100);}
results.editor={before:editorBefore,after:editorAfter,handles:4,frozen:true,tabs:true};
await writeFile(path.join(output,'lifecycle.json'),JSON.stringify(results,null,2));

// Private comparison sheets: photos remain outside product assets.
await viewport(2400,1200);
const photoRoot='../reference/plans/subway-refs';
const comparisons = [
  ['yamanote','broad','cruising-broad-ja','yamanote-debut-route.jpg',[0,0,390,260],'Actual 2015 screen; station numbering is a current-era addition.'],
  ['yamanote','nearby','departing-nearby','yamanote-debut-route.jpg',[390,0,390,260],'Actual next-Kanda screen; minute estimates use simulation, not an operator timetable.'],
  ['yamanote','platform','stopped-platform','yamanote-debut-doors.jpg',[0,0,390,260],'Actual platform/doors page; unverified facility positions are omitted.'],
  ['yamanote','facilities-synthetic','synthetic-facilities-fixture','yamanote-hitachi-fig6.png',null,'Explicitly synthetic facility positions; vector icon/hierarchy check only. Production has no verified facility geography.'],
  ['yamanote','closing','doors-closing','yamanote-debut-doors.jpg',[0,0,390,260],'Door layout reference; closing artwork is adapted.'],
  ['yamanote','transfers','cruising-transfers','yamanote-hitachi-fig5.png',null,'Manufacturer nearby/transfer hierarchy; grayscale reference.'],
  ['yamanote','emergency','emergency-four-language','yamanote-hitachi-fig4.png',null,'Manufacturer suspension layout; emergency caption is adapted.'],
  ['yamanote','suspension','suspension-four-language','yamanote-hitachi-fig4.png',null,'Manufacturer multilingual suspension reference.'],
  ['hibiya','broad','reference-hibiya-route','hibiya-three-screens-guideline.jpg',[365,59,630,198],'Actual paired route to Ningyocho; reference predates current station numbering.'],
  ['hibiya','nearby','hibiya-departing','hibiya-response-1090738.jpg',[0,120,990,355],'Actual coordinated route hierarchy; station/state differs.'],
  ['hibiya','platform','hibiya-stopped-platform','hibiya-lcd-photo.jpg',[274,134,386,107],'Actual 13000 platform/door split in Tobu territory; simulated station differs.'],
  ['hibiya','closing','hibiya-doors-closing','hibiya-lcd-photo.jpg',[274,134,386,107],'Door layout reference; closing artwork is adapted.'],
  ['hibiya','transfers','hibiya-cruising-transfers','metro-route-guideline.jpg',null,'Metro family reference; dedicated transfer pane is adapted, no matching 13000 photo.'],
  ['hibiya','emergency','hibiya-emergency','metro-disruption-guideline.jpg',null,'No verified 13000 emergency artwork. Original adapted warning, family reference only.'],
  ['hibiya','suspension','hibiya-suspended','metro-disruption-guideline.jpg',null,'No verified 13000 suspension artwork. Original adapted warning, family reference only.'],
  ['sakaisuji','nearby','reference-hankyu-nearby','hankyu-1300-route-photo.jpg',[48,165,814,240],'Actual brown next-Ogimachi K12 screen.'],
  ['sakaisuji','broad','reference-hankyu-broad','sakaisuji-video-thumb.jpg',[58,85,380,137],'Actual kana route thumbnail; limited source detail.'],
  ['sakaisuji','platform','sakaisuji-stopped-platform','hankyu-official-display.jpg',[87,81,420,127],'Hankyu platform family at Juso/Kobe palette. Brown Sakaisuji and door artwork adapted.'],
  ['sakaisuji','closing','sakaisuji-doors-closing','hankyu-official-display.jpg',[87,81,420,127],'No matched Sakaisuji closing photo; original adapted guidance.'],
  ['sakaisuji','transfers','sakaisuji-cruising-transfers','hankyu-1300-route-photo.jpg',[48,165,814,240],'Route transfer colours referenced; dedicated transfer layout adapted.'],
  ['sakaisuji','emergency','sakaisuji-emergency','hankyu-1300-route-photo.jpg',[48,165,814,240],'No verified emergency page. Original warning in referenced brown palette.'],
  ['sakaisuji','suspension','sakaisuji-suspended','hankyu-1300-route-photo.jpg',[48,165,814,240],'No verified suspension page. Original warning in referenced brown palette.'],
];
for(const [line,page,render,reference,crop,note] of comparisons) {
  const png=await readFile(path.join(output,'lcd',render+'.png'));
  const photo=await readFile(path.join(photoRoot,reference));
  let html=`<!doctype html><meta charset="utf-8"><style>body{margin:24px;background:#e9eae6;color:#18221d;font:20px Arial}h1{font-size:30px;margin:0 0 12px}p{margin:10px 0 24px}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{background:white;padding:16px}h2{font-size:20px;margin:0 0 12px}canvas,img{display:block;width:100%;height:750px;object-fit:contain;background:#15191b}</style><h1>${line} · ${page}</h1><p>${note} Fonts use Yu Gothic UI / Meiryo; timing and individual minute estimates are approximations.</p><main><section><h2>Subway v2 · current render</h2><img src="data:image/png;base64,${png.toString('base64')}"></section><section><h2>Reference · ${reference}</h2><canvas id="reference"></canvas></section></main><script>const image=new Image;image.onload=()=>{const c=document.querySelector('canvas'),r=${JSON.stringify(crop)}??[0,0,image.width,image.height];c.width=r[2];c.height=r[3];c.getContext('2d').drawImage(image,...r,0,0,c.width,c.height);window.ready=true};image.src='data:image/jpeg;base64,${photo.toString('base64')}';</script>`;
  if(line==='yamanote') {
    const file=page==='facilities-synthetic'
      ? '../reference/thr_c2g49dd2qh/v2-reference-lcd-cycle-0.png'
      : path.join(output,'reference-site-clean-0.png');
    const site=await readFile(file);
    html=html.replace('grid-template-columns:1fr 1fr','grid-template-columns:1fr 1fr 1fr')
      .replace('</main>','<section><h2>Reference site · secondary layout hint</h2><p>Different station/state; real photos remain ground truth. '+(page==='facilities-synthetic'?'Independent supervisor capture.':'Owned muted-browser capture.')+'</p><img src="data:image/png;base64,'+site.toString('base64')+'"></section></main>');
  }
  await call('Page.navigate',{url:'about:blank'});await pause(50);
  const tree=await call('Page.getFrameTree');await call('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html});await wait('window.ready');
  await shot('compare-'+line+'-'+page);
}
await writeFile(path.join(output,'comparisons.json'),JSON.stringify(comparisons.map(([line,page,render,reference,crop,note])=>({line,page,render,reference,crop,note,sheet:'compare-'+line+'-'+page+'.png',site:line==='yamanote'?'Secondary layout hint, different station/state; no code or assets copied.':null})),null,2));
const links=comparisons.map(([line,page])=>'<li><a href="compare-'+line+'-'+page+'.png">'+line+' · '+page+'</a></li>').join('');
await writeFile(path.join(output,'review.html'),'<!doctype html><meta charset="utf-8"><title>Subway v2 review</title><style>body{max-width:1100px;margin:40px auto;font:18px system-ui;background:#edf0eb;color:#17251d}a{color:#1d6546}img{max-width:100%;border:1px solid #89968c}ul{columns:3}p{line-height:1.5}</style><h1>Subway v2</h1><p>Real photos are the fidelity reference. The third column on Yamanote sheets uses a secondary website layout hint, with different station/state explicitly labelled. Facility positions are synthetic fixtures; production omits unverified geography. Font resources, exact firmware timing and per-stop minute estimates are approximations.</p><p><a href="lifecycle.json">Canvas lifecycle assertions</a> · <a href="lcd/manifest.json">61 logical state captures</a> · <a href="comparisons.json">Comparison provenance</a></p><img src="yamanote-1920x480-dpr1.png"><img src="yamanote-780x424-dpr1.png"><img src="editor-1360x860.png"><ul>'+links+'</ul><p>Browser checks use isolated Chrome CDP9340, Vite5190 and mocked IPC. Real app focus/tray/audio behavior remains for the parent to verify. No commits, schema edits or migrate changes.</p>');
assert.equal(errors.length,0,errors.join('\n'));
console.log(JSON.stringify({output,lifecycle:results.lifecycle.map(r=>({width:r.width,height:r.height,dpr:r.dpr,delta:{resets:r.after.probe.resets-r.before.probe.resets,clears:r.after.probe.clears-r.before.probe.clears,paints:r.after.probe.paints-r.before.probe.paints,creations:r.after.lifecycle.created-r.before.lifecycle.created}})),editor:results.editor,comparisons:comparisons.length,errors}));
socket.close();
