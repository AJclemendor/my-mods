import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import { work, pngHeader } from '../bin/worker.mjs';

const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'better-render-worker-'));
process.env.XDG_CACHE_HOME=scratch;
const image=(r=255,b=0)=>{const p=new PNG({width:24,height:16});for(let i=0;i<p.data.length;i+=4){p.data[i]=r;p.data[i+2]=b;p.data[i+3]=255;}return PNG.sync.write(p,{deflateLevel:0,filterType:0});};
const common={columns:64,size:100,font:'Menlo',fg:'#24292f',bg:'#ffffff',accent:'#0969da',cellRatio:2};
test('truncated PNGs and invalid dimensions are rejected without RangeError',()=>{
  for(let i=0;i<33;i++)assert.equal(pngHeader(image().subarray(0,i)),null);
  const b=image();b.writeUInt32BE(0,16);assert.equal(pngHeader(b),null);
  assert.deepEqual(pngHeader(image()),{width:24,height:16});
});
test('same path and byte length with different contents makes a new preview',async()=>{
  const file=path.join(scratch,'same.png'),one=image(255,0),two=image(0,255);
  assert.equal(one.length,two.length);
  fs.writeFileSync(file,one);const a=await work({...common,kind:'image',path:file});
  fs.writeFileSync(file,two);const b=await work({...common,kind:'image',path:file});
  assert.notEqual(a.pages[0].file,b.pages[0].file);
  assert.notDeepEqual(fs.readFileSync(a.pages[0].file),fs.readFileSync(b.pages[0].file));
});
test('a narrow image never exceeds available columns',async()=>{
  const r=await work({...common,kind:'image',base64:image().toString('base64'),columns:3});
  assert.ok(r.pages.every(p=>p.columns<=3&&p.rows>0));
});

test('Mermaid renders to both a picture and text without network calls',async()=>{
  const req={...common,kind:'mermaid',source:'flowchart LR\n A[Input] --> B[Output]'};
  const graph=await work(req);assert.ok(pngHeader(fs.readFileSync(graph.pages[0].file)));
  const text=await work({...req,textOnly:true});assert.match(text.text,/Input/);assert.match(text.text,/Output/);
});
test('invalid Mermaid fails so the hook can keep the readable source',async()=>{
  await assert.rejects(work({...common,kind:'mermaid',source:'this is not mermaid'}));
});



test('tall draft thumbnails obey the available row budget',async()=>{
  const tall=new PNG({width:24,height:1200});tall.data.fill(255);
  const r=await work({...common,kind:'image',base64:PNG.sync.write(tall).toString('base64'),maxRows:3});
  assert.ok(r.pages.every(p=>p.rows<=3&&p.columns<=64));
});

test('worker entry point runs when launched through a symlinked directory',()=>{
  const alias=path.join(scratch,'worker-alias');
  fs.symlinkSync(path.dirname(fileURLToPath(new URL('../bin/worker.mjs',import.meta.url))),alias,'dir');
  const r=spawnSync(process.execPath,[path.join(alias,'worker.mjs')],{input:JSON.stringify({...common,kind:'image',base64:image().toString('base64')}),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.ok(JSON.parse(r.stdout).pages.length);
});

test('document typesetting is unavailable',async()=>{
  await assert.rejects(work({...common,kind:'document',source:'# Heading'}),/Unknown render kind/);
});
test('JPEG and WebP previews work without an external compiler',async()=>{
  for(const format of ['jpeg','webp']) {
    const bytes=await sharp(image()).toFormat(format).toBuffer();
    const r=await work({...common,kind:'image',base64:bytes.toString('base64')});
    assert.ok(pngHeader(fs.readFileSync(r.pages[0].file)));
  }
});
