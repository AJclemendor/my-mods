"""Offline terminal integration checks. Requires pyte and Claude Code on PATH."""
import argparse, codecs, fcntl, http.server, json, os, pathlib, pty, select, shutil, signal, struct, subprocess, tempfile, termios, threading, time
import pyte
ROOT = pathlib.Path(tempfile.mkdtemp(prefix='buddy-terminal-check-')).resolve()
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
    summary_count = 0; chat_count = 0; show_flag = False
    side_started = threading.Event(); release_side = threading.Event()
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            nonlocal main_count, side_count, summary_count, chat_count
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
            if '/messages' not in self.path or 'count_tokens' in self.path:
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"input_tokens":100}'); return
            content = json.dumps(body.get('messages', []))
            side = 'You are Claude Buddy, a read-only companion' in content
            summary = side and 'Return only JSON' in content
            main = bool(body.get('tools')) and not side
            if side:
                side_count += 1
                if summary: summary_count += 1
                else: chat_count += 1
            elif main: main_count += 1
            flags = [{'key':'fixture-check','kind':'attention','text':'The failed check is holding up the fixture.','evidence':'BUDDY_CHECK_FAILED'}] if show_flag else []
            text = json.dumps({'summary':'Claude ran a check; it failed and is being investigated.','log':None,'flags':flags,'resolved':[]}) if summary else f'BUDDY_ANSWER_{chat_count}' if side else f'MAIN_REPLY_{main_count}' if main else 'Fixture title'
            requests.append({'side':side,'summary':summary,'main':main,'body':body,'reply':text})
            if main and main_count == 2:
                main_started.set(); release_main.wait(60)
            if side and not summary and 'SLOW_QUESTION' in content and not release_side.is_set():
                side_started.set(); release_side.wait(30)
            if not body.get('stream'):
                response = {'id':'msg_fixture','type':'message','role':'assistant','model':'claude-sonnet-4-6','content':[{'type':'text','text':text}],'stop_reason':'end_turn','usage':{'input_tokens':100,'output_tokens':10}}
                self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(json.dumps(response).encode()); return
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            def send(event):
                self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode()); self.wfile.flush()
            send({'type':'message_start','message':{'id':'msg_fixture_'+str(len(requests)),'type':'message','role':'assistant','model':'claude-sonnet-4-6','content':[],'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':100,'output_tokens':0}}})
            if main and (main_count == 1 or (main_count == 3 and 'Quiet failing check' in content)):
                marker = 'BUDDY_CHECK_FAILED' if main_count == 1 else 'BUDDY_QUIET_FAILURE'
                send({'type':'content_block_start','index':0,'content_block':{'type':'tool_use','id':f'buddy_failure_{main_count}','name':'Bash','input':{}}})
                send({'type':'content_block_delta','index':0,'delta':{'type':'input_json_delta','partial_json':json.dumps({'command':f"printf '{marker}\\n' >&2; exit 2",'description':'Run the fixture check'})}})
                send({'type':'content_block_stop','index':0})
                send({'type':'message_delta','delta':{'stop_reason':'tool_use','stop_sequence':None},'usage':{'output_tokens':20}})
                send({'type':'message_stop'}); return
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
    for plugin in ['compact-tools','live-thinking','sidebar-controls','claude-buddy']:
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
    try:
        wait_for('Exit code 2')
        if not fullscreen:
            wait_for('PAUSED')
            command('/buddy update')
            wait_for('Max is paused')
            assert side_count == 0, 'the inline layout started Buddy requests'
            return {'layout':mode, 'inline_pauses_buddy':True, 'paid_api_requests':False}
        os.write(master,b'/buddy'); pump(.2); os.write(master,b'\r'); pump(.4)
        wait_for('Chat only')
        command('/buddy settings')
        click_text('Companion')
        wait_for('✓ Companion')
        click_text('Back to Buddy')
        click_text('Max')
        wait_for('Claude ran a check;')
        assert 'Tool failed' not in pump(), 'a tool error became a flag; the transcript already shows those'
        assert main_started.is_set() and not release_main.is_set(), 'Buddy blocked the main tool loop'
        assert any('BUDDY_CHECK_FAILED' in json.dumps(r['body']) for r in requests if r['summary']), 'summary missed the latest tool result'
        initial_summaries = summary_count
        pump(2)
        assert summary_count == initial_summaries, 'Buddy generated a feedback loop without new activity'
        (root/'watching.txt').write_text(pump())
        os.write(master,b'\x1b'); pump(.3)
        os.write(master,b'/buddy SIDE_QUESTION_ONE'); pump(.2); os.write(master,b'\r')
        wait_for('BUDDY_ANSWER_1')
        chat1 = [r for r in requests if r['side'] and not r['summary']][-1]
        assert 'BUDDY_CHECK_FAILED' in json.dumps(chat1['body'])
        if fullscreen:
            click_text('Max')
            wait_for('Nothing needs your attention')
            assert 'No summaries yet.' not in pump(), 'Log remains in Max'
            click_text('Log')
            wait_for('No summaries yet.')
            show_flag = True
            command('/buddy update')
            click_text('Max')
            wait_for('Copy to clipboard')
            view = wait_for('update now')
            assert view.index('The failed check is holding up') < view.index('update now'), 'Max did not show Flags, then Now'
            assert 'No summaries yet.' not in view, 'Log remains in Max'
            (root/'flags.txt').write_text(view)
            click_text('[ Good ]')
            view = wait_for('Nothing needs your attention')
            assert 'Save feedback' not in view and 'What was useful?' not in view, 'rating opened an editor instead of dismissing the flag'
            command('/buddy settings')
            click_text('Saved feedback & prompt')
            wait_for('Saved feedback (1)')
            click_text('[ Edit ]')
            wait_for('What was useful?')
            os.write(master, b'Useful when a failed check actually blocks progress.'); pump(.3)
            os.write(master, b'\r')
            wait_for('Note: Useful when a failed check')
            (root/'feedback.txt').write_text(pump())
            click_text('Back to Settings')
            click_text('Back to Buddy')
            click_text('Max')
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH',50,100,0,0))
            screen.resize(lines=50, columns=100); os.kill(proc.pid, signal.SIGWINCH)
            wait_for('PAUSED')
            paused_calls = side_count
            pump(2)
            assert side_count == paused_calls, 'a narrow terminal kept reviewing'
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH',50,160,0,0))
            screen.resize(lines=50, columns=160); os.kill(proc.pid, signal.SIGWINCH)
            wait_for('Nothing needs your attention')
            (root/'resumed.txt').write_text(pump())
            click_text('Chat')
            wait_for('BUDDY_ANSWER_1')
            click_text('Ask about this session')
            os.write(master,b'SIDE_FOLLOW_UP'); pump(.2); os.write(master,b'\r')
            wait_for('BUDDY_ANSWER_2')
            (root/'chat.txt').write_text(pump())
            chat2 = [r for r in requests if r['side'] and not r['summary']][-1]
            assert all(text in json.dumps(chat2['body']) for text in ['SIDE_QUESTION_ONE','BUDDY_ANSWER_1','SIDE_FOLLOW_UP'])
        release_main.set(); wait_for('MAIN_REPLY_2')
        pump(2)
        assert all('SIDE_QUESTION_ONE' not in json.dumps(r['body']) for r in requests if r['main']), 'Buddy polluted the main conversation'
        command('/buddy settings')
        wait_for('Selected model:')
        if fullscreen:
            click_text('Fable 5.1')
            wait_for('Selected model: claude-fable-5-1')
            click_text('Opus 5.5')
            wait_for('Selected model: claude-opus-5-5')
            (root/'model-picker.txt').write_text(pump())
            click_text('[ high ]')
            click_text('[ 60 sec ]')
            click_text('[ detailed ]')
            wait_for('✓ high')
            wait_for('✓ 60 sec')
            wait_for('✓ detailed')
            (root/'clickable-settings.txt').write_text(pump())
            click_text('[ Off ]')
            wait_for('✓ Off')
            click_text('Back to Buddy')
            click_text('Max')
            view = wait_for('check flags')
            assert 'No summaries yet.' not in view and 'Last 1 summary' not in view, 'disabled activity still shows Log'
            (root/'activity-off.txt').write_text(view)
            next_answer = chat_count + 1
            command('/buddy CUSTOM_MODEL_QUESTION')
            wait_for(f'BUDDY_ANSWER_{next_answer}')
            custom = [r for r in requests if r['side'] and not r['summary']][-1]['body']
            assert 'opus' in custom['model']
            assert 'at most fourteen short lines' in json.dumps(custom), 'reply style click did not apply'
            assert 'BUDDY_CHECK_FAILED' in json.dumps(custom['messages'])
            assert 'Initial fixture prompt' in json.dumps(custom['messages'])
            assert custom.get('system'), 'custom model lost session instructions'
            command('/reload-plugins'); pump(2)
            command('/buddy update')
            wait_for('Nothing needs your attention')
            last_review = [r for r in requests if r['summary']][-1]['body']
            assert 'Useful when a failed check actually blocks progress.' in json.dumps(last_review), 'saved feedback was not included after reload'
            (root/'feedback-reloaded.txt').write_text(pump())
            command('/buddy settings')
            click_text('Saved feedback & prompt')
            wait_for('Saved feedback (1)')
            wait_for('Note: Useful when a failed check')
            (root/'saved-feedback.txt').write_text(pump())
            click_text('View prompt')
            wait_for('Review instructions & saved guidance')
            (root/'prompt-view.txt').write_text(pump())
            click_text('Back to saved feedback')
            click_text('Back to Settings')
            wait_for('Selected model: claude-opus-5-5')
            wait_for('✓ high')
            wait_for('✓ 60 sec')
            wait_for('✓ detailed')
            wait_for('✓ Off')
            (root/'settings-reloaded.txt').write_text(pump())
            click_text('Chat only (BTW)')
            wait_for('✓ Chat only (BTW)')
            click_text('Back to Buddy')
            wait_for('Chat only · replies when you ask')
            calls_before = side_count
            command('Quiet failing check')
            wait_for('MAIN_REPLY_4'); pump(2)
            assert side_count == calls_before, 'chat-only mode sent an unsolicited request'
            next_answer = chat_count + 1
            command('/btw QUESTION_IN_CHAT_ONLY')
            wait_for(f'BUDDY_ANSWER_{next_answer}')
            quiet = [r for r in requests if r['side'] and not r['summary']][-1]['body']
            assert 'BUDDY_QUIET_FAILURE' in json.dumps(quiet['messages']), 'chat-only question missed fresh context'
            (root/'chat-only.txt').write_text(pump())
            click_text('Ask about this session')
            os.write(master,b'SLOW_QUESTION'); pump(.2); os.write(master,b'\r')
            assert side_started.wait(20), 'the typed question was not sent'
            view = pump(.5)
            assert 'thinking' in view, 'no pending echo for the typed question'
            assert 'Ask about this session' in view, 'the input kept the sent text while the reply was pending'
            os.write(master,b'QUEUED_QUESTION'); pump(.2); os.write(master,b'\r')
            view = pump(.5)
            assert 'queued' in view, 'a question typed during a pending reply was not queued'
            assert 'Ask about this session' in view, 'the input kept the queued text'
            (root/'chat-queued.txt').write_text(view)
            release_side.set()
            wait_for(f'BUDDY_ANSWER_{chat_count + 1}')
            view = pump(.5)
            assert 'queued' not in view and 'thinking' not in view, 'the queue did not drain'
            (root/'chat-drained.txt').write_text(view)
            command('/reload-plugins'); pump(2)
            command('/buddy settings')
            wait_for('✓ Chat only (BTW)')
            (root/'chat-mode-reloaded.txt').write_text(pump())
        command('/claude-buddy off')
        pump(.5)
        calls_before = side_count
        next_main = main_count + 1
        os.write(master,b'Main after Buddy is off'); pump(.2); os.write(master,b'\r')
        wait_for(f'MAIN_REPLY_{next_main}'); pump(2)
        assert side_count == calls_before, 'Buddy continued making requests while off'
        return {'layout':mode,'automatic_summaries':True,'immediate_tool_error':True,'no_feedback_loop':True,'concurrent_chat':True,'main_context_untouched':True,'off_stops_requests':True,'model_picker_and_reload':fullscreen,'chat_only_and_reload':fullscreen,'paid_api_requests':False}
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

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--layout', choices=['classic', 'fullscreen', 'both'], default='both')
layout = parser.parse_args().layout
print('Artifacts:',ROOT,flush=True)
results=[]
for mode in ([False,True] if layout == 'both' else [layout == 'fullscreen']):
    result=check(mode);results.append(result);print(json.dumps(result),flush=True)
(ROOT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
