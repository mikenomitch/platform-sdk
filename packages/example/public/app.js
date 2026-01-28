// State
let files = {};
let currentFile = null;
let selectedTenant = null;
let selectedWorker = null;
let platformDefaults = null;

// DOM Elements
const editor = document.getElementById('editor');
const tabs = document.getElementById('tabs');
const output = document.getElementById('output');
const status = document.getElementById('status');
const runBtn = document.getElementById('runBtn');
const saveWorkerBtn = document.getElementById('saveWorkerBtn');
const createWorkerBtn = document.getElementById('createWorkerBtn');
const examples = document.getElementById('examples');
const contextInfo = document.getElementById('contextInfo');

// Sidebar
const defaultsGrid = document.getElementById('defaultsGrid');
const tenantList = document.getElementById('tenantList');
const workerList = document.getElementById('workerList');
const workersSection = document.getElementById('workersSection');
const selectedTenantBadge = document.getElementById('selectedTenantBadge');

// Modals
const addFileModal = document.getElementById('addFileModal');
const addTenantModal = document.getElementById('addTenantModal');
const addWorkerModal = document.getElementById('addWorkerModal');
const tenantDetailModal = document.getElementById('tenantDetailModal');

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
  ENVIRONMENT: string;
}

export default {
  fetch(request: Request, env: Env): Response {
    // Access environment variables passed to the worker
    const info = {
      environment: env.ENVIRONMENT,
      hasApiKey: !!env.API_KEY,
      keyPreview: env.API_KEY ? env.API_KEY.slice(0, 8) + '...' : null,
      debugMode: env.DEBUG === 'true',
    };

    return new Response(JSON.stringify(info, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}`,
    'package.json': JSON.stringify({ name: 'env-worker', main: 'src/index.ts' }, null, 2),
  },
};

// Initialize
async function init() {
  loadExample('hello');
  await Promise.all([
    loadDefaults(),
    loadTenants(),
  ]);
  setupEventListeners();
}

function setupEventListeners() {
  // Examples
  examples.addEventListener('change', (e) => {
    if (e.target.value) {
      loadExample(e.target.value);
      e.target.value = '';
    }
  });

  // Editor
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

  // Run button
  runBtn.addEventListener('click', runWorker);

  // Save worker button
  saveWorkerBtn.addEventListener('click', saveWorker);

  // Create worker button (opens modal)
  createWorkerBtn.addEventListener('click', () => {
    if (!selectedTenant) return;
    addWorkerModal.classList.remove('hidden');
    document.getElementById('newWorkerId').value = '';
    document.getElementById('newWorkerId').focus();
  });

  // Add file modal
  document.getElementById('addFile').addEventListener('click', () => {
    addFileModal.classList.remove('hidden');
    document.getElementById('newFileName').value = '';
    document.getElementById('newFileName').focus();
  });
  document.getElementById('cancelAddFile').addEventListener('click', () => addFileModal.classList.add('hidden'));
  document.getElementById('confirmAddFile').addEventListener('click', addFile);
  document.getElementById('newFileName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFile();
    if (e.key === 'Escape') addFileModal.classList.add('hidden');
  });

  // Add tenant modal
  document.getElementById('addTenantBtn').addEventListener('click', () => {
    addTenantModal.classList.remove('hidden');
    document.getElementById('newTenantId').value = '';
    document.getElementById('newTenantEnv').value = '';
    document.getElementById('newTenantId').focus();
  });
  document.getElementById('cancelAddTenant').addEventListener('click', () => addTenantModal.classList.add('hidden'));
  document.getElementById('confirmAddTenant').addEventListener('click', createTenant);

  // Add worker modal
  document.getElementById('addWorkerBtn').addEventListener('click', () => {
    if (!selectedTenant) return;
    addWorkerModal.classList.remove('hidden');
    document.getElementById('newWorkerId').value = '';
    document.getElementById('newWorkerId').focus();
  });
  document.getElementById('cancelAddWorker').addEventListener('click', () => addWorkerModal.classList.add('hidden'));
  document.getElementById('confirmAddWorker').addEventListener('click', createWorker);

  // Tenant detail modal
  document.getElementById('closeTenantDetail').addEventListener('click', () => tenantDetailModal.classList.add('hidden'));
  document.getElementById('cancelTenantEdit').addEventListener('click', () => tenantDetailModal.classList.add('hidden'));
  document.getElementById('saveTenantBtn').addEventListener('click', saveTenant);
  document.getElementById('deleteTenantBtn').addEventListener('click', deleteTenant);

  // Section toggles
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.section-actions button')) return;
      const section = header.closest('.sidebar-section');
      section.classList.toggle('collapsed');
    });
  });
}

// API calls
async function loadDefaults() {
  try {
    const res = await fetch('/api/defaults');
    platformDefaults = await res.json();
    renderDefaults();
  } catch (err) {
    console.error('Failed to load defaults:', err);
  }
}

async function loadTenants() {
  try {
    const res = await fetch('/api/tenants');
    const data = await res.json();
    renderTenants(data.tenants || []);
  } catch (err) {
    console.error('Failed to load tenants:', err);
    tenantList.innerHTML = '<div class="error-state">Failed to load</div>';
  }
}

async function loadWorkers(tenantId) {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/workers`);
    const data = await res.json();
    renderWorkers(data.workers || []);
  } catch (err) {
    console.error('Failed to load workers:', err);
    workerList.innerHTML = '<div class="error-state">Failed to load</div>';
  }
}

