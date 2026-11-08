const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');
const catalog=require('../fixtures/studio-catalog.json');
const spec=require('../../custom_components/display_studio/media_widget.json');
async function mount(page){
 await page.setViewportSize({width:1024,height:600});
 await page.setContent('<div id="root" style="position:absolute;inset:0"></div>');
 const root=path.resolve('custom_components/display_studio/www/runtime');
 await page.addStyleTag({path:path.join(root,'layout.css')});
 for(const name of ['weather.js','cards.js','camera.js','layout.js'])await page.addScriptTag({path:path.join(root,name)});
 await page.evaluate(({scene,spec})=>{
  window.taps=[];window.values=[];window.scene=scene;
  const base=scene.elements.find(i=>i.kind==='clock');
  window.item=Object.assign({},base,{id:'player',kind:'media',x:5,y:5,width:90,height:85,entity_id:'media_player.test',show_label:false,media_controls:true,media_remote_view:'view_remote',media_style:'compact',show_cover:true,show_progress:true,parts:{},content_padding:0,tap_action:{action:'none'},hold_action:{action:'none'},style_override:true});
  scene.elements=[item];scene.scroll_height=100;scene.background='solid';
  window.data={'media_player.test':{state:'paused',name:'Wohnzimmer',media_title:'Midnight City',media_artist:'M83',media_album_name:'Hurry Up, We’re Dreaming',media_duration:240,media_position:84,volume_level:.4,is_volume_muted:false,player_available_actions:spec.controls.filter(c=>c.key!=='remote').map(c=>'player_'+c.key),av_sources:[{value:'TV',label:'TV'},{value:'Musik',label:'Musik'}],av_selected_source:'TV'}};
  window.renderer=new LGLayoutRenderer(document.getElementById('root'),null,false);
  window.repaint=()=>renderer.render(scene,data,{onTap:item=>taps.push([item.id,item.tap_action]),onValue:(item,value)=>values.push([item.id,value]),now:new Date()});repaint();
 },{scene:catalog.presets[0].layout.scenes.dashboard,spec});
}
const child=key=>`[data-layout-id="player/media/${key}"]`;
test('all controls, optimistic values, source selection and current capabilities',async({page},testInfo)=>{
 await mount(page);
 await expect(page.locator('.lg-control')).toHaveCount(11);
 for(const key of ['previous','seek_back','play_pause','seek_forward','next','mute','volume_down','volume_up','remote']){
  await page.locator(child(key)).click();
  expect((await page.evaluate(()=>taps)).at(-1)[0]).toBe('player/media/'+key);
 }
 const range=page.locator(child('volume_set')+' input');
 await range.fill('73');await range.dispatchEvent('change');
 await expect(range).toHaveValue('73');
 await page.evaluate(()=>repaint());await expect(range).toHaveValue('73');
 expect((await page.evaluate(()=>values)).at(-1)).toEqual(['player/media/volume_set',73]);
 await page.locator(child('select_source')+' select').selectOption('Musik');
 expect((await page.evaluate(()=>values)).at(-1)).toEqual(['player/media/select_source','Musik']);
 await page.screenshot({path:path.resolve('test-results/media-widget-'+testInfo.project.name+'.png')});
 await page.evaluate(()=>{data['media_player.test'].player_available_actions=[];repaint();});
 await expect(range).toHaveCount(0);await expect(page.locator(child('next'))).toHaveCount(0);
 await expect(page.locator(child('remote'))).toBeVisible();
});
test('shared expansion, hidden controls, scaling and no duplicate nodes on update',async({page})=>{
 await mount(page);
 const snapshot=await page.evaluate(()=>LGExpandMedia(scene));
 expect(snapshot.elements.slice(1).map(i=>i.id)).toEqual(spec.controls.map(c=>'player/media/'+c.key));
 for(const c of spec.controls){const item=snapshot.elements.find(i=>i.id.endsWith('/'+c.key));expect(item.x).toBeCloseTo(5+90*c.x/100);expect(item.height).toBeCloseTo(85*c.height/100);}
 for(let i=0;i<6;i++)await page.evaluate(()=>repaint());
 await expect(page.locator('.lg-control')).toHaveCount(11);
 await page.evaluate(()=>{item.media_controls_hidden=['seek_back','remote'];item.width=60;item.height=60;repaint();});
 await expect(page.locator('.lg-control')).toHaveCount(9);
 await expect(page.locator(child('seek_back'))).toHaveCount(0);
 const parent=await page.locator('[data-layout-id="player"]').boundingBox();
 for(const key of ['play_pause','select_source','mute']){
  const box=await page.locator(child(key)).boundingBox();expect(box.x).toBeGreaterThanOrEqual(parent.x);expect(box.x+box.width).toBeLessThanOrEqual(parent.x+parent.width+1);expect(box.y+box.height).toBeLessThanOrEqual(parent.y+parent.height+1);
 }
});

