"""Offline PTY check of the host's collapsed hint; requires pyte."""
import codecs
import fcntl
import http.server
import json
import os
from pathlib import Path
import pty
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import threading
import time

PLUGIN = Path(__file__).resolve().parents[1]
PLUGINS = Path(os.environ.get('CLAUDE_MODS_DIR', str(PLUGIN.parent)))
ROOT = Path(tempfile.mkdtemp(prefix='plugin-h-terminal-')).resolve()


def check(fullscreen):
    root = ROOT / ('fullscreen' if fullscreen else 'classic')
    config, project = root / 'config', root / 'project'
    config.mkdir(parents=True)
    project.mkdir()
    (config / '.claude.json').write_text(json.dumps({
        'hasCompletedOnboarding': True, 'lastOnboardingVersion': '2.1.295',
        'theme': 'dark', 'projects': {str(project): {'hasTrustDialogAccepted': True}},
    }))
    (config / 'settings.json').write_text(json.dumps({'skipDangerousModePermissionPrompt': True}))
    requests = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            requests.append(self.path)
            self.send_response(503)
            self.end_headers()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = os.environ.copy()
    for key in ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDECODE', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']:
        env.pop(key, None)
    env.update(CLAUDE_CONFIG_DIR=str(config), ANTHROPIC_AUTH_TOKEN='offline-fixture',
               ANTHROPIC_BASE_URL=f'http://127.0.0.1:{server.server_port}',
               CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1', DISABLE_AUTOUPDATER='1',
               TERM='xterm-256color', CLAUDE_CODE_NO_FLICKER='1' if fullscreen else '0',
               CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1')

    def launch():
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
        args = [shutil.which('claude'), '--plugin-dir', str(PLUGIN)]
        for plugin in ['compact-tools', 'live-thinking', 'sidebar-controls', 'claude-buddy']:
            args += ['--plugin-dir', str(PLUGINS / plugin)]
        args += ['--dangerously-skip-permissions', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--debug-file', str(root / 'debug.log')]
        proc = subprocess.Popen(args, cwd=project, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        return proc, master

    import pyte
    proc, master = launch()
    screen = pyte.Screen(160, 50)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder('utf-8')('replace')

    def pump(seconds=.3):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if select.select([master], [], [], .05)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                stream.feed(decoder.decode(chunk))
                if b'\x1b[6n' in chunk:
                    os.write(master, b'\x1b[1;1R')
        view = '\n'.join(screen.display)
        (root / 'screen.txt').write_text(view)
        return view

    def wait_for(text):
        choices = (text,) if isinstance(text, str) else text
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            view = pump()
            if any(choice in view for choice in choices):
                return view
            if proc.poll() is not None:
                break
        raise AssertionError(f'Missing {text!r}: {root}')

    def command(text):
        os.write(master, b'\x1b')
        pump()
        os.write(master, text.encode())
        pump()
        os.write(master, b'\r')
        pump(1)

    def stop():
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)
        os.close(master)

    try:
        wait_for('Compact tools: ON')
        # Close controls to populate the actual bottom strip in both layouts.
        command('/sidebar-controls off')
        wait_for('Compact tools: ON')
        command('/buddy')
        wait_for('Ask about this session')
        os.write(master, b'\x1b')
        pump()
        os.write(master, b'\x18\x01')
        wait_for('plugin panel hidden')
        (root / 'collapsed.txt').write_text(pump())
        command('/plugin-h')
        wait_for('Bottom plugin strip hidden.')
        view = pump()
        assert 'plugin panel hidden' not in view, view
        assert 'Compact tools: ON' not in view, view
        assert 'Ask about this session' in view, 'Buddy disappeared'
        (root / 'hidden.txt').write_text(view)
        # Hidden means even the native expand shortcut cannot restore the strip.
        os.write(master, b'\x18\x01')
        assert 'plugin panel hidden' not in pump()
        command('/plugin-h')
        view = wait_for(('plugin panel hidden', 'Compact tools: ON'))
        if 'plugin panel hidden' in view:
            os.write(master, b'\x18\x01')
        wait_for('Compact tools: ON')
        (root / 'restored.txt').write_text(pump())
        command('/plugin-h hide')
        assert 'Compact tools: ON' not in pump()
        command('/plugin-h show')
        wait_for('Compact tools: ON')
        command('/plugin-h hide')
        # Fresh process, same configuration: the strip stays completely hidden.
        stop()
        screen.reset()
        proc, master = launch()
        wait_for('Compact tools: ON')
        command('/sidebar-controls off')
        command('/buddy')
        wait_for('Ask about this session')
        view = pump()
        assert 'Compact tools: ON' not in view and 'plugin panel hidden' not in view, view
        command('/plugin-h show')
        wait_for('Compact tools: ON')
        assert not requests, f'Unexpected model requests: {requests}'
        print(f'{root.name}: collapsed hint removed, toggle restored, Buddy preserved, preference survived restart; zero model requests')
    finally:
        stop()
        server.shutdown()


try:
    check(False)
    check(True)
finally:
    print(f'Artifacts: {ROOT}')