async function createTenant() {
  const id = document.getElementById('newTenantId').value.trim();
  if (!id) return;

  let env = {};
  const envText = document.getElementById('newTenantEnv').value.trim();
  if (envText) {
    try {
      env = JSON.parse(envText);
    } catch {
      alert('Invalid JSON for environment variables');
      return;
    }
  }

  try {
    await fetch('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, env }),
    });
    addTenantModal.classList.add('hidden');
    await loadTenants();
    selectTenant(id);
  } catch (err) {
    alert('Failed to create tenant: ' + err.message);
  }
}

async function saveTenant() {
  const tenantId = document.getElementById('tenantDetailId').textContent;
  
  let env = {};
  const envText = document.getElementById('tenantEnvEditor').value.trim();
  if (envText) {
    try {
      env = JSON.parse(envText);
    } catch {
      alert('Invalid JSON for environment variables');
      return;
    }
  }

  const compatibilityDate = document.getElementById('tenantCompatDate').value.trim() || undefined;
  const flagsText = document.getElementById('tenantCompatFlags').value.trim();
  const compatibilityFlags = flagsText ? flagsText.split(',').map(f => f.trim()).filter(Boolean) : undefined;

  try {
    await fetch(`/api/tenants/${tenantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env, compatibilityDate, compatibilityFlags }),
    });
    tenantDetailModal.classList.add('hidden');
    await loadTenants();
  } catch (err) {
    alert('Failed to save tenant: ' + err.message);
  }
}

async function deleteTenant() {
  const tenantId = document.getElementById('tenantDetailId').textContent;
  if (!confirm(`Delete tenant "${tenantId}" and all its workers?`)) return;

  try {
    await fetch(`/api/tenants/${tenantId}`, { method: 'DELETE' });
    tenantDetailModal.classList.add('hidden');
    if (selectedTenant === tenantId) {
      selectedTenant = null;
      selectedWorker = null;
      workersSection.style.display = 'none';
      updateContext();
    }
    await loadTenants();
  } catch (err) {
    alert('Failed to delete tenant: ' + err.message);
  }
}

async function createWorker() {
  if (!selectedTenant) return;
  const id = document.getElementById('newWorkerId').value.trim();
  if (!id) return;

  try {
    await fetch(`/api/tenants/${selectedTenant}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, files }),
    });
    addWorkerModal.classList.add('hidden');
    await loadWorkers(selectedTenant);
    selectWorker(id);
  } catch (err) {
    alert('Failed to create worker: ' + err.message);
  }
}

async function saveWorker() {
  if (!selectedTenant || !selectedWorker) return;

  try {
    await fetch(`/api/tenants/${selectedTenant}/workers/${selectedWorker}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    setStatus('success', 'Saved');
    await loadWorkers(selectedTenant);
  } catch (err) {
    alert('Failed to save worker: ' + err.message);
  }
}

async function deleteWorker(tenantId, workerId) {
  if (!confirm(`Delete worker "${workerId}"?`)) return;

  try {
    await fetch(`/api/tenants/${tenantId}/workers/${workerId}`, { method: 'DELETE' });
    if (selectedWorker === workerId) {
      selectedWorker = null;
      saveWorkerBtn.style.display = 'none';
      createWorkerBtn.style.display = 'inline-flex';
      updateContext();
    }
    await loadWorkers(tenantId);
  } catch (err) {
    alert('Failed to delete worker: ' + err.message);
  }
}

// Rendering
function renderDefaults() {
  if (!platformDefaults) {
    defaultsGrid.innerHTML = '<div class="loading">Loading...</div>';
    return;
  }

  const envCount = Object.keys(platformDefaults.env || {}).length;
  const flagsCount = (platformDefaults.compatibilityFlags || []).length;
  const limits = platformDefaults.limits || {};

  defaultsGrid.innerHTML = `
    <div class="default-item">
      <span class="default-label">Compat Date</span>
      <span class="default-value">${platformDefaults.compatibilityDate || 'Not set'}</span>
    </div>
    <div class="default-item">
      <span class="default-label">Env Vars</span>
      <span class="default-value">${envCount} defined</span>
    </div>
    <div class="default-item">
      <span class="default-label">Flags</span>
      <span class="default-value">${flagsCount > 0 ? platformDefaults.compatibilityFlags.join(', ') : 'None'}</span>
    </div>
    <div class="default-item">
      <span class="default-label">CPU Limit</span>
      <span class="default-value">${limits.cpuMs ? limits.cpuMs + 'ms' : 'Default'}</span>
    </div>
    <div class="default-item">
      <span class="default-label">Subrequests</span>
      <span class="default-value">${limits.subrequests || 'Default'}</span>
    </div>
  `;
}

function renderTenants(tenants) {
  if (tenants.length === 0) {
    tenantList.innerHTML = '<div class="empty-state">No tenants yet</div>';
    return;
  }

  tenantList.innerHTML = tenants.map(t => `
    <div class="list-item ${selectedTenant === t.id ? 'selected' : ''}" data-tenant="${t.id}">
      <div class="list-item-content">
        <span class="list-item-name">${escapeHtml(t.id)}</span>
        <span class="list-item-meta">${formatDate(t.updatedAt)}</span>
      </div>
      <div class="list-item-actions">
        <button class="btn-icon-sm" data-action="edit" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  // Event listeners
  tenantList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="edit"]')) {
        openTenantDetail(item.dataset.tenant);
      } else {
        selectTenant(item.dataset.tenant);
      }
    });
  });
}

