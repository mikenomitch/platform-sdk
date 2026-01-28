// State
let files = {};
let currentFile = null;

// DOM
const editor = document.getElementById('editor');
const tabs = document.getElementById('tabs');
const output = document.getElementById('output');
const status = document.getElementById('status');
const runBtn = document.getElementById('runBtn');
const examples = document.getElementById('examples');
const addFileBtn = document.getElementById('addFile');
const addFileModal = document.getElementById('addFileModal');
const newFileName = document.getElementById('newFileName');
const cancelAdd = document.getElementById('cancelAdd');
const confirmAdd = document.getElementById('confirmAdd');
const bundleOpt = document.getElementById('bundleOpt');
const minifyOpt = document.getElementById('minifyOpt');

// Examples
const EXAMPLES = {
  hello: {
    'src/index.ts': `export default {
  fetch(request: Request): Response {
    return new Response('Hello from Platforms SDK!');
  }
}`,
    'package.json': JSON.stringify({ name: 'hello-worker', main: 'src/index.ts' }, null, 2),
  },

  api: {
    'src/index.ts': `export default {
  fetch(request: Request): Response {
    const data = {
      message: 'Hello from the API!',
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
    };

    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}`,
    'package.json': JSON.stringify({ name: 'api-worker', main: 'src/index.ts' }, null, 2),
  },

  router: {
    'src/index.ts': `import { handleUsers } from './routes/users';
import { handleHealth } from './routes/health';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    switch (url.pathname) {
      case '/':
        return new Response('Welcome to the API');
      case '/health':
        return handleHealth();
      case '/users':
        return handleUsers(request);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }
}`,
    'src/routes/users.ts': `const users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

export function handleUsers(request: Request): Response {
  return new Response(JSON.stringify({ users }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}`,
    'src/routes/health.ts': `export function handleHealth(): Response {
  return new Response(JSON.stringify({
    status: 'healthy',
    uptime: process.uptime?.() ?? 0,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}`,
    'package.json': JSON.stringify({ name: 'router-worker', main: 'src/index.ts' }, null, 2),
  },

  env: {
    'src/index.ts': `interface Env {
  API_KEY: string;
  DEBUG: string;
}

export default {
  fetch(request: Request, env: Env): Response {
    // Access environment variables passed to the worker
    const info = {
      hasApiKey: !!env.API_KEY,
      keyPreview: env.API_KEY?.slice(0, 8) + '...',
      debugMode: env.DEBUG === 'true',
    };

    console.log('Environment info:', info);

    return new Response(JSON.stringify(info, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}`,
    'package.json': JSON.stringify({ name: 'env-worker', main: 'src/index.ts' }, null, 2),
  },

  hono: {
    'src/index.ts': `import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', cors());

app.get('/', (c) => c.text('Hello from Hono!'));

app.get('/json', (c) => c.json({ 
  framework: 'Hono',
  message: 'Running on Dynamic Workers!',
}));

app.get('/users/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ user: { id, name: 'User ' + id } });
});

export default app;`,
    'package.json': JSON.stringify({
      name: 'hono-worker',
      main: 'src/index.ts',
      dependencies: {
        hono: '^4.0.0',
      },
    }, null, 2),
  },
};

// Initialize
loadExample('hello');

// Event Listeners
examples.addEventListener('change', (e) => {
  if (e.target.value) {
    loadExample(e.target.value);
    e.target.value = '';
  }
});

editor.addEventListener('input', () => {
  if (currentFile) files[currentFile] = editor.value;
});

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
    if (currentFile) files[currentFile] = editor.value;
  }
});

runBtn.addEventListener('click', runWorker);

addFileBtn.addEventListener('click', () => {
  addFileModal.classList.remove('hidden');
  newFileName.value = '';
  newFileName.focus();
});

cancelAdd.addEventListener('click', () => addFileModal.classList.add('hidden'));
confirmAdd.addEventListener('click', addFile);
newFileName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addFile();
  if (e.key === 'Escape') addFileModal.classList.add('hidden');
});

// Functions
function loadExample(name) {
  files = { ...EXAMPLES[name] };
  renderTabs();
  selectFile(Object.keys(files)[0]);
}

