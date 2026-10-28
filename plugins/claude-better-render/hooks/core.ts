import { parse } from './vendor/prismantis/markdown';

export const DEFAULTS = { enabled: true, mode: 'native', textModeVersion: 1, theme: 'terminal', font: 'terminal', size: 100,
  images: true, mermaid: true, preview: true, tools: 'inherit' };
export function preferences(value: any) {
  const v=value && typeof value==='object'?value:{};
  return {...DEFAULTS,...v,enabled:v.enabled!==false,images:v.images!==false,mermaid:v.mermaid!==false,preview:v.preview!==false,
    textModeVersion:1,mode:v.textModeVersion===1&&['native','auto','text','typeset'].includes(v.mode)?v.mode:'native',tools:v.tools==='cards'?'cards':'inherit',
    size:Number.isFinite(v.size)?Math.max(75,Math.min(160,v.size)):100,
    font:typeof v.font==='string'&&v.font.length<=120?v.font:'terminal',theme:typeof v.theme==='string'?v.theme:'terminal'};
}
export const fingerprint = (text: string) => {
  let h=2166136261;for(let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619);
  return `${(h>>>0).toString(16)}-${text.length}`;
};
export function blocksOf(source: string) {
  // Keep the exact original separately for Copy; raw blocks drive rendering only.
  return parse(source,{numbers:true,paths:true});
}
export function imageHeader(base64: string) {
  if(typeof base64!=='string'||base64.length<44) return null;
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes:number[]=[];let bits=0,acc=0;
  for(const char of base64.slice(0,48)) {const value=alphabet.indexOf(char);if(value<0) return null;acc=(acc<<6)|value;bits+=6;if(bits>=8){bits-=8;bytes.push((acc>>bits)&255);}}
  if(![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)||bytes[11]!==13||bytes.slice(12,16).join(',')!=='73,72,68,82') return null;
  const uint=(i:number)=>((bytes[i]*16777216)+(bytes[i+1]<<16)+(bytes[i+2]<<8)+bytes[i+3]);
  const width=uint(16),height=uint(20);
  return width>0&&height>0&&width<=32768&&height<=32768&&width*height<=40000000?{width,height}:null;
}
export function picturesIn(output:any,input:any={}) {
  const out:any[]=[];
  if(output?.type==='image'&&typeof output.file?.base64==='string') out.push({base64:output.file.base64,path:input.file_path,label:input.file_path||'Image'});
  if(Array.isArray(output?.attachments)) for(const file of output.attachments) {
    if(file.isImage&&typeof file.path==='string'&&file.path.startsWith('/')&&file.pathValidated!==false&&!file.upload_error&&!file.partial_error)
      out.push({path:file.path,label:file.path});
  }
  if(Array.isArray(output?.content)) for(const part of output.content) {
    if(part.type==='image'&&typeof part.data==='string') out.push({base64:part.data,label:'Tool screenshot'});
  }
  return out;
}
export function capabilities(env:Record<string,string|undefined>) {
  if(env.NO_COLOR) return {pictures:false,reason:'NO_COLOR disables terminal image rendering; using themed text'};
  const native=env.TERM_PROGRAM==='ghostty'||env.TERM_PROGRAM==='cmux'||env.TERM==='xterm-kitty'||!!env.KITTY_WINDOW_ID;
  const multiplexed=!!env.TMUX||!!env.STY||/^(screen|tmux)/.test(env.TERM||'');
  const forced=env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES==='1';
  return {pictures:(native&&!multiplexed)||forced,reason:multiplexed&&!forced?'Multiplexer: text fallback (image passthrough not confirmed)':native||forced?'Terminal image output enabled':'Terminal image support not confirmed; themed text fallback'};
}
export function replaceNative(tree:any,body:any):{node:any;replaced:boolean} {
  if(tree?.type==='engine') return {node:body,replaced:true};
  if(!Array.isArray(tree?.children)) return {node:tree,replaced:false};
  let replaced=false;
  const children=tree.children.map((child:any)=>{const r=replaceNative(child,body);replaced ||= r.replaced;return r.node;});
  return {node:replaced?{...tree,children}:tree,replaced};
}
export const fileLink=(path:string)=>`file://${path.split('/').map(encodeURIComponent).join('/')}`;
export const previewNumbers=(text:string)=>[...new Set([...text.matchAll(/\[Image #(\d+)\]/g)].map(m=>Number(m[1])))].slice(0,6);
