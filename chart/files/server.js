const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const CMD_API = process.env.CMD_API_URL || 'http://cmd-api.default.svc.cluster.local';
const SSH_HOST = process.env.SSH_HOST || '192.168.8.116';
const SSH_USER = process.env.SSH_USER || 'tim';
const SSH_PASS = process.env.SSH_PASS || '';
const CLAUDE_BIN = '/Users/tim/.local/bin/claude --dangerously-skip-permissions';
const TMUX = 'claude-ui';

let lastOutputHash = '';
let lastOutput = '';

// Parse JSON body
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// Send JSON response
function json(res, data) {
  const str = JSON.stringify(data);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(str);
}

// SSH command helper via cmd-api
async function ssh(cmd) {
  const fullCmd = `export PATH=/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH && ${cmd}`;
  try {
    const res = await fetch(`${CMD_API}/ssh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: SSH_HOST,
        username: SSH_USER,
        password: SSH_PASS,
        command: fullCmd,
        port: 22
      })
    });
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, stdout: data.stdout || '', stderr: data.stderr || '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h;
  }
  return h.toString(16);
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const method = req.method;

  // Health check
  if (method === 'GET' && pathname === '/health') {
    return json(res, { ok: true, api: CMD_API });
  }

  // Serve static index.html
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    } catch (e) {
      res.writeHead(500);
      return res.end('index.html not found');
    }
  }

  // GET /api/status
  if (method === 'GET' && pathname === '/api/status') {
    const result = await ssh(`tmux has-session -t ${TMUX} 2>/dev/null && echo ACTIVE || echo NONE`);
    return json(res, {
      connected: result.ok,
      session: result.ok ? result.stdout.trim() : 'ERROR',
      error: result.error || null
    });
  }

  // POST /api/new
  if (method === 'POST' && pathname === '/api/new') {
    console.log('[API] POST /api/new');
    await ssh(`tmux kill-session -t ${TMUX} 2>/dev/null || true`);
    const result = await ssh(`tmux new-session -d -s ${TMUX} -x 200 -y 50 && sleep 0.5 && tmux send-keys -t ${TMUX} '${CLAUDE_BIN}' Enter`);
    if (result.ok) {
      console.log('[API] New session started');
      return json(res, { ok: true, message: 'Session started' });
    } else {
      console.log('[API] Error:', result.error);
      return json(res, { ok: false, error: result.error });
    }
  }

  // POST /api/resume
  if (method === 'POST' && pathname === '/api/resume') {
    console.log('[API] POST /api/resume');
    await ssh(`tmux kill-session -t ${TMUX} 2>/dev/null || true`);
    const result = await ssh(`tmux new-session -d -s ${TMUX} -x 200 -y 50 && sleep 0.5 && tmux send-keys -t ${TMUX} '${CLAUDE_BIN} --resume' Enter`);
    if (result.ok) {
      console.log('[API] Resume session started');
      return json(res, { ok: true, message: 'Resume started' });
    } else {
      console.log('[API] Error:', result.error);
      return json(res, { ok: false, error: result.error });
    }
  }

  // POST /api/send
  if (method === 'POST' && pathname === '/api/send') {
    const body = await parseBody(req);
    const { text } = body;
    if (!text) return json(res, { ok: false, error: 'No text provided' });
    console.log('[API] POST /api/send:', text.substring(0, 50));
    const escaped = text.replace(/'/g, "'\\''");
    const result = await ssh(`tmux send-keys -t ${TMUX} '${escaped}' Enter`);
    return json(res, { ok: result.ok, error: result.error || null });
  }

  // POST /api/key
  if (method === 'POST' && pathname === '/api/key') {
    const body = await parseBody(req);
    const { key } = body;
    if (!key) return json(res, { ok: false, error: 'No key provided' });
    console.log('[API] POST /api/key:', key);
    const keyMap = {
      'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
      'enter': 'Enter', 'escape': 'Escape', 'esc': 'Escape',
      'tab': 'Tab', 'space': 'Space', 'backspace': 'BSpace',
      'delete': 'DC', 'ctrl-c': 'C-c', 'ctrl-d': 'C-d', 'ctrl-z': 'C-z',
      'home': 'Home', 'end': 'End', 'pageup': 'PPage', 'pagedown': 'NPage'
    };
    const tmuxKey = keyMap[key.toLowerCase()] || key;
    const result = await ssh(`tmux send-keys -t ${TMUX} ${tmuxKey}`);
    return json(res, { ok: result.ok, error: result.error || null });
  }

  // GET /api/output
  if (method === 'GET' && pathname === '/api/output') {
    const result = await ssh(`tmux capture-pane -t ${TMUX} -p -S -100`);
    if (!result.ok) return json(res, { ok: false, error: result.error, output: '', hash: '' });
    const output = result.stdout;
    const outputHash = hash(output);
    lastOutput = output;
    lastOutputHash = outputHash;
    return json(res, { ok: true, output, hash: outputHash });
  }

  // GET /api/poll
  if (method === 'GET' && pathname === '/api/poll') {
    const clientHash = parsed.searchParams.get('hash') || '';
    const maxWait = 10000;
    const checkInterval = 1000;
    const startTime = Date.now();
    console.log('[API] GET /api/poll hash:', clientHash);

    const check = async () => {
      const result = await ssh(`tmux capture-pane -t ${TMUX} -p -S -100`);
      if (!result.ok) return json(res, { ok: false, error: result.error, output: '', hash: '', changed: false });
      const output = result.stdout;
      const outputHash = hash(output);
      if (outputHash !== clientHash || !clientHash) {
        lastOutput = output;
        lastOutputHash = outputHash;
        console.log('[API] Poll: output changed');
        return json(res, { ok: true, output, hash: outputHash, changed: true });
      }
      if (Date.now() - startTime >= maxWait) {
        console.log('[API] Poll: timeout, no change');
        return json(res, { ok: true, output: '', hash: clientHash, changed: false });
      }
      setTimeout(check, checkInterval);
    };
    return check();
  }

  // POST /api/kill
  if (method === 'POST' && pathname === '/api/kill') {
    console.log('[API] POST /api/kill');
    await ssh(`tmux kill-session -t ${TMUX} 2>/dev/null || true`);
    return json(res, { ok: true });
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Web API v2.0 on port ${PORT}`);
  console.log(`CMD API: ${CMD_API}`);
  console.log(`SSH: ${SSH_USER}@${SSH_HOST}`);
});