function renderTabs() {
  tabs.innerHTML = '';
  Object.keys(files).forEach((name) => {
    const tab = document.createElement('button');
    tab.className = `tab${name === currentFile ? ' active' : ''}`;
    const canDelete = name !== 'package.json';
    tab.innerHTML = name + (canDelete ? `<span class="close" data-file="${name}">&times;</span>` : '');
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('close')) {
        deleteFile(e.target.dataset.file);
      } else {
        selectFile(name);
      }
    });
    tabs.appendChild(tab);
  });
}

function selectFile(name) {
  currentFile = name;
  editor.value = files[name] || '';
  renderTabs();
}

function addFile() {
  const name = newFileName.value.trim();
  if (!name || files[name]) return;
  files[name] = name.endsWith('.json') ? '{}' : `// ${name}\n`;
  addFileModal.classList.add('hidden');
  renderTabs();
  selectFile(name);
}

function deleteFile(name) {
  if (Object.keys(files).length <= 1) return;
  delete files[name];
  if (currentFile === name) currentFile = Object.keys(files)[0];
  renderTabs();
  selectFile(currentFile);
}

async function runWorker() {
  setStatus('loading', 'Building...');
  runBtn.disabled = true;

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files,
        options: {
          bundle: bundleOpt.checked,
          minify: minifyOpt.checked,
        },
      }),
    });

    const result = await res.json();

    if (result.error) {
      setStatus('error', 'Build Error');
      showError(result.error, result.stack);
    } else if (result.workerError) {
      setStatus('error', 'Runtime Error');
      showResult(result);
    } else {
      setStatus('success', 'Success');
      showResult(result);
    }
  } catch (err) {
    setStatus('error', 'Error');
    showError(err.message);
  } finally {
    runBtn.disabled = false;
  }
}

function setStatus(type, text) {
  const dot = status.querySelector('.status-dot');
  const span = status.querySelector('span:last-child');
  dot.className = `status-dot ${type}`;
  span.textContent = text;
}

function showError(message, stack) {
  output.innerHTML = `
    <div class="output-section">
      <div class="output-label">Error</div>
      <div class="output-content error">${escapeHtml(message)}</div>
      ${stack ? `<div class="output-content error" style="margin-top:8px;opacity:0.7">${escapeHtml(stack)}</div>` : ''}
    </div>
  `;
}

function showResult(result) {
  const { buildInfo, response, workerError, timing } = result;

  let body = response.body;
  try {
    body = JSON.stringify(JSON.parse(response.body), null, 2);
  } catch {}

  const statusClass = response.status < 400 ? 'ok' : 'error';

  output.innerHTML = `
    ${workerError ? `
      <div class="output-section">
        <div class="output-label">Worker Error</div>
        <div class="output-content error">${escapeHtml(workerError.message)}</div>
        ${workerError.stack ? `<div class="output-content error" style="margin-top:8px;opacity:0.7">${escapeHtml(workerError.stack)}</div>` : ''}
      </div>
    ` : `
      <div class="output-section">
        <div class="output-label">Response</div>
        <div class="response-box">
          <div class="response-status ${statusClass}">HTTP ${response.status} | ${response.headers['content-type'] || 'text/plain'}</div>
          <div class="output-content ${statusClass}">${escapeHtml(body)}</div>
        </div>
      </div>
    `}

    <div class="output-section">
      <div class="output-label">Timing</div>
      <div class="timing-grid">
        <div class="timing-item">
          <div class="timing-value">${timing.buildTime}ms</div>
          <div class="timing-label">Build</div>
        </div>
        <div class="timing-item">
          <div class="timing-value">${timing.loadTime}ms</div>
          <div class="timing-label">Load</div>
        </div>
        <div class="timing-item">
          <div class="timing-value">${timing.runTime}ms</div>
          <div class="timing-label">Run</div>
        </div>
        <div class="timing-item">
          <div class="timing-value">${timing.total}ms</div>
          <div class="timing-label">Total</div>
        </div>
      </div>
    </div>

    <div class="output-section">
      <div class="output-label">Build Info</div>
      <div class="output-content">Entry: ${buildInfo.mainModule}</div>
      <div class="modules-list">
        ${buildInfo.modules.map(m => `<span class="module-badge">${m}</span>`).join('')}
      </div>
      ${buildInfo.warnings?.length ? `
        <div class="output-content warning" style="margin-top:8px">${buildInfo.warnings.join('\\n')}</div>
      ` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
