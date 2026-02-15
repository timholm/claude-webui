const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const CMD_API = process.env.CMD_API_URL || 'http://10.43.215.37';
const SSH_HOST = process.env.SSH_HOST || '192.168.8.116';
const SSH_USER = process.env.SSH_USER || 'tim';
const SSH_PASS = process.env.SSH_PASS || '';
const CLAUDE_BIN = '/Users/tim/.local/bin/claude --dangerously-skip-permissions';
const TMUX = 'claude-ui';

app.use(express.json());
app.use(express.static('public'));

// Store last output hash to detect changes
let lastOutputHash = '';
let lastOutput = '';

// SSH command helper
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

// Simple hash function
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h;
  }
  return h.toString(16);
}

// ============ API ENDPOINTS ============

// GET /api/status - Check connection and session status
app.get('/api/status', async (req, res) => {
  const result = await ssh(`tmux has-session -t ${TMUX} 2>/dev/null && echo ACTIVE || echo NONE`);
  res.json({
    connected: result.ok,
    session: result.ok ? result.stdout.trim() : 'ERROR',
    error: result.error || null
  });
});

// POST /api/new - Start new Claude session
app.post('/api/new', async (req, res) => {
  console.log('[API] POST /api/new');

  // Kill existing session
  await ssh(`tmux kill-session -t ${TMUX} 2>/dev/null || true`);

  // Create new session and run claude
  const result = await ssh(`tmux new-session -d -s ${TMUX} -x 200 -y 50 && sleep 0.5 && tmux send-keys -t ${TMUX} '${CLAUDE_BIN}' Enter`);

  if (result.ok) {
    console.log('[API] New session started');
    res.json({ ok: true, message: 'Session started' });
  } else {
    console.log('[API] Error:', result.error);
    res.json({ ok: false, error: result.error });
  }
});

// POST /api/resume - Start Claude with --resume
app.post('/api/resume', async (req, res) => {
  console.log('[API] POST /api/resume');

  // Kill existing session
  await ssh(`tmux kill-session -t ${TMUX} 2>/dev/null || true`);

  // Create new session and run claude --resume
  const result = await ssh(`tmux new-session -d -s ${TMUX} -x 200 -y 50 && sleep 0.5 && tmux send-keys -t ${TMUX} '${CLAUDE_BIN} --resume' Enter`);

  if (result.ok) {
    console.log('[API] Resume session started');
    res.json({ ok: true, message: 'Resume started' });
  } else {
    console.log('[API] Error:', result.error);
    res.json({ ok: false, error: result.error });
  }
});

// POST /api/send - Send text to Claude
app.post('/api/send', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ ok: false, error: 'No text provided' });

  console.log('[API] POST /api/send:', text.substring(0, 50));

  // Escape single quotes for shell
  const escaped = text.replace(/'/g, "'\\''");
  const result = await ssh(`tmux send-keys -t ${TMUX} '${escaped}' Enter`);

  res.json({ ok: result.ok, error: result.error || null });
});

// POST /api/key - Send special key
// Keys: up, down, left, right, enter, escape, tab, backspace, ctrl-c, ctrl-d
app.post('/api/key', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.json({ ok: false, error: 'No key provided' });

  console.log('[API] POST /api/key:', key);

  // Map friendly key names to tmux keys
  const keyMap = {
    'up': 'Up',
    'down': 'Down',
    'left': 'Left',
    'right': 'Right',
    'enter': 'Enter',
    'escape': 'Escape',
    'esc': 'Escape',
    'tab': 'Tab',
    'space': 'Space',
    'backspace': 'BSpace',
    'delete': 'DC',
    'ctrl-c': 'C-c',
    'ctrl-d': 'C-d',
    'ctrl-z': 'C-z',
    'home': 'Home',
    'end': 'End',
    'pageup': 'PPage',
    'pagedown': 'NPage'
  };

  const tmuxKey = keyMap[key.toLowerCase()] || key;
  const result = await ssh(`tmux send-keys -t ${TMUX} ${tmuxKey}`);

  res.json({ ok: result.ok, error: result.error || null });
});

// GET /api/output - Get current terminal output
app.get('/api/output', async (req, res) => {
  const result = await ssh(`tmux capture-pane -t ${TMUX} -p -S -100`);

  if (!result.ok) {
    return res.json({ ok: false, error: result.error, output: '', hash: '' });
  }

  const output = result.stdout;
  const outputHash = hash(output);

  // Update cache
  lastOutput = output;
  lastOutputHash = outputHash;

  res.json({ ok: true, output, hash: outputHash });
});

// GET /api/poll?hash=xxx - Long poll for changes (waits up to 10s)
app.get('/api/poll', async (req, res) => {
  const clientHash = req.query.hash || '';
  const maxWait = 10000; // 10 seconds max
  const checkInterval = 1000; // Check every 1 second
  const startTime = Date.now();

  console.log('[API] GET /api/poll hash:', clientHash);

  const check = async () => {
    const result = await ssh(`tmux capture-pane -t ${TMUX} -p -S -100`);

    if (!result.ok) {
      return res.json({ ok: false, error: result.error, output: '', hash: '', changed: false });
    }

    const output = result.stdout;
    const outputHash = hash(output);

    // If hash changed or no client hash provided, return immediately
    if (outputHash !== clientHash || !clientHash) {
      lastOutput = output;
      lastOutputHash = outputHash;
      console.log('[API] Poll: output changed');
      return res.json({ ok: true, output, hash: outputHash, changed: true });
    }

    // Check if we've waited long enough
    if (Date.now() - startTime >= maxWait) {
      console.log('[API] Poll: timeout, no change');
      return res.json({ ok: true, output: '', hash: clientHash, changed: false });
    }

    // Wait and check again
    setTimeout(check, checkInterval);
  };

  check();
});

// POST /api/kill - Kill session
app.post('/api/kill', async (req, res) => {
  console.log('[API] POST /api/kill');
  const result = await ssh(`tmux kill-session -t ${TMUX} 2>/dev/null || true`);
  res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, api: CMD_API });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Claude Web API v2.0 on port ${PORT}`);
    console.log(`CMD API: ${CMD_API}`);
    console.log(`SSH: ${SSH_USER}@${SSH_HOST}`);
  });
}

module.exports = { app, hash };
