import { describe, expect, test, mock } from 'claude-code/testing';
import { imageHeader, capabilities, replaceNative, previewNumbers, preferences } from '../hooks/core';

const MSG={plugin:'better-render',surface:'terminal',component:'AssistantMessage',requestId:'reply-1',viewport:{columns:90,rows:40,isFullscreen:true},
  props:{text:'# Heading\n\nHello **world**.\n\n```rust\nlet answer = 42;\n```',isFirstOfReply:true,isSummary:false}} as const;
const PANE={plugin:'better-render',surface:'terminal',component:'Pane',requestId:'better-render-settings',viewport:{columns:70,rows:40,isFullscreen:true},
  props:{title:'Better Render',isFocused:true,bodyColumns:60,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}} as const;
function host(on:any,prefs:any={}, custom:any={}) {
  if(!custom.store)mock.store(on,{preferences:custom.raw?prefs:{textModeVersion:1,mode:'text',...prefs}});mock.env(on,{TERM_PROGRAM:custom.graphical?'ghostty':'Apple_Terminal',HOME:'/fixture'});
  const clock=mock.clock(on),copies:any[]=[],requests:any[]=[];
  if(!custom.session)on('session.id',()=>({value:'fixture-session'}));
  on('session.surfaces',()=>({value:['terminal']}));
  if(!custom.render)on('ui.render',()=>({type:'engine',ref:0}));
  on('ui.open',()=>({value:{isPlaced:true}}));
  on('command.register',()=>({value:undefined}));
  on('ui.copy',(_:any,e:any)=>{copies.push(e.text);return {value:{isCopied:true}};});
  if(!custom.process)on('process.run',(_:any,e:any)=>{requests.push(e);return {value:{exitCode:0,stdout:'{}',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}};});
  return {clock,copies,requests};
}
describe('Better Render',()=>{
  test('text mode styles Markdown and copies the exact original source',async($,on)=>{
    const h=host(on);const ui=await $.ui.mount(MSG);
    expect(await ui.find({type:'Text',text:'Heading'})).toBeDefined();
    await ui.press({key:'copy:reply-1:all'});
    expect(h.copies[0]).toBe(MSG.props.text);
    expect(h.requests.length).toBe(0);
    await ui.unmount();
  });
  test('off restores the native tree and on restores the themed reply',async($,on)=>{
    host(on);await $.ui.render(MSG);
    await $.command.run({command:'render',args:'off'});
    expect(await $.ui.render(MSG)).toEqual({type:'engine',ref:0});
    await $.command.run({command:'render',args:'on'});
    expect((await $.ui.render(MSG)).type).toBe('Box');
  });
  test('settings render native interactive controls',async($,on)=>{
    host(on);const ui=await $.ui.mount(PANE);
    expect(await ui.find({key:'font'})).toBeUndefined();
    expect(await ui.find({key:'mode:typeset'})).toBeUndefined();
    await ui.press({key:'mode:text'});
    expect((await $.command.run({command:'render',args:'doctor'})).text).toContain('text');
    await ui.unmount();
  });
  test('unclosed fences and malformed diagrams stay readable',async($,on)=>{
    host(on);const text='```mermaid\nnot a diagram';
    const ui=await $.ui.mount({...MSG,props:{...MSG.props,text}});
    expect(await ui.find({type:'Text',text:/not a diagram/})).toBeDefined();await ui.unmount();
  });
  test('Desktop and summary messages pass through',async($,on)=>{
    host(on);expect(await $.ui.render({...MSG,surface:'desktop'})).toEqual({type:'engine',ref:0});
    expect(await $.ui.render({...MSG,props:{...MSG.props,isSummary:true}})).toEqual({type:'engine',ref:0});
  });
  test('invalid arguments do not change rendering settings',async($,on)=>{
    host(on);expect((await $.command.run({command:'render',args:'size 0'})).text).toContain('Usage:');
    expect((await $.command.run({command:'render',args:'doctor'})).text).toContain('text');
  });
  test('long replies fall back instead of dropping text or exceeding tree limits',async($,on)=>{
    host(on);expect(await $.ui.render({...MSG,props:{...MSG.props,text:'word '.repeat(20000)}})).toEqual({type:'engine',ref:0});
  });
  test('native replacement preserves an outer live-thinking addition',()=>{
    const tree={type:'Box',children:[{type:'engine',ref:0},{type:'Text',props:{children:'thinking'},children:['thinking']}]};
    const body={type:'Text',children:['answer']};const r=replaceNative(tree,body);
    expect(r.node.children).toEqual([body,tree.children[1]]);
  });
  test('PNG header regression and bounded paste parsing',()=>{
    expect(imageHeader('iVBORw==')).toBeNull();
    expect(previewNumbers('[Image #1] [Image #2] [Image #1]')).toEqual([1,2]);
  });
  test('unverified multiplexer graphics fall back to text',()=>{
    expect(capabilities({TERM_PROGRAM:'ghostty',TMUX:'yes'}).pictures).toBe(false);
    expect(capabilities({TERM_PROGRAM:'ghostty'}).pictures).toBe(true);
  });
  test('graphical jobs settle once and keep live-thinking outside the replacement',async($,on)=>{
    const h=host(on,{}, {graphical:true,process:true,render:true});
    let renders=0;
    on('process.run',(_,e)=>{
      const r=JSON.parse(e.init?.stdin||'{}');
      if(r.kind==='probe')return {value:{exitCode:0,stdout:JSON.stringify({typst:'typst fixture',cell:{family:'Menlo'},colors:{background:'#ffffff',foreground:'#222222'}}),stderr:''}};
      renders++;return {value:{exitCode:0,stdout:JSON.stringify({pages:[{file:'/fixture/render.png',columns:20,rows:4}]}),stderr:''}};
    });
    on('fs.read',()=>({value:{base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII='}}));
    on('ui.render',($,e)=>$.ui.resolve(e).Box({children:[{type:'engine',ref:0},$.ui.resolve(e).Text({children:'THINKING_KEPT'})]}));
    const ui=await $.ui.mount({...MSG,props:{...MSG.props,text:'```mermaid\nflowchart LR\n A --> B\n```'}});
    await h.clock.advance(500);await ui.redraw();
    expect(await ui.find({type:'Image'})).toBeDefined();
    expect(await ui.find({type:'Text',text:'THINKING_KEPT'})).toBeDefined();
    await ui.redraw();await h.clock.advance(500);
    expect(renders).toBe(1);await ui.unmount();
  });
  test('a failed render keeps the source and reports the reason',async($,on)=>{
    const h=host(on,{}, {graphical:true,process:true});
    on('process.run',(_,e)=>({value:{exitCode:0,stdout:JSON.stringify(JSON.parse(e.init?.stdin||'{}').kind==='probe'?{typst:'typst',cell:{},colors:{}}:{error:'fixture render failed'}),stderr:''}}));
    const ui=await $.ui.mount({...MSG,props:{...MSG.props,text:'Source survives.\n\n```mermaid\nflowchart LR\n A --> B\n```'}});
    await h.clock.advance(500);await ui.redraw();
    expect(await ui.find({type:'Text',text:'Source survives.'})).toBeDefined();
    expect((await $.command.run({command:'render',args:'doctor'})).text).toContain('fixture render failed');
    await ui.unmount();
  });
  test('Read media preserves the tool row and is not duplicated on ToolResult',async($,on)=>{
    const h=host(on,{}, {graphical:true,process:true,render:true});
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=';
    on('process.run',(_,e)=>({value:{exitCode:0,stdout:JSON.stringify(JSON.parse(e.init?.stdin||'{}').kind==='probe'?{typst:'typst',cell:{},colors:{}}:{pages:[{file:'/fixture/image.png',columns:20,rows:5}]}),stderr:''}}));
    on('fs.read',()=>({value:{base64:png}}));
    on('ui.render',($,e)=>$.ui.resolve(e).Text({children:'NATIVE_TOOL_ROW'}));
    const output={type:'image',file:{type:'image/png',base64:png}};
    const ui=await $.ui.mount({...MSG,component:'ToolUse',requestId:'read-1',props:{tool:'Read',tool_use_id:'read-1',input:{file_path:'/fixture/image.png'},output,isRunning:false,isErrored:false,isInterrupted:false}});
    await h.clock.advance(500);await ui.redraw();
    expect(await ui.find({type:'Image'})).toBeDefined();
    expect(await ui.find({type:'Text',text:'NATIVE_TOOL_ROW'})).toBeDefined();
    const result=await $.ui.mount({...MSG,component:'ToolResult',requestId:'read-1',props:{tool:'Read',tool_use_id:'read-1',output,isErrored:false}});
    expect(await result.find({type:'Image'})).toBeUndefined();
    await result.unmount();await ui.unmount();
  });
  test('clear invalidates an in-flight graphical job',async($,on)=>{
    const h=host(on,{}, {graphical:true,process:true});
    let finish:any;let calls=0;
    on('process.run',async(_,e)=>{
      if(JSON.parse(e.init?.stdin||'{}').kind==='probe')return {value:{exitCode:0,stdout:JSON.stringify({typst:'typst',cell:{},colors:{}}),stderr:''}};
      calls++;if(calls===1)await new Promise(resolve=>{finish=resolve;});
      return {value:{exitCode:0,stdout:JSON.stringify({error:'old job'}),stderr:''}};
    });
    on('session.end',()=>({sessionId:'fixture-session'}));
    const ui=await $.ui.mount({...MSG,props:{...MSG.props,text:'```mermaid\nflowchart LR\n A --> B\n```'}});
    await h.clock.advance(200);
    expect(calls).toBe(1);
    await $.session.end({reason:'clear'});finish();
    await h.clock.advance(100);await ui.redraw();await h.clock.advance(300);
    expect(calls).toBe(2);
    await ui.unmount();
  });
});


test('draft previews fit the band, hide with plugin-h, and reset across sessions',async($,on)=>{
  const h=host(on,{}, {graphical:true,process:true,session:true});
  let session='session-a',text='[Image #1]',hidden=false;
  const jobs:any[]=[];
  on('session.id',()=>({value:session}));
  on('session.end',()=>({sessionId:session}));
  on('prompt.read',()=>({value:{text,cursor:text.length}}));
  on('state.get',()=>({value:{value:hidden,version:0}}));
  on('fs.list',(_,e)=>({value:[{name:e.path.endsWith('/images')?'1.png':'project',kind:e.path.endsWith('/images')?'file':'dir',size:20,mtimeMs:1,isLink:false}]}));
  on('fs.exists',()=>({value:true}));
  on('fs.stat',()=>({value:{kind:'file',size:20,mtimeMs:1,isLink:false}}));
  on('fs.read',()=>({value:{base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII='}}));
  on('process.run',(_,e)=>{
    if(!e.init?.stdin)return {value:{exitCode:0,stdout:'501',stderr:''}};
    const r=JSON.parse(e.init.stdin);
    if(r.kind==='probe')return {value:{exitCode:0,stdout:JSON.stringify({typst:'typst',cell:{},colors:{}}),stderr:''}};
    jobs.push(r);return {value:{exitCode:0,stdout:JSON.stringify({pages:[{file:'/fixture/preview.png',columns:8,rows:3}]}),stderr:''}};
  });
  const event={...MSG,component:'AbovePrompt',requestId:'draft',props:{hasSurvey:false,isWorking:false,maxRows:5,bodyColumns:60,scroll:{offset:0,bodyRows:5},view:{}}} as any;
  const ui=await $.ui.mount(event);
  await h.clock.advance(700);await ui.redraw();await h.clock.advance(300);await ui.redraw();
  expect(await ui.find({type:'Image'})).toBeDefined();
  expect(jobs[0].path).toContain('/session-a/images/1.png');expect(jobs[0].maxRows).toBe(3);
  hidden=true;await ui.redraw();expect(await ui.find({type:'Image'})).toBeUndefined();
  hidden=false;text='';await h.clock.advance(700);await ui.redraw();expect(await ui.find({type:'Image'})).toBeUndefined();
  await $.session.end({reason:'clear'});session='session-b';text='[Image #1]';
  await ui.redraw();await h.clock.advance(700);await ui.redraw();await h.clock.advance(300);await ui.redraw();
  expect(await ui.find({type:'Image'})).toBeDefined();expect(jobs[jobs.length-1].path).toContain('/session-b/images/1.png');
  await ui.unmount();
});


test('fresh and existing installations default to unmodified native text',async($,on)=>{
  const h=host(on,{mode:'auto',font:'Berkeley Mono',size:120},{raw:true,graphical:true,process:true});
  const jobs:any[]=[];
  on('process.run',(_,e)=>{
    jobs.push(JSON.parse(e.init?.stdin||'{}'));
    return {value:{exitCode:0,stdout:JSON.stringify({typst:'typst',cell:{},colors:{}}),stderr:''}};
  });
  expect(preferences(undefined).mode).toBe('native');
  expect(preferences({mode:'auto'}).mode).toBe('native');
  expect(await $.ui.render(MSG)).toEqual({type:'engine',ref:0});
  await h.clock.advance(500);
  expect(jobs.filter(x=>x.kind!=='probe').length).toBe(0);
  expect((await $.command.run({command:'render',args:'doctor'})).text).toContain('native');
  await $.command.run({command:'render',args:'mode text'});
  expect((await $.ui.render(MSG)).type).toBe('Box');
  await $.command.run({command:'render',args:'mode native'});
  expect(await $.ui.render(MSG)).toEqual({type:'engine',ref:0});
});

test('native mode appends a diagram while retaining the complete original reply',async($,on)=>{
  const h=host(on,{mode:'native'},{graphical:true,process:true,render:true});
  const jobs:any[]=[];
  on('ui.render',($,e)=>$.ui.resolve(e).Text({children:'ORIGINAL_REPLY_UNCHANGED'}));
  on('process.run',(_,e)=>{
    const r=JSON.parse(e.init?.stdin||'{}');jobs.push(r);
    return {value:{exitCode:0,stdout:JSON.stringify(r.kind==='probe'?{typst:'typst',cell:{},colors:{}}:{pages:[{file:'/fixture/diagram.png',columns:20,rows:4}]}),stderr:''}};
  });
  on('fs.read',()=>({value:{base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII='}}));
  const ui=await $.ui.mount({...MSG,props:{...MSG.props,text:'Normal text.\n\n```mermaid\nflowchart LR\n A --> B\n```'}});
  await h.clock.advance(500);await ui.redraw();
  expect(await ui.find({type:'Text',text:'ORIGINAL_REPLY_UNCHANGED'})).toBeDefined();
  expect(await ui.find({type:'Image'})).toBeDefined();
  expect(jobs.filter(x=>x.kind==='document').length).toBe(0);
  expect(jobs.filter(x=>x.kind==='mermaid').length).toBe(1);
  await ui.unmount();
});

test('removed typesetting commands and old preferences cannot restore it',async($,on)=>{
  host(on,{mode:'typeset',textModeVersion:1,font:'Example',size:150},{raw:true});
  const p=preferences({mode:'typeset',textModeVersion:1,font:'Example',size:150});
  expect(p.mode).toBe('native');expect(p.font).toBeUndefined();expect(p.size).toBeUndefined();
  for(const args of ['mode typeset','mode auto','font Example','size 150']) {
    expect((await $.command.run({command:'render',args})).text).toContain('Usage:');
  }
  expect(await $.ui.render(MSG)).toEqual({type:'engine',ref:0});
});


test('sidebar toggle persists enabled state and stays in sync with commands',async($,on)=>{
  host(on,{}, {render:true,store:true});
  let saved:any={enabled:true,textModeVersion:1,mode:'text'};
  on('store.get',()=>({value:saved}));
  on('store.set',(_,e)=>{saved=e.value;return {value:undefined};});
  on('ui.render',($,e)=>e.component==='Pane'?$.ui.resolve(e).Text({children:'EXISTING_CONTROLS'}):{type:'engine',ref:0});
  const event={...PANE,requestId:'sidebar-controls',props:{...PANE.props,title:'Mod controls',bodyColumns:30}};
  const ui=await $.ui.mount(event);
  expect(await ui.find({type:'Text',text:'EXISTING_CONTROLS'})).toBeDefined();
  expect((await ui.find({key:'toggle-better-render'}))?.text).toBe('Better Render: ON');
  await ui.press({key:'toggle-better-render'});
  expect((await ui.find({key:'toggle-better-render'}))?.text).toBe('Better Render: OFF');
  expect(saved.enabled).toBe(false);
  expect(await $.ui.render(MSG)).toEqual({type:'engine',ref:0});
  await $.command.run({command:'render',args:'on'});
  expect((await ui.find({key:'toggle-better-render'}))?.text).toBe('Better Render: ON');
  await $.command.run({command:'render',args:'off'});
  await ui.unmount();
  const restored=await $.ui.mount(event);
  expect((await restored.find({key:'toggle-better-render'}))?.text).toBe('Better Render: OFF');
  await restored.press({key:'toggle-better-render'});
  expect(saved.enabled).toBe(true);
  await restored.unmount();
  const desktop=await $.ui.mount({...event,surface:'desktop'});
  expect(await desktop.find({key:'toggle-better-render'})).toBeUndefined();
  await desktop.unmount();
});
