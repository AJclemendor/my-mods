"""Offline fullscreen check that Prev chat and Next chat jump between prompts. Requires pyte and Claude Code on PATH."""
import codecs, fcntl, http.server, json, os, pathlib, pty, select, shutil, struct, subprocess, tempfile, termios, threading, time
import pyte

ROOT = pathlib.Path(tempfile.mkdtemp(prefix='prompt-nav-terminal-')).resolve()
PLUGIN = pathlib.Path(__file__).resolve().parents[1]
PLUGINS = pathlib.Path(os.environ.get('CLAUDE_MODS_DIR', str(PLUGIN.parent)))
CLI = shutil.which('claude')
if CLI is None:
    raise SystemExit('Claude Code must be on PATH')
ROWS, COLS = 40, 160


def reply_text(prompt):
    # Long enough that each prompt scrolls well off the screen.
    return '\n\n'.join(f'{prompt} reply line {i}' for i in range(1, 41))


def check():
    root = ROOT / 'fullscreen'
    config, project = root / 'config', root / 'project'
    config.mkdir(parents=True); project.mkdir()
    (config / '.claude.json').write_text(json.dumps({'hasCompletedOnboarding': True, 'lastOnboardingVersion': '2.1.296', 'theme': 'dark', 'projects': {str(project): {'hasTrustDialogAccepted': True}}}))
    (config / 'settings.json').write_text(json.dumps({'skipDangerousModePermissionPrompt': True}))

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
            if '/messages' not in self.path or 'count_tokens' in self.path:
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"input_tokens":100}'); return
            content = json.dumps(body.get('messages', []))
            prompt = next((p for p in ['PROMPT_THREE', 'PROMPT_TWO', 'PROMPT_ONE'] if p in content), None)
            text = reply_text(prompt) if body.get('tools') and prompt else 'Fixture title'
            if 'Return only JSON' in content:
                text = json.dumps({'summary': 'Claude finished the three requested replies.', 'flags': [], 'resolved': []})
            if not body.get('stream'):
                response = {'id': 'msg_fixture', 'type': 'message', 'role': 'assistant', 'model': 'claude-sonnet-4-6', 'content': [{'type': 'text', 'text': text}], 'stop_reason': 'end_turn', 'usage': {'input_tokens': 100, 'output_tokens': 10}}
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(response).encode()); return
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            def send(event):
                self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode()); self.wfile.flush()
            send({'type': 'message_start', 'message': {'id': 'msg_fixture', 'type': 'message', 'role': 'assistant', 'model': 'claude-sonnet-4-6', 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 100, 'output_tokens': 0}}})
            send({'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})
            send({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text}})
            send({'type': 'content_block_stop', 'index': 0})
            send({'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': 10}})
            send({'type': 'message_stop'})

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler); server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = os.environ.copy()
    for key in ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDECODE', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']:
        env.pop(key, None)
    env.update(CLAUDE_CONFIG_DIR=str(config), ANTHROPIC_AUTH_TOKEN='offline-fixture', ANTHROPIC_BASE_URL=f'http://127.0.0.1:{server.server_port}',
               CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1', DISABLE_AUTOUPDATER='1', TERM='xterm-256color', CLAUDE_CODE_NO_FLICKER='1', CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1')
    master, slave = pty.openpty(); fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    args = [CLI]
    for plugin in ['compact-tools', 'live-thinking', 'sidebar-controls', 'claude-buddy', 'prompt-nav']:
        args += ['--plugin-dir', str(PLUGINS / plugin)]
    args += ['--dangerously-skip-permissions', '--model', 'claude-sonnet-4-6', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--debug-file', str(root / 'debug.log')]
    proc = subprocess.Popen(args, cwd=project, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True); os.close(slave)
    screen = pyte.Screen(COLS, ROWS); stream = pyte.Stream(screen); decoder = codecs.getincrementaldecoder('utf-8')('replace')

    def pump(seconds=.2):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if select.select([master], [], [], .05)[0]:
                try: chunk = os.read(master, 65536)
                except OSError: break
                stream.feed(decoder.decode(chunk))
                if b'\x1b[6n' in chunk: os.write(master, b'\x1b[1;1R')
        view = '\n'.join(screen.display); (root / 'screen.txt').write_text(view); return view

    def wait_for(needle, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            view = pump()
            if needle in view: return view
            if proc.poll() is not None: break
        raise AssertionError(f'missing {needle!r}; see {root}')

    def send(text):
        os.write(master, text.encode()); pump(.2); os.write(master, b'\r'); pump(.3)

    def click(glyph):
        wait_for(glyph)
        row = next(i for i, line in enumerate(screen.display) if glyph in line)
        col = screen.display[row].index(glyph)
        os.write(master, f'\x1b[<0;{col + 1};{row + 1}M\x1b[<0;{col + 1};{row + 1}m'.encode()); pump(1)

    def prompt_row(name):
        # The rendered prompt row, not a reply line that quotes the name.
        return next((i for i, line in enumerate(screen.display) if name in line and 'reply line' not in line), None)

    def landed(name, label):
        view = pump(.5)
        (root / f'{label}.txt').write_text(view)
        row = prompt_row(name)
        assert row is not None and row < 6, f'{label}: {name} is not at the top (row {row}); see {root / (label + ".txt")}'
        return row

    try:
        wait_for('Mod control')
        click('Mod control')
        wait_for('Compact tools: ON')
        wait_for('Prev chat')
        for i, name in enumerate(['PROMPT_ONE', 'PROMPT_TWO', 'PROMPT_THREE']):
            send(name)
            wait_for(f'{name} reply line 40')
            pump(.5)
        pump(1)
        (root / 'start.txt').write_text(pump())
        click('Next chat')
        assert 'PROMPT_THREE reply line 40' in pump() and prompt_row('PROMPT_THREE') is None, 'Next chat moved upward from the bottom'
        results = {'next_at_bottom': 'unchanged'}
        # The arrows hold the same top-right cell whichever pane tab is shown, and work from either.
        click('Mod control'); mod_tab = pump(.5); (root / 'tab-mod.txt').write_text(mod_tab)
        click('Prev chat'); results['up_1'] = landed('PROMPT_THREE', 'up-1')
        click('Claude Budd'); buddy_tab = pump(.5); (root / 'tab-buddy.txt').write_text(buddy_tab)
        spot = lambda view: next((i, line.index('Prev chat')) for i, line in enumerate(view.split('\n')) if 'Prev chat' in line)
        assert spot(mod_tab) == spot(buddy_tab), f'the arrows moved between tabs; see {root}'
        click('Prev chat'); results['up_2_from_buddy_tab'] = landed('PROMPT_TWO', 'up-2')
        click('Prev chat'); results['up_3'] = landed('PROMPT_ONE', 'up-3')
        click('Next chat'); results['down_1'] = landed('PROMPT_TWO', 'down-1')
        click('Next chat'); results['down_2'] = landed('PROMPT_THREE', 'down-2')
        # Focus Buddy's input, then switch its internal tabs. The navigation row
        # and composer must fit together, including after auto-scroll to input.
        os.write(master, b'\x1b'); pump(.3)
        send('/buddy')
        view = wait_for('Ask about this session')
        assert 'Prev chat' in view and 'Next chat' in view, 'navigation disappeared when Buddy received focus'
        (root / 'buddy-focused.txt').write_text(view)
        click('Settings'); click('Companion'); click('Back to Buddy')
        click('Max')
        view = wait_for('Ask about this session')
        assert 'Prev chat' in view and 'Next chat' in view, 'navigation disappeared on Max'
        (root / 'buddy-max.txt').write_text(view)
        click('Prev chat'); results['up_from_max_bottom'] = landed('PROMPT_THREE', 'up-max-bottom')
        click('Prev chat'); results['up_from_max'] = landed('PROMPT_TWO', 'up-max')
        click('Chat')
        view = wait_for('Ask about this session')
        assert 'Prev chat' in view and 'Next chat' in view, 'navigation disappeared on Chat'
        (root / 'buddy-chat.txt').write_text(view)
        click('Next chat'); results['down_from_chat'] = landed('PROMPT_THREE', 'down-chat')
        return {'layout': 'fullscreen', **{k: f'row {v}' for k, v in results.items()}, 'paid_api_requests': False}
    finally:
        os.close(master)
        if proc.poll() is None:
            proc.terminate()
            try: proc.wait(timeout=2)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=3)
        server.shutdown(); server.server_close()


print('Artifacts:', ROOT, flush=True)
print(json.dumps(check()), flush=True)
