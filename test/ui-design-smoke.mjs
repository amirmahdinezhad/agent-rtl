// Our own browser fixture; never launches or controls installed Codex.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { buildCodexPayload, resolveCodexApp } from '../bin/lib/codex.js';
if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw new Error('Provide ARTL_PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const output = path.resolve('dist/design-preview'); fs.mkdirSync(output, { recursive: true });
const bundle = process.env.ARTL_USE_CODEX_CSS === '1' ? resolveCodexApp() : null;
const cssFiles = bundle ? asar.listPackage(bundle.archive).filter(name => /^\/webview\/assets\/app-(initial|primary|shared)-[^/]+\.css$/.test(name)) : [];
if (process.env.ARTL_USE_CODEX_CSS === '1') assert.ok(cssFiles.length);
const mock = `window.previewCalls=[];window.previewRunning=false;window.previewRelease={available:false,supported:true,phase:'up-to-date'};
window.rastaNative={
status:async()=>({agentVersion:'2.4.9',installedAgentVersion:'2.4.8',running:window.previewRunning,operation:{phase:window.previewRunning?'quitting':'complete'},update:window.previewRelease}),
check:async()=>{window.previewCalls.push('check');return window.previewCheck ? await window.previewCheck : window.previewRelease},
prepare:async()=>{window.previewCalls.push('prepare');window.previewRunning=true;return{id:'preview'}},
open:async()=>{window.previewCalls.push('open');return{}},
restore:async()=>{window.previewCalls.push('restore');window.previewRunning=true;return{id:'remove'}},cancel:async()=>({})};`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rasta — Interface preview</title><style>
html{color-scheme:light dark;--color-surface-elevated:#ffffff0a}body{margin:0;background:light-dark(#f4f0f9,#211c2b);color:light-dark(#282132,#f3edf8);font:16px/1.8 system-ui}main{max-width:560px;margin:70px 40px;direction:rtl}h1{font-size:28px}p{color:light-dark(#756b81,#b9afc6)}@media(max-width:600px){main{margin:36px 20px}}
</style></head><body><main><h1>Rasta</h1><p>Settings panel preview</p><p>This text sits behind the panel; the panel background must remain opaque.</p><aside id="host-surface" style="background:var(--color-surface-secondary,light-dark(#f5f5f7,#303035));color:var(--color-text,light-dark(#25252a,#f4f4f6))">Host sidebar</aside><button id="host-primary" style="background:var(--color-background-primary-solid,#333);color:var(--color-text-primary-solid,#fff)">Host action</button><div data-theme="light"><button id="host-scoped" style="background:var(--color-background-accent,#333);color:var(--color-text-on-accent,#fff)">Scoped host action</button></div></main><script src="/mock.js"></script><script src="/payload.js"></script></body></html>`;
const payload = buildCodexPayload();
fs.writeFileSync(path.join(output, 'index.html'), html.replace('<script src="/mock.js"></script><script src="/payload.js"></script>', `<script>${mock}</script><script>${payload.replaceAll('</script', '<\\/script')}</script>`));
const server = http.createServer((req,res)=>{
 const asset = '/webview' + new URL(req.url, 'http://localhost').pathname;
 if (bundle && (cssFiles.includes(asset) || /^\/webview\/assets\/[^/]+\.woff2?$/.test(asset))) {
  try {res.setHeader('Content-Type', asset.endsWith('.css')?'text/css':'font/woff2');res.end(asar.extractFile(bundle.archive,asset.slice(1)));return;} catch {res.writeHead(404);res.end();return;}
 }
 res.setHeader('Content-Type', req.url.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');
 res.end(req.url==='/mock.js'?mock:req.url==='/payload.js'?payload:html.replace('</head>',cssFiles.map(file=>`<link rel="stylesheet" href="${file.slice('/webview'.length)}">`).join('')+'</head>'));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.ARTL_CHROMIUM_EXECUTABLE});
try {
 const errors=[];
 const rgb = color => color.match(/[\d.]+/g).slice(0,3).map(Number);
 const lum = color => rgb(color).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 const contrast = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 for(const [scheme,width,height] of [['light',1100,900],['dark',1100,900],['light',360,800],['dark',320,700],['light',900,480]]) {
  const context=await browser.newContext({colorScheme:scheme,viewport:{width,height},deviceScaleFactor:2,reducedMotion:'reduce'});
  await context.addInitScript(()=>localStorage.setItem('rasta-config',JSON.stringify({locale:'fa',layoutDir:true})));
  const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message)); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const trigger=page.locator('.artl-widget-trigger'), panel=page.locator('.artl-widget-panel');
  assert.equal(await panel.locator('.artl-brand-title').textContent(),'Rasta');
  assert.equal(await trigger.getAttribute('aria-label'),'Rasta settings');
  assert.deepEqual(await trigger.locator('svg').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})),{width:28,height:28});
  await trigger.focus(); await page.keyboard.press('Enter');
  const toggle=page.getByRole('switch',{name:'Enable RTL',exact:true});
  assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await panel.locator('.artl-label').allTextContents(),['Enable RTL','Force RTL','Type @ with Shift+2','Text size','Line height','Font','Theme']);
  const toggleRows=await panel.locator('.artl-settings-group:not(.artl-type-group):not(.artl-appearance-group) .artl-row').evaluateAll(rows=>rows.map(row=>{
   const label=getComputedStyle(row.querySelector('.artl-label')), style=getComputedStyle(row);
   return {size:label.fontSize,weight:label.fontWeight,border:style.borderBottomWidth,height:row.getBoundingClientRect().height};
  }));
  assert.deepEqual(toggleRows,[{size:'13px',weight:'500',border:'0px',height:48},{size:'13px',weight:'500',border:'0px',height:48},{size:'13px',weight:'500',border:'0px',height:48}],'three toggles have equal typography and no internal divider');
  assert.equal(await trigger.innerText(),'');
  assert.equal(await trigger.locator('svg').count(),1);
  assert.equal((await trigger.boundingBox()).width,44,'the floating trigger is icon-only');
  for(const value of await panel.locator('.artl-select-trigger').evaluateAll(elements=>elements.map(el=>({size:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight})))) assert.deepEqual(value,{size:'14px',weight:'400'});
  const refresh=panel.locator('#artl-update-check svg');
  assert.deepEqual(await refresh.evaluate(el=>({width:getComputedStyle(el).width,height:getComputedStyle(el).height,stroke:getComputedStyle(el).strokeWidth})),{width:'18px',height:'18px',stroke:'2px'});
  const typography = await panel.locator('#artl-size, #artl-spacing').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top}}));
  assert.ok(Math.abs(typography[0].top-typography[1].top)<1 && typography[0].right<typography[1].left,'paired typography controls align without overlapping');
  const fontControls = await panel.locator('#artl-app-font, #artl-font-add').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,height:r.height}}));
  assert.ok(Math.abs(fontControls[0].top-fontControls[1].top)<1 && fontControls[1].left-fontControls[0].right>=7,'Add font sits next to the font picker with a usable gap');
  assert.equal(fontControls[0].height,fontControls[1].height,'font controls share one baseline and height');
  const addFont=panel.getByRole('button',{name:'Add font',exact:true});
  assert.equal(await addFont.innerText(),'');
  assert.equal(await addFont.locator('svg').count(),1);
  assert.equal(await addFont.getAttribute('title'),'Add font (TTF or OTF, up to 2 MB)');
  const addBounds=await addFont.boundingBox(), plusBounds=await addFont.locator('svg').boundingBox();
  assert.equal(addBounds.width,44);
  assert.ok(Math.abs(addBounds.x+addBounds.width/2-plusBounds.x-plusBounds.width/2)<0.6 && Math.abs(addBounds.y+addBounds.height/2-plusBounds.y-plusBounds.height/2)<0.6,'add-font icon is centered in its 44px target');
  assert.equal(await page.locator('.artl-widget-container').getAttribute('lang'),'en');
  assert.equal(await page.locator('.artl-widget-container').getAttribute('dir'),'ltr');
  const enabled=await trigger.evaluate(el=>getComputedStyle(el).backgroundColor);
  await trigger.screenshot({path:path.join(output,`${scheme}-${width}-enabled.png`)});
  await page.keyboard.press('Space'); assert.equal(await trigger.getAttribute('data-rtl-enabled'),'false');
  assert.notEqual(await trigger.evaluate(el=>getComputedStyle(el).backgroundColor),enabled);
  await trigger.screenshot({path:path.join(output,`${scheme}-${width}-disabled.png`)});
  await page.keyboard.press('Space'); assert.equal(await toggle.getAttribute('aria-checked'),'true');
  assert.equal(await panel.locator('select,details,kbd,[role=tab],.artl-status-badge,#artl-enabled-state,#artl-update-repair,.artl-hint,.artl-panel-footer,.artl-specimen,#artl-layout-btn').count(),0);
  for(const control of await panel.locator('button:not([hidden])').all()) {
   if(!await control.isVisible()) continue;
   const box=await control.boundingBox();
   assert.ok(box.width>=44&&box.height>=44,`usable control target: ${await control.getAttribute('aria-label')}`);
  }
  const headerParts=await panel.locator('.artl-panel-header > *').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right}}));
  for(let i=1;i<headerParts.length;i++) assert.ok(headerParts[i].left>=headerParts[i-1].right-1,'header items do not overlap');
  assert.equal(await page.locator('#artl-layout-style').count(),0);
  assert.equal(await panel.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  const base=await panel.evaluate(el=>getComputedStyle(el).backgroundColor), text=await panel.locator('.artl-label').first().evaluate(el=>getComputedStyle(el).color);
  assert.ok(!base.includes('rgba'),'opaque base under translucent host token');
  assert.ok(contrast(text,base)>=4.5,`readable panel text: ${text} on ${base}`);
  const track=await toggle.evaluate(el=>getComputedStyle(el,'::before').backgroundColor);
  assert.ok(!track.includes('rgba') && track!==base,'visible active switch');
  const close=page.locator('.artl-panel-close'), closeBox=await close.boundingBox(), svgBox=await close.locator('svg').boundingBox();
  assert.ok(Math.abs(closeBox.y+closeBox.height/2-svgBox.y-svgBox.height/2)<0.6,'close icon vertically centered');
  const size=page.getByRole('combobox',{name:'Text size',exact:true});
  await size.focus(); await page.keyboard.press('ArrowDown'); assert.equal(await size.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await size.getAttribute('aria-expanded'),'false'); assert.equal(await size.textContent(),'18');
  await size.click(); await page.keyboard.press('Escape'); assert.equal(await trigger.getAttribute('aria-expanded'),'true','Escape dismisses menu before panel');
  assert.equal(await size.evaluate(el=>el===document.activeElement),true);
  await size.click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await page.evaluate(async()=>document.fonts.ready);
  const file=`${scheme}-${width}`;
  await size.evaluate(el=>el.blur());
  await page.mouse.move(0,0);
  await panel.screenshot({path:path.join(output,`${file}.png`)});
  await size.click();
  const menu=page.getByRole('listbox',{name:'Text size',exact:true}), menuBounds=await menu.boundingBox(), panelBounds=await panel.boundingBox();
  assert.ok(menuBounds.y>=panelBounds.y&&menuBounds.y+menuBounds.height<=panelBounds.y+panelBounds.height,'expanded picker fits inside the panel');
  const options=await menu.getByRole('option').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}));
  for(let i=1;i<options.length;i++) assert.ok(options[i].top-options[i-1].bottom>=4,'dropdown options have a visible gap');
  await panel.screenshot({path:path.join(output,`${file}-menu.png`)}); await page.keyboard.press('Escape');
  const bounds=await panel.boundingBox(); assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=height);
  for(const name of ['Check for updates','Remove Rasta']) {
   const button=page.getByRole('button',{name,exact:true}); assert.equal(await button.locator('svg').count(),1); assert.equal(await button.getAttribute('title'),name);
   assert.ok((await button.boundingBox()).y < (await toggle.boundingBox()).y,'maintenance above controls');
  }
  const check=page.getByRole('button',{name:'Check for updates',exact:true});
  await check.scrollIntoViewIfNeeded();
  const beforeToast=await panel.boundingBox(), beforeControls=await size.boundingBox();
  await page.evaluate(()=>{window.previewCheck=new Promise(resolve=>window.resolvePreviewCheck=resolve)});
  await check.click();
  assert.equal(await check.getAttribute('aria-busy'),'true');
  assert.equal(await check.getAttribute('title'),'Checking for updates…');
  assert.ok((await check.getAttribute('class')).includes('is-loading'));
  assert.equal(await check.evaluate(el=>getComputedStyle(el).opacity),'1','loading remains visible instead of dimming');
  assert.equal(await check.locator('svg').evaluate(el=>getComputedStyle(el).animationName),'none','reduced motion uses a static loading glyph');
  assert.deepEqual(await panel.boundingBox(),beforeToast,'loading does not move the panel');
  await page.evaluate(()=>{window.resolvePreviewCheck({supported:true,available:false});window.previewCheck=null});
  await page.waitForFunction(()=>!document.querySelector('.artl-toast').hidden);
  assert.equal(await check.getAttribute('aria-busy'),'false');
  assert.ok(!(await check.getAttribute('class')).includes('is-loading'));
  assert.equal(await page.getByRole('status').textContent(),'No updates available.');
  await page.screenshot({path:path.join(output,`${file}-toast.png`)});
  const toastBox=await page.getByRole('status').boundingBox(), panelBox=await panel.boundingBox();
  assert.deepEqual(panelBox,beforeToast,'toast visibility does not change the panel layout');
  assert.deepEqual(await size.boundingBox(),beforeControls,'toast visibility does not shift controls');
  const shape=await toggle.evaluate(el=>{const s=getComputedStyle(el),rail=getComputedStyle(el,'::before');return {clip:s.backgroundClip,railWidth:parseFloat(rail.width),railHeight:parseFloat(rail.height),radius:parseFloat(rail.borderTopLeftRadius)}});
  const regressions=[];
  if(shape.clip==='content-box'||shape.railWidth!==44||shape.railHeight!==24||shape.radius<12) regressions.push('switch rail must be a true 44×24 capsule, independent of the 44px hit target');
  if(!(toastBox.x>=0&&toastBox.x+toastBox.width<=width&&toastBox.y>=0&&toastBox.y+toastBox.height<=height)) regressions.push('floating toast must stay within the viewport');
  assert.deepEqual(regressions,[]);
  const toastStyle=await page.getByRole('status').evaluate(el=>{const s=getComputedStyle(el);return {text:s.color,base:s.backgroundColor,duration:s.transitionDuration,position:s.position}});
  assert.equal(toastStyle.position,'absolute');
  assert.ok(contrast(toastStyle.text,toastStyle.base)>=4.5,'toast text matches the theme with readable contrast');
  assert.notEqual(toastStyle.base,text,'toast uses a themed surface instead of inverted panel text');
  assert.equal(toastStyle.duration,'0s','reduced motion disables toast movement');
  assert.equal(await panel.locator(':scope > .artl-toast').count(),1,'feedback belongs to the panel overlay');
  assert.ok(toastBox.x>=panelBox.x+12 && toastBox.x+toastBox.width<=panelBox.x+panelBox.width-12 && toastBox.y>=panelBox.y && toastBox.y+toastBox.height<=panelBox.y+panelBox.height-12,'feedback stays inset inside the panel');
  const scroll=panel.locator('.artl-panel-content');
  await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight});
  assert.deepEqual(await page.getByRole('status').boundingBox(),toastBox,'scrolling settings does not move the toast outside the panel');
  await scroll.evaluate(el=>{el.scrollTop=0});
  assert.equal(await panel.locator('.artl-update-notice').isHidden(),true);
  await page.waitForFunction(()=>document.querySelector('.artl-toast').hidden);
  const remove=page.locator('#artl-update-restore'); await remove.click();
  const confirm=page.getByRole('alertdialog'); assert.equal(await confirm.isVisible(),true);
  assert.match(await confirm.innerText(),/Codex will close and reopen automatically after removal/);
  assert.equal(await confirm.getByRole('button',{name:'Keep Rasta'}).evaluate(el=>el===document.activeElement),true);
  await panel.screenshot({path:path.join(output,`${file}-confirm.png`)});
  await page.keyboard.press('Escape'); assert.equal(await confirm.count(),0); assert.equal(await remove.evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.evaluate(()=>window.previewCalls.includes('restore')),false);
  await remove.click(); await confirm.getByRole('button',{name:'Keep Rasta'}).click(); assert.equal(await confirm.count(),0);
  await page.evaluate(()=>{localStorage.setItem('unrelated-host-setting','keep');localStorage.setItem('rasta:message-direction:v1:fixture','rtl');});
  await remove.click(); await confirm.getByRole('button',{name:'Remove Rasta',exact:true}).click();
  await page.waitForFunction(()=>window.previewCalls.includes('restore'));
  await page.waitForFunction(()=>localStorage.getItem('rasta-config')===null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('rasta:message-direction:v1:fixture')),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-host-setting')),'keep');
  assert.equal(await panel.locator('#artl-update-cancel').count(),0);
  assert.equal(await confirm.count(),0); assert.equal(await panel.locator('.artl-update-notice').isHidden(),true);
  await page.evaluate(()=>{window.previewRunning=false}); await check.waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#artl-update-check').disabled);
  await page.evaluate(()=>{window.previewRelease={available:true,supported:true,release:{agentVersion:'2.5.0',releaseNotes:['A shorter update summary.','<b>Plain text only</b>']}}});
  await check.click();
  await page.locator('.artl-update-notice').waitFor({state:'visible'});
  assert.equal(await page.locator('.artl-version').textContent(),'v2.4.8');
  assert.match(await page.locator('#artl-update-status').textContent(),/2\.5\.0/);
  assert.deepEqual(await page.locator('.artl-release-notes li').allTextContents(),['A shorter update summary.','<b>Plain text only</b>']);
  assert.equal(await page.locator('.artl-release-notes b').count(),0);
  assert.equal(await page.evaluate(()=>window.previewCalls.includes('prepare')),false);
  await page.locator('#artl-update-install').click(); await page.waitForFunction(()=>window.previewCalls.includes('prepare'));
  assert.equal(await page.locator('#artl-update-cancel').count(),0);
  if(scheme==='dark') {
   await page.evaluate(()=>{window.previewRunning=false;window.previewRelease={available:true,supported:false,release:{agentVersion:'2.3.0'}}});
   await page.waitForFunction(()=>!document.querySelector('#artl-update-check').disabled);
   assert.equal(await page.locator('.artl-update-badge').isVisible(),true);
   await check.click(); await page.locator('#artl-update-install').click(); await page.waitForFunction(()=>window.previewCalls.includes('open'));
  }
  await page.evaluate(()=>document.documentElement.style.setProperty('--app-color-accent-purple','#9d52e8'));
  assert.equal(await page.locator('#artl-toggle-btn').evaluate(el=>getComputedStyle(el,'::before').backgroundColor),'rgb(173, 140, 243)');
  await page.evaluate(()=>document.documentElement.style.setProperty('--app-color-accent-purple',' '));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#artl-toggle-btn'),'::before').backgroundColor!=='rgb(157, 82, 232)');
  await page.keyboard.press('Escape'); assert.equal(await trigger.getAttribute('aria-expanded'),'false'); assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  await context.close();
 }
 // Appearance applies to host surfaces and restores the host's latest settings.
 const appearance=await browser.newContext({colorScheme:'dark',viewport:{width:920,height:900},reducedMotion:'reduce'});
 const appearancePage=await appearance.newPage(); appearancePage.on('pageerror',error=>errors.push(error.message));
 await appearancePage.goto(`http://127.0.0.1:${server.address().port}`);
 const appearancePanel=appearancePage.locator('.artl-widget-panel'), widget=appearancePage.locator('.artl-widget-container');
 await appearancePage.locator('.artl-widget-trigger').click();
 const chooseTheme=async value=>{
  await appearancePage.getByRole('combobox',{name:'Theme',exact:true}).click();
  await appearancePage.getByRole('option',{name:value,exact:true}).click();
 };
 const panelBase=()=>appearancePanel.evaluate(el=>getComputedStyle(el).backgroundColor);
 const hostBase=()=>appearancePage.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);
 const accentFill=()=>appearancePage.locator('.artl-widget-trigger').evaluate(el=>getComputedStyle(el).backgroundColor);
 assert.equal(await appearancePage.getByRole('combobox',{name:'Theme',exact:true}).innerText(),'Auto');
 assert.equal(await panelBase(),'rgb(37, 37, 41)');
 await appearancePage.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.classList.add('host-owned')});
 await appearancePage.waitForFunction(()=>getComputedStyle(document.querySelector('.artl-widget-panel')).backgroundColor==='rgb(255, 255, 255)');
 const originalHost=await hostBase();
 const originalSidebar=await appearancePage.locator('#host-surface').evaluate(el=>getComputedStyle(el).backgroundColor);
 await chooseTheme('Dark');
 assert.equal(await panelBase(),'rgb(37, 37, 41)');
 assert.equal(await appearancePage.locator('html').getAttribute('data-theme'),'light','panel theme must preserve host marker');
 assert.equal(await hostBase(),originalHost);
 assert.equal(await appearancePage.locator('#host-surface').evaluate(el=>getComputedStyle(el).backgroundColor),originalSidebar);
 assert.equal(await appearancePage.locator('html').evaluate(el=>el.classList.contains('dark')),false);
 await chooseTheme('Light'); assert.equal(await panelBase(),'rgb(255, 255, 255)');
 await appearancePage.evaluate(()=>document.documentElement.dataset.theme='dark');
 await appearancePage.waitForTimeout(30);
 assert.equal(await appearancePage.locator('html').getAttribute('data-theme'),'dark');
 assert.equal(await panelBase(),'rgb(255, 255, 255)','explicit panel appearance ignores host changes');
 const theme=appearancePage.getByRole('combobox',{name:'Theme',exact:true});
 await theme.focus(); await appearancePage.keyboard.press('Home'); await appearancePage.keyboard.press('Enter');
 assert.equal(await theme.innerText(),'Auto'); assert.equal(await panelBase(),'rgb(37, 37, 41)');
 assert.equal(await appearancePage.locator('html').getAttribute('data-artl-app-theme'),null);
 assert.equal(await appearancePage.locator('html').getAttribute('data-theme'),'dark','Auto restores the latest host preference');
 assert.equal(await appearancePage.locator('html').evaluate(el=>el.classList.contains('host-owned')&&!el.classList.contains('light')&&!el.classList.contains('dark')),true,'unrelated root classes survive');
 await appearancePage.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
 await appearancePage.emulateMedia({colorScheme:'light'});
 await appearancePage.waitForFunction(()=>getComputedStyle(document.querySelector('.artl-widget-panel')).backgroundColor==='rgb(255, 255, 255)');
 await appearancePage.emulateMedia({colorScheme:'dark'});
 await appearancePage.waitForFunction(()=>getComputedStyle(document.querySelector('.artl-widget-panel')).backgroundColor==='rgb(37, 37, 41)');
 assert.equal(await appearancePanel.locator('input[type=color],.artl-color-picker').count(),0,'custom picker is removed');
 assert.deepEqual(await appearancePanel.locator('.artl-accent-swatch').evaluateAll(elements=>elements.map(el=>el.getAttribute('aria-label'))),['Lavender accent','Blue accent','Mint accent','Yellow accent']);
 const presets=[['Lavender','rgb(173, 140, 243)'],['Blue','rgb(121, 173, 235)'],['Mint','rgb(104, 199, 164)'],['Yellow','rgb(233, 191, 89)']];
 const originalFill=await appearancePage.locator('#host-primary').evaluate(el=>getComputedStyle(el).backgroundColor);
 const originalScopedFill=await appearancePage.locator('#host-scoped').evaluate(el=>getComputedStyle(el).backgroundColor);
 for(const themeName of ['Light','Dark']) {
  await chooseTheme(themeName);
  for(const [name,fill] of presets) {
   await appearancePage.getByRole('button',{name:name+' accent',exact:true}).click();
   assert.equal(await accentFill(),fill);
   for (const active of [false,true]) {
    await appearancePanel.getByRole('switch').evaluateAll((elements,active)=>elements.forEach(el=>el.classList.toggle('active',active)),active);
    assert.ok((await appearancePanel.locator('.artl-toggle-knob').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundColor))).every(color=>color==='rgb(255, 255, 255)'),'every toggle knob stays white');
   }
   assert.equal(await appearancePage.locator('.artl-accent-swatch[aria-pressed=true]').count(),1);
   for(const selector of ['#host-primary','#host-scoped']) {
    const tone=await appearancePage.locator(selector).evaluate(el=>{const style=getComputedStyle(el);return {fill:style.backgroundColor,text:style.color}});
    assert.equal(tone.fill,selector === '#host-primary' ? originalFill : originalScopedFill,'panel preset must preserve host actions and scoped surfaces');
    assert.equal(await appearancePage.locator('#artl-app-appearance-style').count(),0,'no host appearance stylesheet');
   }
   const ink=await appearancePanel.locator('.artl-brand-mark').evaluate(el=>getComputedStyle(el).color);
   assert.ok(contrast(ink,await panelBase())>=4.5,'accent ink stays legible in both themes');
  }
 }
 await appearancePage.evaluate(()=>document.documentElement.style.setProperty('--app-color-accent-purple','#9d52e8'));
 await appearancePage.waitForTimeout(30); assert.equal(await accentFill(),'rgb(233, 191, 89)','host palette cannot replace the chosen accent');
 await appearancePage.getByRole('switch',{name:'Enable RTL',exact:true}).click();
 await appearancePage.getByRole('combobox',{name:'Text size',exact:true}).click();
 await appearancePage.keyboard.press('End'); await appearancePage.keyboard.press('Enter');
 await appearancePage.reload(); await appearancePage.locator('.artl-widget-trigger').click();
 assert.equal(await theme.innerText(),'Dark'); assert.equal(await appearancePage.locator('.artl-accent-value').innerText(),'Yellow');
 assert.equal(await appearancePage.locator('html').getAttribute('data-theme'),null);
 assert.equal(await appearancePage.locator('#host-primary').evaluate(el=>getComputedStyle(el).backgroundColor),originalFill);
 assert.equal(await appearancePage.getByRole('switch',{name:'Enable RTL',exact:true}).getAttribute('aria-checked'),'false');
 assert.equal(await appearancePage.getByRole('combobox',{name:'Text size',exact:true}).innerText(),'18');
 await appearancePage.getByRole('switch',{name:'Enable RTL',exact:true}).click();
 await appearancePage.getByRole('button',{name:'Lavender accent',exact:true}).click();
 assert.equal(await appearancePage.locator('html').getAttribute('data-artl-app-accent'),null);
 assert.notEqual(await appearancePage.locator('#host-primary').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(233, 191, 89)','accent selection preserves host actions');
 await appearancePage.getByRole('button',{name:'Blue accent',exact:true}).click();
 await appearancePage.screenshot({path:path.join(output,'appearance-panel-dark.png')});
 await chooseTheme('Light'); await appearancePage.screenshot({path:path.join(output,'appearance-panel-light.png')});
 await appearancePage.setViewportSize({width:320,height:480});
 const mint=appearancePage.getByRole('button',{name:'Mint accent',exact:true}); await mint.scrollIntoViewIfNeeded(); await mint.focus();
 assert.equal(await mint.evaluate(el=>el===document.activeElement),true);
 const swatchBounds=await appearancePage.locator('.artl-accent-swatch').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}}));
 assert.ok(swatchBounds.every(bounds=>bounds.left>=0&&bounds.right<=320&&bounds.width>=44&&bounds.height>=44),'all swatches fit a narrow window');
 await appearancePanel.screenshot({path:path.join(output,'appearance-narrow.png')});
 await appearancePage.keyboard.press('Escape');
 assert.equal(await appearancePage.locator('.artl-widget-trigger').getAttribute('aria-expanded'),'false');
 // Invalid or removed accents fall back before paint; failed storage permits live controls.
 await appearancePage.evaluate(()=>localStorage.setItem('rasta-config',JSON.stringify({theme:'invalid',accent:'#ff0000',customAccent:'#ff0000'})));
 await appearancePage.reload(); await appearancePage.locator('.artl-widget-trigger').click();
 assert.equal(await theme.innerText(),'Auto'); assert.equal(await appearancePage.locator('.artl-accent-value').innerText(),'Lavender');
 await appearancePage.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Blocked','SecurityError')}});
 await chooseTheme('Light'); await mint.click();
 assert.equal(await panelBase(),'rgb(255, 255, 255)'); assert.equal(await accentFill(),'rgb(104, 199, 164)');
 // Disposal removes owned CSS and restores theme markers, preserving host styles.
 await appearancePage.evaluate(()=>{document.documentElement.style.setProperty('--host-owned-test','kept');window.__rastaPro.dispose()});
 assert.equal(await appearancePage.locator('#artl-app-appearance-style').count(),0);
 assert.equal(await appearancePage.locator('html').getAttribute('data-artl-app-theme'),null);
 assert.equal(await appearancePage.locator('html').getAttribute('data-artl-app-accent'),null);
 assert.equal(await appearancePage.locator('html').getAttribute('data-theme'),null);
 assert.equal(await appearancePage.locator('html').evaluate(el=>el.style.getPropertyValue('--host-owned-test')),'kept');
 assert.equal(await appearancePage.locator('#host-primary').evaluate(el=>getComputedStyle(el).backgroundColor),originalFill);
 await appearance.close();
 const motion=await browser.newContext({colorScheme:'dark',viewport:{width:720,height:720},reducedMotion:'no-preference',recordVideo:{dir:path.join(output,'motion'),size:{width:720,height:720}}});
 const page=await motion.newPage(); page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const trigger=page.locator('.artl-widget-trigger');
 await trigger.click(); await page.waitForTimeout(250);
 const check=page.getByRole('button',{name:'Check for updates',exact:true}), toast=page.locator('.artl-toast');
 await page.evaluate(()=>{window.previewCheck=new Promise(resolve=>window.resolvePreviewCheck=resolve)});
 await check.click();
 const spinner=check.locator('svg');
 await page.waitForFunction(()=>document.querySelector('#artl-update-check svg').getAnimations().some(animation=>animation.playState==='running'));
 assert.ok(await spinner.evaluate(el=>el.getAnimations().some(animation=>animation.effect.getTiming().duration===800&&animation.effect.getTiming().iterations===Infinity)),'refresh spins while the request is pending');
 const motionBounds=await page.locator('.artl-widget-panel').boundingBox();
 await page.waitForTimeout(200);
 await page.locator('.artl-widget-panel').screenshot({path:path.join(output,'dark-check-loading.png')});
 await page.evaluate(()=>{window.resolvePreviewCheck({supported:true,available:false});window.previewCheck=null});
 await page.waitForFunction(()=>document.querySelector('.artl-toast').getAnimations().some(a=>a.playState==='running'));
 assert.equal(await spinner.evaluate(el=>el.getAnimations().length),0,'loading stops after the request settles');
 const enter=await toast.evaluate(el=>el.getAnimations().map(a=>({property:a.transitionProperty,duration:a.effect.getTiming().duration})));
 assert.ok(enter.some(a=>a.property==='opacity'&&a.duration===200),'toast fades in');
 assert.ok(enter.some(a=>a.property==='transform'),'toast moves gently on entry');
 await page.waitForTimeout(250);
 assert.deepEqual(await page.locator('.artl-widget-panel').boundingBox(),motionBounds,'animated toast has no layout effect');
 await page.screenshot({path:path.join(output,'dark-toast-motion.png')});
 await check.click(); // Repeated feedback resets its lifetime without duplicate nodes.
 assert.equal(await page.locator('.artl-toast').count(),1);
 await page.waitForFunction(()=>!document.querySelector('.artl-toast').classList.contains('visible'));
 assert.equal(await toast.evaluate(el=>el.hidden),false,'exit animates before removing the toast');
 const exit=await toast.evaluate(el=>el.getAnimations().map(a=>a.transitionProperty));
 assert.ok(exit.includes('opacity')&&exit.includes('transform'),'toast fades and moves on exit');
 await page.waitForFunction(()=>document.querySelector('.artl-toast').hidden);
 await page.evaluate(()=>{window.previewRelease={releaseError:'offline'}});
 await check.click(); await page.waitForFunction(()=>document.querySelector('.artl-toast').dataset.kind==='error');
 await page.waitForTimeout(250);
 await page.screenshot({path:path.join(output,'dark-toast-error.png')});
 await page.getByRole('button',{name:'Close settings',exact:true}).click();
 assert.equal(await toast.evaluate(el=>el.classList.contains('visible')),false,'closing the panel starts the toast exit');
 await page.waitForFunction(()=>document.querySelector('.artl-toast').hidden);
 await trigger.click(); await page.waitForTimeout(250);
 assert.equal(await toast.evaluate(el=>el.hidden),true,'reopening does not show stale feedback');
 await page.evaluate(()=>{window.previewCheck=new Promise(resolve=>window.resolvePreviewCheck=resolve)});
 await check.click();
 await page.getByRole('button',{name:'Close settings',exact:true}).click();
 await page.evaluate(()=>window.resolvePreviewCheck({supported:true,available:false}));
 await page.waitForFunction(()=>!document.querySelector('#artl-update-check').disabled);
 assert.equal(await toast.evaluate(el=>el.hidden),true,'late results stay hidden after dismissal');
 await page.evaluate(()=>{window.previewCheck=null;window.previewRelease={supported:true,available:false}});
 await trigger.click(); await page.waitForTimeout(250);
 await page.getByRole('switch',{name:'Force RTL',exact:true}).click(); await page.waitForTimeout(200);
 await page.getByRole('switch',{name:'Force RTL',exact:true}).click(); await page.waitForTimeout(200);
 await page.getByRole('combobox',{name:'Text size',exact:true}).click();
 await page.keyboard.press('End'); await page.waitForTimeout(250); await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Remove Rasta',exact:true}).click(); await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Keep Rasta',exact:true}).click(); await page.waitForTimeout(250);
 await page.getByRole('button',{name:'Close settings',exact:true}).click(); await page.waitForTimeout(250);
 await trigger.click(); await page.waitForTimeout(250);
 await page.mouse.click(40,40); await page.waitForTimeout(250);
 assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 await trigger.click(); await page.waitForTimeout(250);
 assert.equal(await page.locator('.artl-widget-container').count(),1);
 const video=page.video(); await motion.close(); await video.saveAs(path.join(output,'panel-flow.webm'));
 assert.deepEqual(errors,[]);
 console.log('PASS: compact controls, icon targets, spaced keyboard listboxes, visible loading with reduced-motion fallback, absolute toast with translate entry/exit and zero layout shift, dismissal cleanup, update/removal flows, narrow layout, explicit/automatic themes, balanced accents without a picker, isolated panel theme/accent, contrast, persistence and restoration.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