test('custom media control frames match shared coordinates and scale with their card',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{item.content_padding=5;item.parts={control_play_pause:{x:2,y:3,width:14,height:20,opacity:.7},control_volume_set:{x:10,y:40,width:75,height:12},control_mute:{visible:false}};repaint();});
 await expect(page.locator(child('mute'))).toHaveCount(0);
 for(const key of ['play_pause','volume_set']){
  const geometry=await page.evaluate(key=>{const parent=renderer.nodes.player._frame || renderer.nodes.player,p=parent.getBoundingClientRect(),c=renderer.nodes['player/media/'+key].getBoundingClientRect();return {x:(c.x-p.x)/p.width*100,y:(c.y-p.y)/p.height*100,width:c.width/p.width*100,height:c.height/p.height*100,conf:item.parts['control_'+key]};},key);
  for(const axis of ['x','y','width','height'])expect(geometry[axis]).toBeCloseTo(geometry.conf[axis],1);
 }
 await page.evaluate(()=>{item.width=70;item.height=65;item.x=15;repaint();});
 const expanded=await page.evaluate(()=>LGExpandMedia(scene).elements.find(e=>e.id==='player/media/play_pause'));
 expect(expanded).toMatchObject({x:16.4,y:6.95,width:9.8,height:13,text_opacity:.7});
 await page.evaluate(()=>{item.parts.control_play_pause.z_index=7;repaint();});
 expect(await page.evaluate(()=>LGExpandMedia(scene).elements.at(-1).id)).toBe('player/media/play_pause');
});

test('automatic rows reflow on visibility changes and restore exactly',async({page})=>{
 await mount(page);
 const start=await page.evaluate(()=>LGMediaWidgetLayout(item));
 await page.evaluate(()=>{item.media_controls_hidden=['select_source'];repaint();});
 let result=await page.evaluate(()=>LGMediaWidgetLayout(item));
 expect(result.controls.find(c=>c.key==='volume_set').width).toBeGreaterThan(35);
 await page.evaluate(()=>{item.media_controls_hidden=LGMediaWidgetSpec.layout.rows[0];repaint();});
 result=await page.evaluate(()=>LGMediaWidgetLayout(item));expect(result.parts.cover.height).toBeGreaterThan(start.parts.cover.height);
 await page.evaluate(()=>{item.media_controls_hidden=LGMediaWidgetSpec.controls.map(c=>c.key);repaint();});
 result=await page.evaluate(()=>LGMediaWidgetLayout(item));expect(result.controls).toHaveLength(0);expect(result.parts.cover.height).toBe(90);
 await page.evaluate(()=>{item.media_controls_hidden=[];repaint();});
 expect(await page.evaluate(()=>LGMediaWidgetLayout(item))).toEqual(start);
 await page.evaluate(()=>{item.parts={control_play_pause:{x:42,y:59,width:14,height:19}};item.media_controls_hidden=['seek_back','next'];repaint();});
 result=await page.evaluate(()=>LGMediaWidgetLayout(item));expect(result.controls.find(c=>c.key==='play_pause')).toMatchObject({x:42,y:59,width:14,height:19});
});


test('AV source changes restore available controls while preserving manual opt-outs',async({page})=>{
 await mount(page);await page.evaluate(()=>{
  item.media_controls_hidden=['next'];delete item.media_av_auto;
  Object.assign(data['media_player.test'],{av_routed:true,av_source:'media_player.sonos',av_available_actions:['av_play_pause','av_next','av_volume_set','av_mute']});repaint();
 });
 await expect(page.locator('.lg-control')).toHaveCount(4);await expect(page.locator(child('next'))).toHaveCount(0);
 await page.locator(child('play_pause')).click();expect((await page.evaluate(()=>taps)).at(-1)[1].action).toBe('av_play_pause');
 await page.evaluate(()=>{Object.assign(data['media_player.test'],{av_source:'media_player.apple',av_available_actions:['av_play_pause','av_seek_back','av_seek_forward','av_volume_set','av_mute']});repaint();});
 await expect(page.locator(child('seek_back'))).toBeVisible();await expect(page.locator(child('seek_forward'))).toBeVisible();await expect(page.locator(child('volume_set')+' input')).toHaveValue('40');
 // A redraw from the renderer's expanded scene must retain the original preferences.
 await page.evaluate(()=>{data['media_player.test'].av_available_actions=['av_play_pause','av_next','av_volume_set','av_mute'];renderer.render(renderer.scene,data,renderer.options);});
 await expect(page.locator(child('seek_back'))).toHaveCount(0);await expect(page.locator(child('next'))).toHaveCount(0);
 expect(await page.evaluate(()=>item.media_controls_hidden)).toEqual(['next']);
 await expect(page.locator('.lg-control')).toHaveCount(4);
});

