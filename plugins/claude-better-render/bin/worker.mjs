import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { renderPicture, renderText } from './mermaid/diagram.mjs';
import { terminalCell } from './mermaid/font-metrics.mjs';
import { terminalColors } from './mermaid/terminal-colors.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = '0.1.0';
const MAX_FILE = 24 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));
function run(file, args, timeout = 15000) {
  const r = spawnSync(file, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9' } });
  if (r.error || r.status !== 0) throw new Error((r.error?.message || r.stderr || `${file} failed`).slice(0, 400));
  return r.stdout;
}
function cacheRoot() {
  const dir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'aj-better-render', VERSION);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) throw new Error('Cache directory is not private');
  fs.chmodSync(dir, 0o700);
  return dir;
}
function trimCache(dir) {
  const entries = fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}$/.test(n)).map(n => ({ n, s: fs.lstatSync(path.join(dir,n)) }))
    .filter(e => e.s.isDirectory() && !e.s.isSymbolicLink()).sort((a,b) => b.s.mtimeMs - a.s.mtimeMs);
  for (const e of entries.slice(192)) if (Date.now() - e.s.mtimeMs > 120000) fs.rmSync(path.join(dir,e.n), { recursive:true, force:true });
}
export function pngHeader(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii',12,16) !== 'IHDR') return null;
  const width=bytes.readUInt32BE(16), height=bytes.readUInt32BE(20);
  if (!width || !height || width > 32768 || height > 32768 || width*height > 40000000) return null;
  return { width,height };
}
function fitAndSplit(file, dir, req, document = false) {
  const bytes=fs.readFileSync(file);
  if (!pngHeader(bytes)) throw new Error('Invalid or oversized PNG');
  let png=PNG.sync.read(bytes);
  const columns=clamp(req.columns,1,200), cell=clamp(req.cellRatio,1,4);
  // Images fit a preview; documents retain readable text and split vertically.
  const maxWidth=columns*12, maxRows=clamp(req.maxRows||32,1,32);
  const scale=Math.min(1,maxWidth/png.width, document ? 1 : maxRows*12*cell/png.height);
  if (scale<1) {
    const resized=new PNG({width:Math.max(1,Math.round(png.width*scale)),height:Math.max(1,Math.round(png.height*scale))});
    for(let y=0;y<resized.height;y++) for(let x=0;x<resized.width;x++) {
      const from=(Math.min(png.height-1,Math.floor(y/scale))*png.width+Math.min(png.width-1,Math.floor(x/scale)))*4;
      png.data.copy(resized.data,(y*resized.width+x)*4,from,from+4);
    }
    png=resized;
  }
  const shownColumns=document ? columns : Math.min(columns,Math.max(1,Math.ceil(png.width/12)));
  const pxRow=png.width/shownColumns*cell;
  const sliceRows=Math.max(1,Math.floor(pxRow*180));
  const pages=[];
  for(let top=0;top<png.height;top+=sliceRows) {
    const height=Math.min(sliceRows,png.height-top);
    const piece=new PNG({width:png.width,height});
    png.data.copy(piece.data,0,top*png.width*4,(top+height)*png.width*4);
    let encoded=PNG.sync.write(piece);
    if(encoded.length>1900000) throw new Error('Image exceeds terminal transfer limit; use source view');
    const target=path.join(dir,`page-${pages.length}.png`);fs.writeFileSync(target,encoded,{mode:0o600});
    pages.push({file:target,width:piece.width,height,columns:shownColumns,rows:Math.max(1,Math.min(document?180:maxRows,Math.ceil(height/pxRow)))});
  }
  return pages;
}
function probe(req) {
  let cell={},colors={},typst=null;
  try {cell=terminalCell({terminal:req.terminal||'ghostty'});} catch {}
  try {colors=terminalColors({terminal:req.terminal||'ghostty',prefersDark:req.dark!==false});} catch {}
  try {typst=run('typst',['--version'],3000).trim();} catch {}
  let weight='regular';
  if(req.terminal==='ghostty') try {
    const config=fs.readFileSync(path.join(os.homedir(),'.config/ghostty/config'),'utf8');
    if(/^\s*font-style\s*=\s*"?bold"?\s*$/im.test(config)) weight='bold';
  } catch {}
  return {typst,cell,colors,weight,node:process.version};
}
export async function work(req) {
  if(req.kind==='probe') return probe(req);
  if(!['document','mermaid','image'].includes(req.kind)) throw new Error('Unknown render kind');
  if(typeof req.source==='string'&&req.source.length>120000) throw new Error('Block too large; showing source');
  let input;
  if(req.kind==='image') {
    if(req.base64) {
      if(req.base64.length>MAX_FILE*1.4) throw new Error('Image too large');
      input=Buffer.from(req.base64,'base64');
    } else {
      if(typeof req.path!=='string'||!path.isAbsolute(req.path)) throw new Error('Image needs an absolute path');
      const stat=fs.statSync(req.path);if(!stat.isFile()||stat.size>MAX_FILE) throw new Error('Image too large or not a file');
      input=fs.readFileSync(req.path);
    }
  }
  const identity={...req,base64:undefined,path:req.kind==='image'?undefined:req.path,bytes:input?hash(input):undefined};
  const key=hash(JSON.stringify({version:VERSION,...identity}));
  const cache=cacheRoot(),dir=path.join(cache,key),resultFile=path.join(dir,'result.json');
  if(fs.existsSync(resultFile)) {
    const result=JSON.parse(fs.readFileSync(resultFile,'utf8'));
    if(result.pages?.every(p=>fs.existsSync(p.file))) return result;
  }
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(fs.lstatSync(dir).isSymbolicLink()) throw new Error('Invalid cache entry');
  let result;
  if(req.kind==='mermaid') {
    const item={key:'diagram',source:req.source,math:[],maxColumns:clamp(req.columns,1,200),maxRows:50};
    if(req.textOnly) result={text:renderText(item).text};
    else {
      const drawn=renderPicture(item,{outDir:dir,rowPx:24,cellRatio:req.cellRatio||2,lineEm:1.3,textScale:req.size/100||1,
        theme:'auto',overrides:{bg:req.bg||'#ffffff',fg:req.fg||'#24292f',accent:req.accent||'#0969da'},
        font:req.font||'auto',terminal:{background:req.bg,foreground:req.fg},prefersDark:req.dark!==false});
      result={pages:fitAndSplit(drawn.file,dir,req)};
    }
  } else if(req.kind==='document') {
    const doc={source:req.source,width:clamp(req.columns,1,200)*6,size:11*clamp(req.size||100,75,160)/100,
      fg:req.fg||'#24292f',bg:req.bg||'#ffffff',accent:req.accent||'#0969da',font:req.font||'Menlo',weight:req.weight||'regular'};
    fs.writeFileSync(path.join(dir,'document.json'),JSON.stringify(doc),{mode:0o600});
    fs.copyFileSync(path.join(root,'render/document.typ'),path.join(dir,'document.typ'));
    run('typst',['compile','--root',dir,'--package-path',path.join(root,'render/packages'),'--package-cache-path',path.join(root,'render/packages'),
      '--format','png','--ppi','144',path.join(dir,'document.typ'),path.join(dir,'document.png')]);
    result={pages:fitAndSplit(path.join(dir,'document.png'),dir,req,true)};
  } else {
    if(input.length>MAX_FILE) throw new Error('Image too large');
    let file=path.join(dir,'input.png');
    if(pngHeader(input)) fs.writeFileSync(file,input,{mode:0o600});
    else {
      // Typst detects JPEG/WebP by bytes; stage only this file under its root.
      if(input.subarray(0,4).equals(Buffer.from([137,80,78,71]))) throw new Error('Invalid PNG header');
      const staged=path.join(dir,'input-image');fs.writeFileSync(staged,input,{mode:0o600});
      fs.copyFileSync(path.join(root,'render/convert.typ'),path.join(dir,'convert.typ'));
      run('typst',['compile','--root',dir,'--format','png','--ppi','72','--input','f=input-image','--input','maxw=1600','--input','maxh=1600',path.join(dir,'convert.typ'),file]);
    }
    result={pages:fitAndSplit(file,dir,req)};
  }
  const tmp=resultFile+`.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(result),{mode:0o600});fs.renameSync(tmp,resultFile);
  trimCache(cache);
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const req=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(await work(req)));}
  catch(error) {process.stdout.write(JSON.stringify({error:String(error.message||error).slice(0,400)}));process.exitCode=1;}
}
