"""Offline terminal integration checks. Requires pyte and Claude Code on PATH."""
import codecs, fcntl, http.server, json, os, pathlib, pty, select, shutil, struct, subprocess, tempfile, termios, threading, time
import pyte
ROOT = pathlib.Path(tempfile.mkdtemp(prefix='btw-chat-check-')).resolve()
PLUGINS = pathlib.Path(__file__).resolve().parents[2]
CLI = shutil.which("claude")
if CLI is None:
    raise SystemExit("Claude Code must be on PATH")

def check(fullscreen):
    mode = 'fullscreen' if fullscreen else 'classic'
    root = ROOT / mode
    config, project = root / 'config', root / 'project'
    config.mkdir(parents=True); project.mkdir()
    (config / '.claude.json').write_text(json.dumps({'hasCompletedOnboarding': True, 'lastOnboardingVersion': '2.1.288', 'theme': 'dark', 'projects': {str(project): {'hasTrustDialogAccepted': True}}}))
    (config / 'settings.json').write_text(json.dumps({'showThinkingSummaries': True, 'skipDangerousModePermissionPrompt': True}))
    requests = []; main_count = 0; side_count = 0
    main_started = threading.Event(); release_main = threading.Event()
    side_started = threading.Event(); release_side = threading.Event()
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            nonlocal main_count, side_count
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
            if '/messages' not in self.path or 'count_tokens' in self.path:
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"input_tokens":100}'); return
            content = json.dumps(body.get('messages', []))
            side = 'ongoing BTW side conversation' in content
            main = bool(body.get('tools')) and not side
            if side: side_count += 1
            elif main: main_count += 1
            text = f'SIDE_REPLY_{side_count}' if side else f'MAIN_REPLY_{main_count}' if main else 'Fixture title'
            requests.append({'side': side, 'main': main, 'body': body, 'reply': text})
            if main and main_count == 3:
                main_started.set(); release_main.wait(20)
            if side and side_count == 5:
                side_started.set(); release_side.wait(20)
            if not body.get('stream'):
                response = {'id':'msg_fixture','type':'message','role':'assistant','model':'claude-sonnet-4-6','content':[{'type':'text','text':text}],'stop_reason':'end_turn','usage':{'input_tokens':100,'output_tokens':10}}
                self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(json.dumps(response).encode()); return
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            def send(event):
                self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode()); self.wfile.flush()
            send({'type':'message_start','message':{'id':'msg_fixture_'+str(len(requests)),'type':'message','role':'assistant','model':'claude-sonnet-4-6','content':[],'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':100,'output_tokens':0}}})
            send({'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})
            send({'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':text}})
            send({'type':'content_block_stop','index':0})
            send({'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':10}})
            send({'type':'message_stop'})
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler); server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = os.environ.copy()
    for key in ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CONFIG_DIR','CLAUDECODE','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY']:
        env.pop(key, None)
    env.update(CLAUDE_CONFIG_DIR=str(config),ANTHROPIC_AUTH_TOKEN='offline-fixture',ANTHROPIC_BASE_URL=f'http://127.0.0.1:{server.server_port}',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',DISABLE_AUTOUPDATER='1',TERM='xterm-256color',CLAUDE_CODE_NO_FLICKER='1' if fullscreen else '0',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1')
    master, slave = pty.openpty(); fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',50,160,0,0))
    args = [str(CLI)]
    for plugin in ['compact-tools','live-thinking','sidebar-controls','btw-chat']:
        args += ['--plugin-dir', str(PLUGINS / plugin)]
    args += ['--dangerously-skip-permissions','--verbose','--model','claude-sonnet-4-6','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--debug-file',str(root/'debug.log'),'Initial fixture prompt']
    proc = subprocess.Popen(args,cwd=project,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True); os.close(slave)
    screen = pyte.Screen(160,50); stream = pyte.Stream(screen); decoder = codecs.getincrementaldecoder('utf-8')('replace'); raw = bytearray()
    def pump(seconds=.2):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if select.select([master],[],[],.05)[0]:
                try: chunk = os.read(master,65536)
                except OSError: break
                raw.extend(chunk); stream.feed(decoder.decode(chunk))
                if b'\x1b[6n' in chunk: os.write(master,b'\x1b[1;1R')
        view = '\n'.join(screen.display); (root/'screen.txt').write_text(view); return view
    def wait_for(needle, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            view = pump()
            if needle in view: return view
            if proc.poll() is not None: break
        raise AssertionError(f'{mode}: missing {needle}; see {root}')
    def command(value):
        os.write(master,b'\x1b'); pump(.3)
        os.write(master,value.encode()); pump(.2); os.write(master,b'\r'); pump(.3)
    def click_text(label):
        wait_for(label)
        row = next(i for i,line in enumerate(screen.display) if label in line)
        col = screen.display[row].index(label) + 2
        os.write(master, f'\x1b[<0;{col+1};{row+1}M\x1b[<0;{col+1};{row+1}m'.encode()); pump(.3)
    def select_option(label, steps):
        click_text(label)
        os.write(master, b'\x1b[B' * steps); pump(.2)
        os.write(master, b'\r'); pump(.3)
    try:
        wait_for('MAIN_REPLY_1')
        command('/btw QUESTION_ONE')
        wait_for('SIDE_REPLY_1'); (root/'first-side.txt').write_text(pump())
        side1 = next(r for r in requests if r['side'])
        assert 'MAIN_REPLY_1' in json.dumps(side1['body']), 'latest completed main reply missing'
        command('Main second prompt')
        wait_for('MAIN_REPLY_2')
        command('/btw QUESTION_TWO')
        wait_for('SIDE_REPLY_2'); (root/'follow-up.txt').write_text(pump())
        side2 = [r for r in requests if r['side']][1]
        assert all(s in json.dumps(side2['body']) for s in ['MAIN_REPLY_2','QUESTION_ONE','SIDE_REPLY_1','QUESTION_TWO'])
        command('/btw reset')
        view = pump(.5)
        assert 'SIDE_REPLY_1' not in view and 'SIDE_REPLY_2' not in view, 'reset retained old side messages'
        command('/btw QUESTION_THREE')
        wait_for('SIDE_REPLY_3')
        side3 = [r for r in requests if r['side']][2]
        text = json.dumps(side3['body'])
        assert 'QUESTION_ONE' not in text and 'SIDE_REPLY_1' not in text, 'reset side history reached model'
        assert 'MAIN_REPLY_2' in text
        main2 = [r for r in requests if r['main']][1]
        assert 'QUESTION_ONE' not in json.dumps(main2['body']) and 'SIDE_REPLY_1' not in json.dumps(main2['body']), 'side chat polluted main context'
        if fullscreen:
            command('Main concurrent prompt')
            deadline = time.monotonic() + 10
            while not main_started.is_set() and time.monotonic() < deadline: pump()
            assert main_started.is_set(), 'concurrent main request never started'
            os.write(master,b'/btw DURING_MAIN'); pump(.2); os.write(master,b'\r'); pump(.3)
            wait_for('SIDE_REPLY_4')
            assert not release_main.is_set()
            release_main.set(); wait_for('MAIN_REPLY_3')
            command('/btw SLOW_SIDE')
            deadline = time.monotonic() + 10
            while not side_started.is_set() and time.monotonic() < deadline: pump()
            assert side_started.is_set(), 'slow side request never started'
            wait_for('Thinking…')
            # Click the actual Reset button while the server is holding the old answer.
            row = next(i for i,line in enumerate(screen.display) if 'Reset chat' in line)
            col = screen.display[row].index('Reset chat') + 2
            os.write(master, f'\x1b[<0;{col+1};{row+1}M\x1b[<0;{col+1};{row+1}m'.encode()); pump(.4)
            wait_for('Ask a follow-up')
            row = next(i for i,line in enumerate(screen.display) if 'Ask a follow-up' in line)
            col = screen.display[row].index('Ask a follow-up') + 2
            os.write(master, f'\x1b[<0;{col+1};{row+1}M\x1b[<0;{col+1};{row+1}m'.encode()); pump(.2)
            os.write(master,b'AFTER_RESET'); pump(.2); os.write(master,b'\r')
            wait_for('SIDE_REPLY_6')
            release_side.set(); view = pump(1)
            assert 'SIDE_REPLY_5' not in view, 'late answer reappeared after reset'
            last = [r for r in requests if r['side']][-1]
            assert 'SLOW_SIDE' not in json.dumps(last['body'])
            (root/'concurrent-reset.txt').write_text(view)
        command('/btw settings')
        wait_for('Side chat settings')
        (root/'settings.txt').write_text(pump())
        if fullscreen:
            select_option('Model: Main session', 1)
            select_option('Thinking effort: Default', 3)
            select_option('Reply style: Default', 1)
            select_option('Output budget: Default', 3)
            click_text('Back to chat')
            command('/btw CONFIGURED_QUESTION')
            wait_for('SIDE_REPLY_7')
            configured = [r for r in requests if r['side']][-1]['body']
            assert 'opus' in configured['model'], configured['model']
            assert configured['max_tokens'] >= 8192
            assert configured['output_config']['effort'] == 'high'
            context = json.dumps(configured['messages'])
            assert all(text in context for text in ['Initial fixture prompt','MAIN_REPLY_3','AFTER_RESET','CONFIGURED_QUESTION','Keep the reply short'])
            (root/'configured.txt').write_text(pump())
            command('Main after side settings')
            wait_for('MAIN_REPLY_4')
            assert [r for r in requests if r['main']][-1]['body']['model'] == 'claude-sonnet-4-6'
            command('/reload-plugins'); pump(2)
            command('/btw settings')
            view = wait_for('Model: Opus')
            assert all(text in view for text in ['Thinking effort: high','Reply style: concise','Output budget: 8192'])
            (root/'settings-reloaded.txt').write_text(view)
        return {'settings_panel':True,'saved_model_effort_style_cap':fullscreen,'concurrent_main':fullscreen,'reset_button_during_reply':fullscreen,'input_follow_up':fullscreen,'layout':mode,'fresh_context':True,'follow_up_history':True,'reset':True,'main_context_untouched':True,'paid_api_requests':False}
    finally:
        release_main.set(); release_side.set()
        (root/'requests.json').write_text(json.dumps(requests, indent=2))
        (root/'terminal.log').write_bytes(raw)
        os.close(master)
        if proc.poll() is None:
            proc.terminate()
            try: proc.wait(timeout=2)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=3)
        server.shutdown(); server.server_close()

print('Artifacts:',ROOT,flush=True)
results=[]
for mode in [False,True]:
    result=check(mode);results.append(result);print(json.dumps(result),flush=True)
(ROOT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