test('timeline is readable and overflowing title scrolls without restarting on state updates',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{data['media_player.test'].media_title='Ein sehr langer Titel, dessen letztes Wort sichtbar werden muss — Schlusswort';repaint();});
 const title=page.locator('.lg-media-title-text');
 await expect(title).toHaveCount(1);
 await expect(page.locator('.lg-media-duration')).toHaveText('−2:36 / 4:00');
 expect(await page.locator('.lg-media-progress').evaluate(n=>getComputedStyle(n).fontSize)).toBe(await page.locator('.lg-media-album').evaluate(n=>getComputedStyle(n).fontSize));
 expect(await page.locator('.lg-media-duration').evaluate(n=>getComputedStyle(n).opacity)).toBe(await page.locator('.lg-media-album').evaluate(n=>getComputedStyle(n).opacity));
 const initial=await title.evaluate(n=>({x:n.getBoundingClientRect().x,animation:n.getAnimations()[0]})).catch(()=>null);
 expect(initial).not.toBeNull();
 await page.evaluate(()=>{window.titleNode=document.querySelector('.lg-media-title-text');window.titleAnimation=titleNode.getAnimations()[0]; titleAnimation.currentTime=Number(getComputedStyle(titleNode).animationDuration.slice(0,-1))*1000*.5;});
 expect(await title.evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).m41)).toBeLessThan(-10);
 await page.evaluate(()=>{data['media_player.test'].volume_level=.6;repaint();});
 expect(await title.evaluate(n=>n===window.titleNode&&n.getAnimations()[0]===window.titleAnimation)).toBe(true);
 await page.evaluate(()=>{data['media_player.test'].media_title='Kurz';repaint();});
 await expect(title).toHaveText('Kurz');
 expect(await title.evaluate(n=>getComputedStyle(n).animationName)).toBe('none');
});

test('Apple TV remote follows power state and restores without losing preferences',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{item.media_controls_hidden=['next'];Object.assign(data['media_player.test'],{av_routed:true,av_remote_state:'playing',av_available_actions:['av_play_pause','av_seek_back','av_seek_forward','av_volume_set','av_mute']});repaint();});
 await expect(page.locator(child('remote'))).toBeVisible();
 await expect(page.locator(child('seek_forward'))).toBeVisible();
 for(const state of ['off','unavailable','standby','unknown']){
  await page.evaluate(state=>{data['media_player.test'].av_remote_state=state;data['media_player.test'].av_available_actions=['av_volume_set','av_mute'];repaint();},state);
  await expect(page.locator(child('remote'))).toHaveCount(0);
  await expect(page.locator(child('seek_forward'))).toHaveCount(0);
  await expect(page.locator(child('volume_set'))).toBeVisible();
 }
 await page.evaluate(()=>{data['media_player.test'].av_remote_state='paused';data['media_player.test'].av_available_actions.push('av_seek_forward','av_seek_back');renderer.render(renderer.scene,data,renderer.options);});
 await expect(page.locator(child('remote'))).toBeVisible();
 await expect(page.locator(child('seek_back'))).toBeVisible();
 expect(await page.evaluate(()=>item.media_controls_hidden)).toEqual(['next']);
});

test('Apple TV track capabilities change independently of ten-second skips',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{Object.assign(data['media_player.test'],{av_routed:true,av_remote_state:'playing',av_available_actions:['av_seek_back','av_seek_forward','av_volume_set','av_mute']});repaint();});
 for(const key of ['next','previous'])await expect(page.locator(child(key))).toHaveCount(0);
 for(const key of ['seek_back','seek_forward','volume_set','mute'])await expect(page.locator(child(key))).toBeVisible();
 for(const key of ['next','previous']){
  await page.evaluate(key=>{data['media_player.test'].av_available_actions.push('av_'+key);repaint();},key);
  await expect(page.locator(child(key))).toBeVisible();await page.locator(child(key)).click();
  expect((await page.evaluate(()=>taps)).at(-1)[1].action).toBe('av_'+key);
  await page.evaluate(key=>{data['media_player.test'].av_available_actions=data['media_player.test'].av_available_actions.filter(x=>x!=='av_'+key);repaint();},key);
  await expect(page.locator(child(key))).toHaveCount(0);
  await expect(page.locator(child('seek_forward'))).toBeVisible();
 }
 expect(await page.evaluate(()=>item.media_controls_hidden||[])).toEqual([]);
});