function renderWorkers(workers) {
  if (workers.length === 0) {
    workerList.innerHTML = '<div class="empty-state">No workers yet</div>';
    return;
  }

  workerList.innerHTML = workers.map(w => `
    <div class="list-item ${selectedWorker === w.id ? 'selected' : ''}" data-worker="${w.id}">
      <div class="list-item-content">
        <span class="list-item-name">${escapeHtml(w.id)}</span>
        <span class="list-item-meta">v${w.version} - ${formatDate(w.updatedAt)}</span>
      </div>
      <div class="list-item-actions">
        <button class="btn-icon-sm" data-action="delete" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  // Event listeners
  workerList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="delete"]')) {
        await deleteWorker(selectedTenant, item.dataset.worker);
      } else {
        await selectWorkerAndLoad(item.dataset.worker);
      }
    });
  });
}

async function openTenantDetail(tenantId) {
  try {
    const res = await fetch(`/api/tenants/${tenantId}`);
    const data = await res.json();
    
    document.getElementById('tenantDetailId').textContent = tenantId;
    document.getElementById('tenantEnvEditor').value = JSON.stringify(data.config?.env || {}, null, 2);
    document.getElementById('tenantCompatDate').value = data.config?.compatibilityDate || '';
    document.getElementById('tenantCompatFlags').value = (data.config?.compatibilityFlags || []).join(', ');
    
    tenantDetailModal.classList.remove('hidden');
  } catch (err) {
    alert('Failed to load tenant: ' + err.message);
  }
}

// Selection
function selectTenant(tenantId) {
  selectedTenant = tenantId;
  selectedWorker = null;
  selectedTenantBadge.textContent = tenantId;
  workersSection.style.display = 'block';
  saveWorkerBtn.style.display = 'none';
  createWorkerBtn.style.display = 'inline-flex';
  
  // Re-render tenants to update selection
  const items = tenantList.querySelectorAll('.list-item');
  items.forEach(item => {
    item.classList.toggle('selected', item.dataset.tenant === tenantId);
  });
  
  loadWorkers(tenantId);
  updateContext();
}

function selectWorker(workerId) {
  selectedWorker = workerId;
  saveWorkerBtn.style.display = 'inline-flex';
  createWorkerBtn.style.display = 'none';
  
  const items = workerList.querySelectorAll('.list-item');
  items.forEach(item => {
    item.classList.toggle('selected', item.dataset.worker === workerId);
  });
  
  updateContext();
}

async function selectWorkerAndLoad(workerId) {
  selectWorker(workerId);
  
  try {
    const res = await fetch(`/api/tenants/${selectedTenant}/workers/${workerId}`);
    const data = await res.json();
    if (data.config?.files) {
      files = { ...data.config.files };
      renderTabs();
      selectFile(Object.keys(files)[0]);
    }
  } catch (err) {
    console.error('Failed to load worker:', err);
  }
}

function updateContext() {
  if (selectedTenant && selectedWorker) {
    contextInfo.textContent = `${selectedTenant} / ${selectedWorker}`;
  } else if (selectedTenant) {
    contextInfo.textContent = selectedTenant;
  } else {
    contextInfo.textContent = '';
  }
}

// File management
function loadExample(name) {
  files = { ...EXAMPLES[name] };
  selectedWorker = null;
  saveWorkerBtn.style.display = 'none';
  createWorkerBtn.style.display = selectedTenant ? 'inline-flex' : 'none';
  renderTabs();
  selectFile(Object.keys(files)[0]);
  updateContext();
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
  const name = document.getElementById('newFileName').value.trim();
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

// Worker execution
async function runWorker() {
  setStatus('loading', 'Building...');
  runBtn.disabled = true;

  try {
    const body = {
      files,
      options: {
        bundle: document.getElementById('bundleOpt').checked,
        minify: document.getElementById('minifyOpt').checked,
      },
    };

    // If we have a tenant selected, use their defaults
    if (selectedTenant) {
      body.tenantId = selectedTenant;
    }

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

// Utilities
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return date.toLocaleDateString();
}

// Start
init();
