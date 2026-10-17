"""Offline native /subtask integration. Run with: uv run --with pyte python ..."""
import codecs, fcntl, http.server, json, os, pathlib, pty, select, shutil, signal, struct, subprocess, tempfile, termios, threading, time
import pyte

ROOT = pathlib.Path(tempfile.mkdtemp(prefix='handoff-terminal-check-')).resolve()
PLUGIN = pathlib.Path(__file__).resolve().parents[1]
config, project = ROOT / 'config', ROOT / 'project'
config.mkdir(); project.mkdir()
(config / '.claude.json').write_text(json.dumps({'hasCompletedOnboarding': True, 'lastOnboardingVersion': '2.1.302', 'theme': 'dark', 'projects': {str(project): {'hasTrustDialogAccepted': True}}}))
(config / 'settings.json').write_text(json.dumps({'skipDangerousModePermissionPrompt': True, 'effortLevel': 'medium'}))
requests = []
first_handoff = threading.Event()
release_handoff = threading.Event()

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
        if '/messages' not in self.path or 'count_tokens' in self.path:
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"input_tokens":100}'); return
        contents = json.dumps(body.get('messages', []))
        agent = body.get('model') == 'claude-opus-5-5' and bool(body.get('tools'))
        first = agent and not first_handoff.is_set()
        naming = body.get('model') == 'claude-haiku-5-5' and not body.get('tools')
        reply = 'Fix order routing' if naming else 'HANDOFF_DONE' if agent else 'MAIN_OR_SUBTASK_REPLY'
        requests.append(body)
        (ROOT / 'requests.json').write_text(json.dumps(requests, indent=2))
        if first:
            first_handoff.set(); release_handoff.wait(45)
        if not body.get('stream'):
            response = {'id': 'msg_fixture', 'type': 'message', 'role': 'assistant', 'model': body.get('model'), 'content': [{'type':'text','text':reply}], 'stop_reason':'end_turn', 'usage':{'input_tokens':100,'output_tokens':10}}
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(response).encode()); return
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        def send(event):
            self.wfile.write(('event: '+event['type']+'\ndata: '+json.dumps(event)+'\n\n').encode()); self.wfile.flush()
        send({'type':'message_start','message':{'id':'msg_'+str(len(requests)),'type':'message','role':'assistant','model':body.get('model'),'content':[],'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':100,'output_tokens':0}}})
        if first:
            send({'type':'content_block_start','index':0,'content_block':{'type':'tool_use','id':'handoff_fixture_tool','name':'Bash','input':{}}})
            send({'type':'content_block_delta','index':0,'delta':{'type':'input_json_delta','partial_json':json.dumps({'command':'printf HANDOFF_STEP','description':'Offline handoff fixture'})}})
        else:
            send({'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})
            send({'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':reply}})
        send({'type':'content_block_stop','index':0})
        send({'type':'message_delta','delta':{'stop_reason':'tool_use' if first else 'end_turn','stop_sequence':None},'usage':{'output_tokens':10}})
        send({'type':'message_stop'})

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
env = os.environ.copy()
for key in list(env):
    if key.startswith(('ANTHROPIC_', 'CLAUDE_CODE_', 'CLAUDE_CONFIG_')) or key == 'CLAUDECODE': env.pop(key, None)
env.update(CLAUDE_CONFIG_DIR=str(config), ANTHROPIC_AUTH_TOKEN='offline-fixture', ANTHROPIC_BASE_URL=f'http://127.0.0.1:{server.server_port}', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1', DISABLE_AUTOUPDATER='1', TERM='xterm-256color', CLAUDE_CODE_NO_FLICKER='1', CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1')
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
args = [shutil.which('claude'), '--plugin-dir', str(PLUGIN), '--dangerously-skip-permissions', '--verbose', '--model', 'claude-sonnet-5-5', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--debug-file', str(ROOT/'debug.log'), 'Remember HANDOFF_PARENT_CONTEXT for the upcoming task.']
proc = subprocess.Popen(args, cwd=project, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
screen = pyte.Screen(160, 50); stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder('utf-8')('replace'); raw = bytearray()
def pump(seconds=.2):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if select.select([master], [], [], .05)[0]:
            try: chunk = os.read(master, 65536)
            except OSError: break
            raw.extend(chunk); stream.feed(decoder.decode(chunk))
            if b'\x1b[6n' in chunk: os.write(master, b'\x1b[1;1R')
    view = '\n'.join(screen.display); (ROOT/'screen.txt').write_text(view); return view
def wait_for(needle, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        view = pump()
        if needle in view: return view
        if proc.poll() is not None: break
    raise AssertionError(f'Missing {needle}; see {ROOT}')
def wait_until(predicate, description, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pump()
        if predicate(): return
    raise AssertionError(f'Missing {description}; see {ROOT}')
def command(value):
    os.write(master, b'\x1b'); pump(.2)
    os.write(master, value.encode()); pump(.2); os.write(master, b'\r'); pump(.4)
def click(label):
    wait_for(label)
    row = next(i for i, line in enumerate(screen.display) if label in line)
    col = screen.display[row].index(label) + 2
    os.write(master, f'\x1b[<0;{col+1};{row+1}M\x1b[<0;{col+1};{row+1}m'.encode()); pump(.3)
def handoffs(): return [r for r in requests if r.get('model') == 'claude-opus-5-5' and r.get('tools')]

try:
    print(f'Artifacts: {ROOT}', flush=True)
    wait_for('MAIN_OR_SUBTASK_REPLY')
    command('/handoff-settings')
    click('Opus 5.5'); click('[ high ]')
    (ROOT/'settings.txt').write_text(pump())
    click('[ Close ]')
    command('/handoff')
    wait_until(first_handoff.is_set, 'first configured handoff')
    wait_for('fix-order-routing')
    naming = [r for r in requests if r.get('model') == 'claude-haiku-5-5' and not r.get('tools')]
    assert len(naming) == 1, naming
    assert 'HANDOFF_PARENT_CONTEXT' in json.dumps(naming[0]['messages'])
    assert naming[0].get('output_config', {}).get('effort') == 'low', naming[0].get('output_config')
    (ROOT/'named-thread.txt').write_text(pump())
    first = handoffs()[0]
    assert first['output_config']['effort'] == 'high', first.get('output_config')
    inherited = json.dumps(first['messages'])
    for text in ['HANDOFF_PARENT_CONTEXT', 'MAIN_OR_SUBTASK_REPLY', 'current task or latest agreed plan', 'exactly one new', 'latest remote main', 'gh pr create --base main']:
        assert text in inherited, text
    assert first['tools'], 'native tools missing'
    command('/handoff-settings'); click('[ low ]'); click('[ Close ]')
    command('/reload-plugins --force'); pump(2)
    release_handoff.set()
    wait_until(lambda: len(handoffs()) >= 2, 'handoff tool continuation after reload')
    assert handoffs()[1]['output_config']['effort'] == 'high', handoffs()[1].get('output_config')
    command('/handoff-settings')
    wait_for('Selected: Opus 5.5'); wait_for('✓ low')
    click('[ Close ]')
    command('/handoff HANDOFF_TASK_TWO')
    wait_until(lambda: len(handoffs()) >= 3, 'second handoff')
    assert handoffs()[2]['output_config']['effort'] == 'low', handoffs()[2].get('output_config')
    count = len(requests)
    command('/subtask ORDINARY_SUBTASK')
    wait_until(lambda: any('ORDINARY_SUBTASK' in json.dumps(r.get('messages')) and r.get('tools') for r in requests[count:]), 'ordinary subtask')
    ordinary = next(r for r in requests[count:] if 'ORDINARY_SUBTASK' in json.dumps(r.get('messages')) and r.get('tools'))
    assert ordinary['model'] == 'claude-sonnet-5-5', ordinary['model']
    assert ordinary.get('output_config', {}).get('effort') == 'medium', ordinary.get('output_config')
    count = len(requests)
    command('MAIN_AFTER_HANDOFF')
    wait_until(lambda: any('MAIN_AFTER_HANDOFF' in json.dumps(r.get('messages')) and r.get('tools') for r in requests[count:]), 'main follow-up')
    main = next(r for r in requests[count:] if 'MAIN_AFTER_HANDOFF' in json.dumps(r.get('messages')) and r.get('tools'))
    assert main['model'] == 'claude-sonnet-5-5', main['model']
    assert main.get('output_config', {}).get('effort') == 'medium', main.get('output_config')
    assert len([r for r in requests if r.get('model') == 'claude-haiku-5-5' and not r.get('tools')]) == 2
    result = {'haiku_thread_naming': True, 'bare_handoff': True, 'native_subtask': True, 'full_context': True, 'saved_model_effort': True, 'reload_keeps_running_override': True, 'main_and_ordinary_subtask_unchanged': True, 'paid_api_requests': False, 'real_prs_opened': False}
    (ROOT/'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)
finally:
    release_handoff.set()
    (ROOT/'raw.txt').write_bytes(raw)
    if proc.poll() is None: os.killpg(proc.pid, signal.SIGTERM)
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired: os.killpg(proc.pid, signal.SIGKILL); proc.wait()
    os.close(master); server.shutdown()
