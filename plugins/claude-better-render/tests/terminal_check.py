"""Offline integration replay. --gui also verifies rendering in a real kitty window."""
import argparse, codecs, fcntl, http.server, json, os, pathlib, pty, select, shutil, struct, subprocess, tempfile, termios, threading, time, zlib, unicodedata
import pyte
args=argparse.ArgumentParser();args.add_argument('--gui',action='store_true');args=args.parse_args()
ROOT=pathlib.Path(tempfile.mkdtemp(prefix='better-render-terminal-')).resolve()
PLUGIN=pathlib.Path(__file__).resolve().parents[1]
CONFIG=ROOT/'config';PROJECT=ROOT/'project';CONFIG.mkdir();PROJECT.mkdir()
(CONFIG/'.claude.json').write_text(json.dumps({'hasCompletedOnboarding':True,'lastOnboardingVersion':'2.1.312','theme':'light','projects':{str(PROJECT):{'hasTrustDialogAccepted':True}}}))
(CONFIG/'settings.json').write_text(json.dumps({'theme':'light','skipDangerousModePermissionPrompt':True}))
def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
raw=b''.join(b'\0'+bytes([30+y//3,110,220,255])*200 for y in range(100))
PNG=PROJECT/'sample.png';PNG.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',200,100,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
TEXT='''# Better Render — visual check

Readable **Markdown**, a table, and $E=mc^2$ in the same reply.

| Feature | Result |
| --- | --- |
| Typesetting | Ready |
| Inline images | Ready |

```mermaid
flowchart LR
  A[Source] --> B[One renderer]
  B --> C[Readable reply]
```

```rust
let price = 42;
println!("{price}");
```

REPLAY_COMPLETE
'''
requests=[]
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or '{}');requests.append(self.path)
  main=bool(body.get('tools'));is_result='tool_result' in json.dumps(body.get('messages',[]))
  if 'count_tokens' in self.path:
   self.send_response(200);self.end_headers();self.wfile.write(b'{"input_tokens":100}');return
  if not body.get('stream'):
   response={'id':'fixture','type':'message','role':'assistant','model':'claude-sonnet-4-6','content':[{'type':'text','text':'Fixture'}],'stop_reason':'end_turn','usage':{'input_tokens':100,'output_tokens':10}}
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(response).encode());return
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  def send(e):self.wfile.write(('event: '+e['type']+'\ndata: '+json.dumps(e)+'\n\n').encode());self.wfile.flush()
  send({'type':'message_start','message':{'id':'fixture','type':'message','role':'assistant','model':'claude-sonnet-4-6','content':[],'stop_reason':None,'usage':{'input_tokens':100,'output_tokens':0}}})
  if main and not is_result:
   send({'type':'content_block_start','index':0,'content_block':{'type':'tool_use','id':'read-fixture','name':'Read','input':{}}})
   send({'type':'content_block_delta','index':0,'delta':{'type':'input_json_delta','partial_json':json.dumps({'file_path':str(PNG)})}})
   reason='tool_use'
  else:
   send({'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})
   for part in [TEXT[i:i+100] for i in range(0,len(TEXT),100)]:
    send({'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':part}});time.sleep(.02)
   reason='end_turn'
  send({'type':'content_block_stop','index':0});send({'type':'message_delta','delta':{'stop_reason':reason},'usage':{'output_tokens':100}});send({'type':'message_stop'})
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
env=os.environ.copy()
for k in ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CLAUDECODE','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','NO_COLOR','CLAUDE_CODE_DISABLE_TERMINAL_IMAGES','CLAUDE_AX_SCREEN_READER','CLAUDE_CODE_ACCESSIBILITY']:env.pop(k,None)
env.update(CLAUDE_CONFIG_DIR=str(CONFIG),ANTHROPIC_AUTH_TOKEN='offline-fixture',ANTHROPIC_BASE_URL=f'http://127.0.0.1:{server.server_port}',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',DISABLE_AUTOUPDATER='1',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1',CLAUDE_CODE_NO_FLICKER='1',CLAUDE_CODE_FORCE_TERMINAL_IMAGES='1',TERM='xterm-kitty',TERM_PROGRAM='kitty',KITTY_WINDOW_ID='1')
cli=[shutil.which('claude'),'--plugin-dir',str(PLUGIN)]
for p in ['compact-tools','live-thinking']:cli+=['--plugin-dir',str(PLUGIN.parent/p)]
cli+=['--model','claude-sonnet-4-6','--dangerously-skip-permissions','--verbose','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--debug-file',str(ROOT/'debug.log'),'Read the sample image and show the fixture reply.']
kitty='/Applications/kitty.app/Contents/MacOS/kitty';kitten='/Applications/kitty.app/Contents/MacOS/kitten';socket=str(ROOT/'kitty.sock')
if args.gui:
 proc=subprocess.Popen([kitty,'--title','Better Render QA','--listen-on','unix:'+socket,'--override','allow_remote_control=yes','--override','font_size=13','--override','background=#ffffff','--override','foreground=#24292f',*cli],cwd=PROJECT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 def remote(*a):return subprocess.check_output([kitten,'@','--to','unix:'+socket,*a],text=True,stderr=subprocess.DEVNULL)
 def pump(seconds=.3):
  time.sleep(seconds)
  try:view=remote('get-text','--extent','screen')
  except subprocess.CalledProcessError:return ''
  (ROOT/'screen.txt').write_text(view);return view
 def send(data):remote('send-text',data)
else:
 master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',55,150,0,0))
 proc=subprocess.Popen(cli,cwd=PROJECT,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave)
 screen=pyte.Screen(150,55);stream=pyte.Stream(screen);decoder=codecs.getincrementaldecoder('utf8')('replace');rawlog=bytearray();pending=''
 def feed(value):
  stream.feed(''.join(' ' if c=='\U0010eeee' else c for c in value if not unicodedata.category(c).startswith('M')))
 def pump(seconds=.3):
  global pending
  until=time.monotonic()+seconds
  while time.monotonic()<until:
   if select.select([master],[],[],.05)[0]:
    try:data=os.read(master,65536)
    except OSError:break
    rawlog.extend(data);pending+=decoder.decode(data)
    # pyte does not understand kitty APC image payloads. Keep the bytes in the
    # evidence log, but strip each complete graphics command before text parsing.
    while pending:
     start=pending.find('\x1b_G')
     if start<0:
      keep=1 if pending.endswith('\x1b') else 0
      feed(pending[:-keep] if keep else pending);pending=pending[-keep:] if keep else '';break
     feed(pending[:start]);pending=pending[start:]
     end=pending.find('\x1b\\',3)
     if end<0:break
     pending=pending[end+2:]
    if b'\x1b[6n' in data:os.write(master,b'\x1b[1;1R')
  view='\n'.join(screen.display);(ROOT/'screen.txt').write_text(view);(ROOT/'terminal.raw').write_bytes(rawlog);return view
 def send(data):os.write(master,data.encode())
def wait_for(needle,timeout=30):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  view=pump()
  if needle in view:return view
 raise AssertionError(f'Missing {needle!r}; see {ROOT}')
def command(text):send('\x1b');pump(.2);send(text);pump(.2);send('\r');return pump(1)
try:
 # Source-copy actions remain text even when the answer is rasterized.
 wait_for('Copy reply');pump(3);(ROOT/'rendered.txt').write_text(pump())
 command('/render doctor');wait_for('Better Render 0.1.1');(ROOT/'doctor.txt').write_text(pump())
 assert 'typst 0.15' in pump(),pump()
 assert 'Last fallback:' not in pump(),pump()
 command('/render mode text')
 wait_for('mode: text');(ROOT/'text-mode.txt').write_text(pump())
 command('/render mode auto');wait_for('mode: auto');pump(2)
 command('/render demo');wait_for('Tool style: inherit');pump(3)
 (ROOT/'settings.txt').write_text(pump())
 if not args.gui:assert rawlog.count(b'\x1b_G')>0, 'No terminal image protocol output'
 if args.gui:
  print('GUI_READY '+str(ROOT),flush=True)
  deadline=time.monotonic()+240
  while not (ROOT/'finish').exists() and time.monotonic()<deadline:time.sleep(.5)
 print('PASS: real local API replay, Read image, mixed Markdown/math/Mermaid/code, settings and mode toggle. '+str(ROOT),flush=True)
finally:
 if args.gui:
  try:remote('close-window')
  except Exception:pass
 else:os.close(master)
 proc.terminate()
 try:proc.wait(timeout=3)
 except subprocess.TimeoutExpired:proc.kill();proc.wait()
 server.shutdown()
