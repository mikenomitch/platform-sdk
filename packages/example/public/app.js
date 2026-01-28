// Description constants (used in sidebar tooltips and welcome cards)
const DESCRIPTIONS = {
  tenants: 'Tenants represent your customers. Each tenant can have their own Workers with isolated configuration, environment variables, and resource limits.',
  templates: 'Templates are reusable Worker blueprints with customizable slots. Create templates to let tenants deploy Workers with their own configuration without writing code.',
  outbound: 'Outbound Workers intercept all fetch() requests made by tenant Workers. Use them to enforce security policies, add logging, or route requests through proxies.',
  tail: 'Tail Workers receive logs and traces from tenant Workers after execution. Use them for custom logging, analytics, error tracking, or compliance auditing.',
};

// State
let files = {};
let currentFile = null;
let selectedTenant = null;
let selectedWorker = null;
let platformDefaults = null;
let outboundWorkers = [];
let tailWorkers = [];
let templates = [];
let selectedTemplateForWorker = null;
let currentView = 'welcome'; // 'welcome' | 'defaults' | 'tenant' | 'template' | 'worker'
let cmEditor = null; // CodeMirror instance for main editor
let cmNewOutbound = null; // CodeMirror for new outbound modal
let cmNewTail = null; // CodeMirror for new tail modal
let cmOutboundDetail = null; // CodeMirror for outbound detail modal
let cmTailDetail = null; // CodeMirror for tail detail modal
let cmTemplateView = null; // CodeMirror for template view
let cmOutboundView = null; // CodeMirror for outbound view
let cmTailView = null; // CodeMirror for tail view
let cmTemplateWorkerPreview = null; // CodeMirror for template worker view preview
let currentTemplateForWorker = null; // Currently selected template in template worker view
let previewFiles = {}; // Generated preview files for template worker view
let currentPreviewFile = null; // Currently selected preview file
let editingTemplateId = null; // ID of template being edited (null = new)
let editingOutboundId = null; // ID of outbound being edited (null = new)
let editingTailId = null; // ID of tail being edited (null = new)
let templateFiles = {}; // Files for current template being edited
let currentTemplateFile = null; // Currently selected file in template editor
let templateSlots = []; // Slots for current template being edited

// Legacy CodeMirror instances for modals (kept for backward compatibility)
let cmNewTemplate = null;
let cmTemplateDetail = null;
let cmTemplatePreview = null;

// View elements
const welcomeView = document.getElementById('welcomeView');
const defaultsView = document.getElementById('defaultsView');
const tenantView = document.getElementById('tenantView');
const templateView = document.getElementById('templateView');
const templateWorkerView = document.getElementById('templateWorkerView');
const outboundView = document.getElementById('outboundView');
const tailView = document.getElementById('tailView');
const workerView = document.getElementById('workerView');

// DOM Elements
const editorTextarea = document.getElementById('editor');
const tabs = document.getElementById('tabs');
const output = document.getElementById('output');
const status = document.getElementById('status');
const runBtn = document.getElementById('runBtn');
const saveWorkerBtn = document.getElementById('saveWorkerBtn');
const createWorkerBtn = document.getElementById('createWorkerBtn');
const examples = document.getElementById('examples');

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
const addOutboundModal = document.getElementById('addOutboundModal');
const addTailModal = document.getElementById('addTailModal');
const outboundDetailModal = document.getElementById('outboundDetailModal');
const tailDetailModal = document.getElementById('tailDetailModal');
const platformDefaultsModal = document.getElementById('platformDefaultsModal');

// Outbound/Tail/Template lists
const outboundList = document.getElementById('outboundList');
const tailList = document.getElementById('tailList');
const templateList = document.getElementById('templateList');

// Template modals
const addTemplateModal = document.getElementById('addTemplateModal');
const templateDetailModal = document.getElementById('templateDetailModal');

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

  // Templates example - HTML templating
  templates: {
    'src/index.ts': '// Templates Example\n' +
      '// Demonstrates HTML templating in Worker code\n\n' +
      'import { renderPage } from \'./templates/page\';\n' +
      'import { renderCard } from \'./templates/card\';\n\n' +
      'const users = [\n' +
      '  { id: 1, name: \'Alice\', role: \'Admin\', avatar: \'A\' },\n' +
      '  { id: 2, name: \'Bob\', role: \'Developer\', avatar: \'B\' },\n' +
      '  { id: 3, name: \'Charlie\', role: \'Designer\', avatar: \'C\' },\n' +
      '];\n\n' +
      'export default {\n' +
      '  fetch(request: Request): Response {\n' +
      '    const cards = users.map(user => renderCard(user)).join(\'\\n\');\n' +
      '    const html = renderPage(\'User Directory\', cards);\n\n' +
      '    return new Response(html, {\n' +
      '      headers: { \'Content-Type\': \'text/html\' },\n' +
      '    });\n' +
      '  }\n' +
      '}',
    'src/templates/page.ts': '// Page template wrapper\n' +
      'export function renderPage(title: string, content: string): string {\n' +
      '  return `<!DOCTYPE html>\n' +
      '<html>\n' +
      '<head>\n' +
      '  <title>${title}</title>\n' +
      '  <style>\n' +
      '    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }\n' +
      '    h1 { color: #333; }\n' +
      '    .cards { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }\n' +
      '  </style>\n' +
      '</head>\n' +
      '<body>\n' +
      '  <h1>${title}</h1>\n' +
      '  <div class="cards">\n' +
      '    ${content}\n' +
      '  </div>\n' +
      '</body>\n' +
      '</html>`;\n' +
      '}',
    'src/templates/card.ts': '// Card component template\n' +
      'interface User {\n' +
      '  id: number;\n' +
      '  name: string;\n' +
      '  role: string;\n' +
      '  avatar: string;\n' +
      '}\n\n' +
      'export function renderCard(user: User): string {\n' +
      '  return `\n' +
      '    <div style="background: white; padding: 16px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">\n' +
      '      <div style="width: 48px; height: 48px; background: #6366f1; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px;">\n' +
      '        ${user.avatar}\n' +
      '      </div>\n' +
      '      <h3 style="margin: 12px 0 4px;">${user.name}</h3>\n' +
      '      <p style="margin: 0; color: #666;">${user.role}</p>\n' +
      '    </div>\n' +
      '  `;\n' +
      '}',
    'package.json': JSON.stringify({ name: 'templates-worker', main: 'src/index.ts' }, null, 2),
  },

  // Package loading example - import npm packages
  'package-loading': {
    'src/index.ts': '// Package Loading Example\n' +
      '// Demonstrates importing npm packages in Worker code\n\n' +
      'import _ from \'lodash\';\n\n' +
      'export default {\n' +
      '  fetch(request: Request): Response {\n' +
      '    const data = [\n' +
      '      { name: \'Alice\', score: 85 },\n' +
      '      { name: \'Bob\', score: 92 },\n' +
      '      { name: \'Charlie\', score: 78 },\n' +
      '      { name: \'Diana\', score: 95 },\n' +
      '    ];\n\n' +
      '    // Use lodash utilities\n' +
      '    const sorted = _.orderBy(data, [\'score\'], [\'desc\']);\n' +
      '    const topScorer = _.first(sorted);\n' +
      '    const avgScore = _.meanBy(data, \'score\');\n' +
      '    const names = _.map(data, \'name\');\n\n' +
      '    return new Response(JSON.stringify({\n' +
      '      message: \'Package loading example with lodash\',\n' +
      '      original: data,\n' +
      '      sortedByScore: sorted,\n' +
      '      topScorer,\n' +
      '      averageScore: avgScore,\n' +
      '      allNames: names,\n' +
      '      lodashVersion: _.VERSION,\n' +
      '    }, null, 2), {\n' +
      '      headers: { \'Content-Type\': \'application/json\' },\n' +
      '    });\n' +
      '  }\n' +
      '}',
    'package.json': JSON.stringify({ name: 'package-loading-worker', main: 'src/index.ts', dependencies: { lodash: '^4.17.21' } }, null, 2),
  },

  // Subrequest example - makes outbound fetch calls
  subrequest: {
    'src/index.ts': `// Subrequest Example
// Demonstrates making outbound fetch() calls from a Worker
// If an outbound worker is attached, it will intercept these requests

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const target = url.searchParams.get('url') || 'https://httpbin.org/json';
    
    console.log('Making subrequest to:', target);
    
    try {
      const start = Date.now();
      const response = await fetch(target);
      const elapsed = Date.now() - start;
      
      const body = await response.text();
      
      return new Response(JSON.stringify({
        success: true,
        target,
        status: response.status,
        elapsed: elapsed + 'ms',
        headers: Object.fromEntries(response.headers),
        body: body.slice(0, 1000) + (body.length > 1000 ? '...' : ''),
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        target,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}`,
    'package.json': JSON.stringify({ name: 'subrequest-worker', main: 'src/index.ts' }, null, 2),
  },
};

// URL-based routing
function updateURL(path, replace = false) {
  const url = new URL(window.location);
  url.pathname = path;
  if (replace) {
    history.replaceState({ path }, '', url);
  } else {
    history.pushState({ path }, '', url);
  }
}

function navigateTo(path, replace = false) {
  updateURL(path, replace);
  handleRoute(path);
}

function handleRoute(path) {
  // Parse the path
  const parts = path.split('/').filter(Boolean);
  
  if (parts.length === 0) {
    showViewDirect('welcome');
    return;
  }
  
  switch (parts[0]) {
    case 'defaults':
      showViewDirect('defaults');
      loadDefaultsIntoView();
      break;
    case 'tenants':
      if (parts.length === 1) {
        showViewDirect('welcome');
      } else if (parts.length === 2) {
        // /tenants/:tenantId
        showTenantViewDirect(parts[1]);
      } else if (parts[2] === 'create-from-template' && parts[3]) {
        // /tenants/:tenantId/create-from-template/:templateId
        showCreateFromTemplateView(parts[1], parts[3]);
      } else if (parts[2] === 'workers' && parts[3]) {
        // /tenants/:tenantId/workers/:workerId
        showWorkerViewDirect(parts[1], parts[3]);
      }
      break;
    case 'templates':
      if (parts.length === 1) {
        showViewDirect('welcome');
      } else if (parts[1] === 'new') {
        // /templates/new
        showTemplateViewDirect(null);
      } else {
        // /templates/:templateId
        showTemplateViewDirect(parts[1]);
      }
      break;
    case 'outbound':
      if (parts.length === 1) {
        showViewDirect('welcome');
      } else if (parts[1] === 'new') {
        // /outbound/new
        showOutboundViewDirect(null);
      } else {
        // /outbound/:outboundId
        showOutboundViewDirect(parts[1]);
      }
      break;
    case 'tail':
      if (parts.length === 1) {
        showViewDirect('welcome');
      } else if (parts[1] === 'new') {
        // /tail/new
        showTailViewDirect(null);
      } else {
        // /tail/:tailId
        showTailViewDirect(parts[1]);
      }
      break;
    default:
      showViewDirect('welcome');
  }
}

// Listen for browser back/forward
window.addEventListener('popstate', (e) => {
  const path = e.state?.path || window.location.pathname;
  handleRoute(path);
});

// View switching (internal, doesn't update URL)
function showViewDirect(viewName) {
  currentView = viewName;
  
  // Hide all views
  welcomeView.classList.add('hidden');
  defaultsView.classList.add('hidden');
  tenantView.classList.add('hidden');
  templateView.classList.add('hidden');
  templateWorkerView.classList.add('hidden');
  outboundView.classList.add('hidden');
  tailView.classList.add('hidden');
  workerView.classList.add('hidden');
  
  // Show the selected view
  switch (viewName) {
    case 'welcome':
      welcomeView.classList.remove('hidden');
      break;
    case 'defaults':
      defaultsView.classList.remove('hidden');
      break;
    case 'tenant':
      tenantView.classList.remove('hidden');
      break;
    case 'template':
      templateView.classList.remove('hidden');
      if (cmTemplateView) {
        setTimeout(() => cmTemplateView.refresh(), 10);
      }
      break;
    case 'templateWorker':
      templateWorkerView.classList.remove('hidden');
      if (cmTemplateWorkerPreview) {
        setTimeout(() => cmTemplateWorkerPreview.refresh(), 10);
      }
      break;
    case 'outbound':
      outboundView.classList.remove('hidden');
      if (cmOutboundView) {
        setTimeout(() => cmOutboundView.refresh(), 10);
      }
      break;
    case 'tail':
      tailView.classList.remove('hidden');
      if (cmTailView) {
        setTimeout(() => cmTailView.refresh(), 10);
      }
      break;
    case 'worker':
      workerView.classList.remove('hidden');
      if (cmEditor) {
        setTimeout(() => cmEditor.refresh(), 10);
      }
      break;
  }
}

// Legacy showView - now updates URL
function showView(viewName) {
  switch (viewName) {
    case 'welcome':
      navigateTo('/');
      break;
    case 'defaults':
      navigateTo('/defaults');
      break;
    default:
      showViewDirect(viewName);
  }
}

// Load defaults into the defaults view
function loadDefaultsIntoView() {
  if (!platformDefaults) return;
  document.getElementById('defaultsEnvInput').value = JSON.stringify(platformDefaults.env || {}, null, 2);
  document.getElementById('defaultsCompatDateInput').value = platformDefaults.compatibilityDate || '';
  document.getElementById('defaultsCompatFlagsInput').value = (platformDefaults.compatibilityFlags || []).join(', ');
  document.getElementById('defaultsCpuMsInput').value = platformDefaults.limits?.cpuMs || '';
  document.getElementById('defaultsSubrequestsInput').value = platformDefaults.limits?.subrequests || '';
}

// Show tenant view with data loaded (updates URL)
async function showTenantView(tenantId) {
  navigateTo(`/tenants/${tenantId}`);
}

// Internal: load and display tenant view without URL change
async function showTenantViewDirect(tenantId) {
  try {
    const res = await fetch(`/api/tenants/${tenantId}`);
    const data = await res.json();
    
    selectedTenant = tenantId;
    selectedWorker = null;
    document.getElementById('tenantViewId').textContent = tenantId;
    document.getElementById('tenantEnvInput').value = JSON.stringify(data.config?.env || {}, null, 2);
    document.getElementById('tenantCompatDateInput').value = data.config?.compatibilityDate || '';
    document.getElementById('tenantCompatFlagsInput').value = (data.config?.compatibilityFlags || []).join(', ');
    
    // Set outbound worker selection
    const outboundSelect = document.getElementById('tenantOutboundInput');
    updateSelectOptions(outboundSelect, outboundWorkers, data.associations?.outboundWorkerId);
    
    // Set tail worker selections
    const tailSelect = document.getElementById('tenantTailInput');
    updateMultiSelectOptions(tailSelect, tailWorkers, data.associations?.tailWorkerIds || []);
    
    // Load and render workers for this tenant
    await loadTenantWorkersGrid(tenantId);
    
    // Update sidebar selection
    updateSidebarTenantSelection(tenantId);
    
    showViewDirect('tenant');
  } catch (err) {
    alert('Failed to load tenant: ' + err.message);
    navigateTo('/');
  }
}

// Helper to update select options
function updateSelectOptions(select, items, selectedValue) {
  select.innerHTML = '<option value="">None</option>';
  items.forEach(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name || item.id;
    if (item.id === selectedValue) option.selected = true;
    select.appendChild(option);
  });
}

// Helper to update multi-select options
function updateMultiSelectOptions(select, items, selectedValues) {
  select.innerHTML = '';
  items.forEach(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name || item.id;
    if (selectedValues.includes(item.id)) option.selected = true;
    select.appendChild(option);
  });
}

// Load workers grid for tenant view
async function loadTenantWorkersGrid(tenantId) {
  const grid = document.getElementById('tenantWorkersGrid');
  try {
    const res = await fetch(`/api/tenants/${tenantId}/workers`);
    const data = await res.json();
    const workers = data.workers || [];
    
    if (workers.length === 0) {
      grid.innerHTML = `<div class="empty-state">
        <p>No workers yet.</p>
        <button class="btn primary" id="emptyStateCreateWorkerBtn">Create Worker for Tenant</button>
      </div>`;
      document.getElementById('emptyStateCreateWorkerBtn')?.addEventListener('click', () => {
        addWorkerModal.classList.remove('hidden');
        document.getElementById('newWorkerId').value = '';
        document.getElementById('newWorkerId').focus();
      });
      return;
    }
    
    grid.innerHTML = workers.map(w => `
      <div class="worker-card" data-worker="${w.id}">
        <div class="worker-card-header">
          <span class="worker-card-name">${escapeHtml(w.id)}</span>
          <span class="worker-card-version">v${w.version}</span>
        </div>
        <div class="worker-card-meta">${formatDate(w.updatedAt)}</div>
      </div>
    `).join('');
    
    // Click handlers for worker cards
    grid.querySelectorAll('.worker-card').forEach(card => {
      card.addEventListener('click', () => {
        showWorkerView(tenantId, card.dataset.worker);
      });
    });
  } catch (err) {
    grid.innerHTML = '<div class="error-state">Failed to load workers</div>';
  }
}

// ============================================
// Template View (Create/Edit)
// ============================================

function showTemplateView(templateId = null) {
  if (templateId) {
    navigateTo(`/templates/${templateId}`);
  } else {
    navigateTo('/templates/new');
  }
}

async function showTemplateViewDirect(templateId) {
  editingTemplateId = templateId;
  
  const deleteBtn = document.getElementById('deleteTemplateViewBtn');
  const useBtn = document.getElementById('useTemplateBtn');
  const idInput = document.getElementById('templateIdInput');
  
  if (templateId) {
    // Editing existing template
    document.getElementById('templateViewTitle').textContent = `Edit Template: ${templateId}`;
    deleteBtn.classList.remove('hidden');
    useBtn.classList.remove('hidden');
    idInput.disabled = true;
    
    try {
      const res = await fetch(`/api/templates/${templateId}`);
      const data = await res.json();
      
      idInput.value = templateId;
      document.getElementById('templateNameInput').value = data.name || '';
      document.getElementById('templateDescInput').value = data.description || '';
      
      // Load slots into state and render
      templateSlots = data.slots || [];
      renderTemplateSlots();
      
      // Load files
      templateFiles = data.files || { 'src/index.ts': '' };
      renderTemplateFileTabs();
      selectTemplateFile(Object.keys(templateFiles)[0]);
    } catch (err) {
      alert('Failed to load template: ' + err.message);
      navigateTo('/');
      return;
    }
  } else {
    // Creating new template
    document.getElementById('templateViewTitle').textContent = 'New Template';
    deleteBtn.classList.add('hidden');
    useBtn.classList.add('hidden');
    idInput.disabled = false;
    
    idInput.value = '';
    document.getElementById('templateNameInput').value = '';
    document.getElementById('templateDescInput').value = '';
    
    // Initialize with default slot
    templateSlots = [{ name: 'myVar', description: 'A variable to customize', defaultValue: 'hello' }];
    renderTemplateSlots();
    
    // Initialize with default files
    templateFiles = {
      'src/index.ts': DEFAULT_TEMPLATE_CODE,
      'package.json': JSON.stringify({ name: 'my-template', main: 'src/index.ts' }, null, 2),
    };
    renderTemplateFileTabs();
    selectTemplateFile('src/index.ts');
  }
  
  showViewDirect('template');
}

// Render template file tabs
function renderTemplateFileTabs() {
  const tabsContainer = document.getElementById('templateFileTabs');
  tabsContainer.innerHTML = '';
  
  Object.keys(templateFiles).forEach(name => {
    const tab = document.createElement('button');
    tab.className = `tab${name === currentTemplateFile ? ' active' : ''}`;
    const canDelete = name !== 'package.json' && Object.keys(templateFiles).length > 1;
    tab.innerHTML = name + (canDelete ? `<span class="close" data-file="${name}">&times;</span>` : '');
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('close')) {
        deleteTemplateFile(e.target.dataset.file);
      } else {
        selectTemplateFile(name);
      }
    });
    tabsContainer.appendChild(tab);
  });
}

// Select a template file
function selectTemplateFile(name) {
  // Save current file content before switching
  if (currentTemplateFile && cmTemplateView) {
    templateFiles[currentTemplateFile] = cmTemplateView.getValue();
  }
  
  currentTemplateFile = name;
  if (cmTemplateView) {
    cmTemplateView.setValue(templateFiles[name] || '');
    cmTemplateView.setOption('mode', getModeForFile(name));
    cmTemplateView.refresh();
  }
  renderTemplateFileTabs();
}

// Add a new template file
function addTemplateFile() {
  const name = document.getElementById('newTemplateFileName').value.trim();
  if (!name || templateFiles[name]) {
    if (templateFiles[name]) {
      alert('File already exists');
    }
    return;
  }
  
  // Save current file first
  if (currentTemplateFile && cmTemplateView) {
    templateFiles[currentTemplateFile] = cmTemplateView.getValue();
  }
  
  templateFiles[name] = name.endsWith('.json') ? '{}' : `// ${name}\n`;
  document.getElementById('addTemplateFileModal').classList.add('hidden');
  renderTemplateFileTabs();
  selectTemplateFile(name);
}

// Delete a template file
function deleteTemplateFile(name) {
  if (Object.keys(templateFiles).length <= 1) return;
  if (name === 'package.json') return;
  
  delete templateFiles[name];
  if (currentTemplateFile === name) {
    currentTemplateFile = Object.keys(templateFiles)[0];
  }
  renderTemplateFileTabs();
  selectTemplateFile(currentTemplateFile);
}

// Render template slots UI
function renderTemplateSlots() {
  const container = document.getElementById('templateSlotsContainer');
  container.innerHTML = '';
  
  if (templateSlots.length === 0) {
    container.innerHTML = '<div class="empty-state">No slots defined. Click "+ Add Slot" to create one.</div>';
    return;
  }
  
  templateSlots.forEach((slot, index) => {
    const item = document.createElement('div');
    item.className = 'slot-item';
    item.innerHTML = `
      <div class="slot-item-header">
        <div class="slot-item-name">
          <code>{{${slot.name || 'name'}}}</code>
        </div>
        <div class="slot-item-actions">
          <button class="btn-icon-sm" data-action="copy" data-index="${index}" title="Copy interpolation string">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="btn-icon-sm" data-action="delete" data-index="${index}" title="Remove slot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="slot-item-fields">
        <div class="slot-field-row">
          <div class="slot-field">
            <label>Name</label>
            <input type="text" data-field="name" data-index="${index}" value="${escapeHtml(slot.name || '')}" placeholder="variableName">
          </div>
          <div class="slot-field slot-field-grow">
            <label>Description <span class="label-hint">(shown to end-users)</span></label>
            <input type="text" data-field="description" data-index="${index}" value="${escapeHtml(slot.description || '')}" placeholder="What this slot is for...">
          </div>
        </div>
        <div class="slot-field">
          <label>Default Value <span class="label-hint">(TypeScript expression)</span></label>
          <textarea class="code-input" data-field="defaultValue" data-index="${index}" placeholder="'hello world'">${escapeHtml(slot.defaultValue || '')}</textarea>
        </div>
      </div>
    `;
    container.appendChild(item);
  });
  
  // Add event listeners for inputs and textareas
  container.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', (e) => {
      const index = parseInt(e.target.dataset.index);
      const field = e.target.dataset.field;
      templateSlots[index][field] = e.target.value;
      
      // Update the code preview in header when name changes
      if (field === 'name') {
        const item = e.target.closest('.slot-item');
        const codeEl = item.querySelector('.slot-item-name code');
        codeEl.textContent = `{{${e.target.value || 'name'}}}`;
      }
    });
  });
  
  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.dataset.index);
      const action = e.currentTarget.dataset.action;
      
      if (action === 'copy') {
        copySlotString(index);
      } else if (action === 'delete') {
        removeTemplateSlot(index);
      }
    });
  });
}

// Add a new template slot
function addTemplateSlot() {
  templateSlots.push({
    name: '',
    description: '',
    defaultValue: ''
  });
  renderTemplateSlots();
  
  // Focus the name input of the new slot
  const container = document.getElementById('templateSlotsContainer');
  const lastSlot = container.lastElementChild;
  if (lastSlot) {
    const nameInput = lastSlot.querySelector('input[data-field="name"]');
    if (nameInput) nameInput.focus();
  }
}

// Remove a template slot
function removeTemplateSlot(index) {
  templateSlots.splice(index, 1);
  renderTemplateSlots();
}

// Copy slot interpolation string to clipboard
function copySlotString(index) {
  const slot = templateSlots[index];
  const text = `{{${slot.name || 'name'}}}`;
  navigator.clipboard.writeText(text).then(() => {
    // Brief visual feedback
    const container = document.getElementById('templateSlotsContainer');
    const item = container.children[index];
    const btn = item.querySelector('button[data-action="copy"]');
    btn.style.color = 'var(--success)';
    setTimeout(() => {
      btn.style.color = '';
    }, 1000);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

async function saveTemplateFromView() {
  const id = document.getElementById('templateIdInput').value.trim();
  const name = document.getElementById('templateNameInput').value.trim();
  const description = document.getElementById('templateDescInput').value.trim();
  
  if (!id || !name) {
    alert('Please fill in ID and Name');
    return;
  }
  
  // Save current file content
  if (currentTemplateFile && cmTemplateView) {
    templateFiles[currentTemplateFile] = cmTemplateView.getValue();
  }
  
  // Filter out slots with empty names
  const slots = templateSlots.filter(s => s.name && s.name.trim());
  
  // Update package.json name if it exists
  if (templateFiles['package.json']) {
    try {
      const pkg = JSON.parse(templateFiles['package.json']);
      pkg.name = id;
      templateFiles['package.json'] = JSON.stringify(pkg, null, 2);
    } catch {
      // Ignore if package.json is invalid
    }
  }
  
  const payload = {
    name,
    description,
    slots,
    files: { ...templateFiles },
  };
  
  try {
    if (editingTemplateId) {
      // Update existing
      await fetch(`/api/templates/${editingTemplateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      // Create new
      payload.id = id;
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create');
      }
    }
    
    await loadTemplates();
    navigateTo('/');
  } catch (err) {
    alert('Failed to save template: ' + err.message);
  }
}

async function deleteTemplateFromView() {
  if (!editingTemplateId) return;
  if (!confirm(`Delete template "${editingTemplateId}"?`)) return;
  
  try {
    await fetch(`/api/templates/${editingTemplateId}`, { method: 'DELETE' });
    await loadTemplates();
    navigateTo('/');
  } catch (err) {
    alert('Failed to delete template: ' + err.message);
  }
}

// Use template to create a worker - requires selecting a tenant first
function useTemplateToCreateWorker() {
  if (!editingTemplateId) return;
  
  // Check if there are any tenants
  const tenantItems = document.querySelectorAll('#tenantList .list-item');
  if (tenantItems.length === 0) {
    alert('Please create a tenant first before creating a worker from this template.');
    return;
  }
  
  // If a tenant is already selected, go directly to create page
  if (selectedTenant) {
    navigateTo(`/tenants/${selectedTenant}/create-from-template/${editingTemplateId}`);
    return;
  }
  
  // Otherwise, prompt to select a tenant
  const tenantIds = Array.from(tenantItems).map(item => item.dataset.tenant);
  const tenant = prompt(`Select a tenant to create a worker for:\n\nAvailable tenants: ${tenantIds.join(', ')}`);
  
  if (tenant && tenantIds.includes(tenant)) {
    navigateTo(`/tenants/${tenant}/create-from-template/${editingTemplateId}`);
  } else if (tenant) {
    alert(`Tenant "${tenant}" not found. Please enter one of: ${tenantIds.join(', ')}`);
  }
}

// ============================================
// Outbound Worker View (Create/Edit)
// ============================================

function showOutboundView(outboundId = null) {
  if (outboundId) {
    navigateTo(`/outbound/${outboundId}`);
  } else {
    navigateTo('/outbound/new');
  }
}

async function showOutboundViewDirect(outboundId) {
  editingOutboundId = outboundId;
  
  const deleteBtn = document.getElementById('deleteOutboundViewBtn');
  const idInput = document.getElementById('outboundIdInput');
  
  if (outboundId) {
    // Editing existing
    document.getElementById('outboundViewTitle').textContent = `Edit Outbound: ${outboundId}`;
    deleteBtn.classList.remove('hidden');
    idInput.disabled = true;
    
    try {
      const res = await fetch(`/api/outbound-workers/${outboundId}`);
      const data = await res.json();
      
      idInput.value = outboundId;
      document.getElementById('outboundNameInput').value = data.name || '';
      cmOutboundView.setValue(data.files?.['src/index.ts'] || '');
    } catch (err) {
      alert('Failed to load outbound worker: ' + err.message);
      navigateTo('/');
      return;
    }
  } else {
    // Creating new
    document.getElementById('outboundViewTitle').textContent = 'New Outbound Worker';
    deleteBtn.classList.add('hidden');
    idInput.disabled = false;
    
    idInput.value = '';
    document.getElementById('outboundNameInput').value = '';
    cmOutboundView.setValue(DEFAULT_OUTBOUND_CODE);
  }
  
  showViewDirect('outbound');
}

async function saveOutboundFromView() {
  const id = document.getElementById('outboundIdInput').value.trim();
  const name = document.getElementById('outboundNameInput').value.trim();
  const code = cmOutboundView.getValue();
  
  if (!id || !name) {
    alert('Please fill in ID and Name');
    return;
  }
  
  const payload = {
    name,
    files: {
      'src/index.ts': code,
      'package.json': JSON.stringify({ name: id, main: 'src/index.ts' }, null, 2),
    },
  };
  
  try {
    if (editingOutboundId) {
      // Update existing
      await fetch(`/api/outbound-workers/${editingOutboundId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      // Create new
      payload.id = id;
      const res = await fetch('/api/outbound-workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create');
      }
    }
    
    await loadOutboundWorkers();
    navigateTo('/');
  } catch (err) {
    alert('Failed to save outbound worker: ' + err.message);
  }
}

async function deleteOutboundFromView() {
  if (!editingOutboundId) return;
  if (!confirm(`Delete outbound worker "${editingOutboundId}"?`)) return;
  
  try {
    await fetch(`/api/outbound-workers/${editingOutboundId}`, { method: 'DELETE' });
    await loadOutboundWorkers();
    navigateTo('/');
  } catch (err) {
    alert('Failed to delete outbound worker: ' + err.message);
  }
}

// ============================================
// Tail Worker View (Create/Edit)
// ============================================

function showTailView(tailId = null) {
  if (tailId) {
    navigateTo(`/tail/${tailId}`);
  } else {
    navigateTo('/tail/new');
  }
}

async function showTailViewDirect(tailId) {
  editingTailId = tailId;
  
  const deleteBtn = document.getElementById('deleteTailViewBtn');
  const idInput = document.getElementById('tailIdInput');
  
  if (tailId) {
    // Editing existing
    document.getElementById('tailViewTitle').textContent = `Edit Tail Worker: ${tailId}`;
    deleteBtn.classList.remove('hidden');
    idInput.disabled = true;
    
    try {
      const res = await fetch(`/api/tail-workers/${tailId}`);
      const data = await res.json();
      
      idInput.value = tailId;
      document.getElementById('tailNameInput').value = data.name || '';
      cmTailView.setValue(data.files?.['src/index.ts'] || '');
    } catch (err) {
      alert('Failed to load tail worker: ' + err.message);
      navigateTo('/');
      return;
    }
  } else {
    // Creating new
    document.getElementById('tailViewTitle').textContent = 'New Tail Worker';
    deleteBtn.classList.add('hidden');
    idInput.disabled = false;
    
    idInput.value = '';
    document.getElementById('tailNameInput').value = '';
    cmTailView.setValue(DEFAULT_TAIL_CODE);
  }
  
  showViewDirect('tail');
}

async function saveTailFromView() {
  const id = document.getElementById('tailIdInput').value.trim();
  const name = document.getElementById('tailNameInput').value.trim();
  const code = cmTailView.getValue();
  
  if (!id || !name) {
    alert('Please fill in ID and Name');
    return;
  }
  
  const payload = {
    name,
    files: {
      'src/index.ts': code,
      'package.json': JSON.stringify({ name: id, main: 'src/index.ts' }, null, 2),
    },
  };
  
  try {
    if (editingTailId) {
      // Update existing
      await fetch(`/api/tail-workers/${editingTailId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      // Create new
      payload.id = id;
      const res = await fetch('/api/tail-workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create');
      }
    }
    
    await loadTailWorkers();
    navigateTo('/');
  } catch (err) {
    alert('Failed to save tail worker: ' + err.message);
  }
}

async function deleteTailFromView() {
  if (!editingTailId) return;
  if (!confirm(`Delete tail worker "${editingTailId}"?`)) return;
  
  try {
    await fetch(`/api/tail-workers/${editingTailId}`, { method: 'DELETE' });
    await loadTailWorkers();
    navigateTo('/');
  } catch (err) {
    alert('Failed to delete tail worker: ' + err.message);
  }
}

// ============================================
// Template Worker View (Create from Template)
// ============================================

// Show create-from-template view for a specific template
async function showCreateFromTemplateView(tenantId, templateId) {
  selectedTenant = tenantId;
  
  // Set tenant context
  document.getElementById('templateWorkerTenantName').textContent = tenantId;
  
  // Reset form
  document.getElementById('templateWorkerIdInput').value = '';
  document.getElementById('templateWorkerSlotsContainer').innerHTML = '<div class="loading">Loading template...</div>';
  
  // Update sidebar selection
  updateSidebarTenantSelection(tenantId);
  
  showViewDirect('templateWorker');
  
  // Load the template
  try {
    const res = await fetch(`/api/templates/${templateId}`);
    if (!res.ok) {
      throw new Error('Template not found');
    }
    const template = await res.json();
    currentTemplateForWorker = template;
    
    // Update view title
    document.getElementById('templateWorkerViewTitle').textContent = `Create Worker from "${template.name}"`;
    
    // Show template info
    document.getElementById('templateWorkerInfoName').textContent = template.name;
    document.getElementById('templateWorkerInfoDesc').textContent = template.description || 'No description provided.';
    
    // Render slot inputs
    renderTemplateWorkerSlots(template.slots || []);
    
    // Reset preview state
    previewFiles = {};
    currentPreviewFile = null;
    
    // Generate initial preview (this will also render tabs)
    await updateTemplateWorkerPreview();
  } catch (err) {
    console.error('Failed to load template:', err);
    document.getElementById('templateWorkerSlotsContainer').innerHTML = 
      `<div class="error-state">Failed to load template: ${escapeHtml(err.message)}</div>`;
  }
}

// Render slot inputs in template worker view
function renderTemplateWorkerSlots(slots) {
  const container = document.getElementById('templateWorkerSlotsContainer');
  
  if (!slots || slots.length === 0) {
    container.innerHTML = '<div class="empty-state">This template has no configurable slots.</div>';
    document.getElementById('templateWorkerSlotsSection').style.display = 'none';
    return;
  }
  
  document.getElementById('templateWorkerSlotsSection').style.display = 'block';
  
  container.innerHTML = slots.map(slot => `
    <div class="slot-input-group">
      <div class="slot-input-header">
        <label><code class="slot-name">{{${slot.name}}}</code></label>
        <span class="slot-description">${escapeHtml(slot.description || '')}</span>
      </div>
      <textarea class="code-input" 
             data-slot="${slot.name}" 
             placeholder="${escapeHtml(slot.defaultValue || '')}">${escapeHtml(slot.defaultValue || '')}</textarea>
    </div>
  `).join('');
  
  // Add change listeners to update preview
  container.querySelectorAll('textarea[data-slot]').forEach(input => {
    input.addEventListener('input', () => updateTemplateWorkerPreview());
  });
}

// Get current slot values from template worker view
function getTemplateWorkerSlotValues() {
  const container = document.getElementById('templateWorkerSlotsContainer');
  const inputs = container.querySelectorAll('textarea[data-slot]');
  const values = {};
  inputs.forEach(input => {
    values[input.dataset.slot] = input.value;
  });
  return values;
}

// Update the preview in template worker view
async function updateTemplateWorkerPreview() {
  if (!currentTemplateForWorker) return;
  
  const slotValues = getTemplateWorkerSlotValues();
  
  try {
    const res = await fetch(`/api/templates/${currentTemplateForWorker.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotValues }),
    });
    const data = await res.json();
    
    if (res.ok && data.files) {
      previewFiles = data.files;
      renderPreviewTabs();
      
      // Select first file if none selected or current doesn't exist
      if (!currentPreviewFile || !previewFiles[currentPreviewFile]) {
        currentPreviewFile = Object.keys(previewFiles)[0];
      }
      selectPreviewFile(currentPreviewFile);
    } else {
      previewFiles = {};
      renderPreviewTabs();
      cmTemplateWorkerPreview.setValue('// Error generating preview: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    previewFiles = {};
    renderPreviewTabs();
    cmTemplateWorkerPreview.setValue('// Error generating preview: ' + err.message);
  }
}

// Render preview file tabs
function renderPreviewTabs() {
  const tabsContainer = document.getElementById('templateWorkerPreviewTabs');
  if (!tabsContainer) return;
  
  const fileNames = Object.keys(previewFiles);
  
  if (fileNames.length === 0) {
    tabsContainer.innerHTML = '';
    return;
  }
  
  tabsContainer.innerHTML = fileNames.map(name => `
    <button class="tab${name === currentPreviewFile ? ' active' : ''}" data-file="${escapeHtml(name)}">
      ${escapeHtml(name)}
    </button>
  `).join('');
  
  // Add click handlers
  tabsContainer.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      selectPreviewFile(tab.dataset.file);
    });
  });
}

// Select a preview file
function selectPreviewFile(fileName) {
  currentPreviewFile = fileName;
  
  // Update tab active states
  const tabsContainer = document.getElementById('templateWorkerPreviewTabs');
  if (tabsContainer) {
    tabsContainer.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.file === fileName);
    });
  }
  
  // Update editor content
  if (cmTemplateWorkerPreview && previewFiles[fileName]) {
    cmTemplateWorkerPreview.setValue(previewFiles[fileName]);
    cmTemplateWorkerPreview.setOption('mode', getModeForFile(fileName));
  }
}

// Create worker from template worker view
async function createWorkerFromTemplateView() {
  if (!selectedTenant || !currentTemplateForWorker) {
    alert('Please select a template');
    return;
  }
  
  const workerId = document.getElementById('templateWorkerIdInput').value.trim();
  if (!workerId) {
    alert('Please enter a Worker ID');
    return;
  }
  
  const slotValues = getTemplateWorkerSlotValues();
  console.log('[DEBUG] createWorkerFromTemplateView - slotValues:', slotValues);
  
  try {
    // Generate files from template
    const genRes = await fetch(`/api/templates/${currentTemplateForWorker.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotValues }),
    });
    const genData = await genRes.json();
    console.log('[DEBUG] createWorkerFromTemplateView - genData:', genData);
    
    if (!genRes.ok) {
      throw new Error(genData.error || 'Failed to generate from template');
    }
    
    console.log('[DEBUG] createWorkerFromTemplateView - creating worker with files:', genData.files);
    
    // Create worker with generated files
    const createRes = await fetch(`/api/tenants/${selectedTenant}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id: workerId, 
        files: genData.files,
      }),
    });
    const createData = await createRes.json();
    console.log('[DEBUG] createWorkerFromTemplateView - createData:', createData);
    
    // Refresh sidebar workers list
    await loadWorkers(selectedTenant);
    
    // Navigate to the worker editor
    showWorkerView(selectedTenant, workerId);
  } catch (err) {
    alert('Failed to create worker: ' + err.message);
  }
}

// Show worker view with data loaded (updates URL)
function showWorkerView(tenantId, workerId) {
  navigateTo(`/tenants/${tenantId}/workers/${workerId}`);
}

// Internal: load and display worker view without URL change
async function showWorkerViewDirect(tenantId, workerId) {
  selectedTenant = tenantId;
  selectedWorker = workerId;
  
  // Update breadcrumb
  document.getElementById('workerBreadcrumb').innerHTML = `
    <span>${escapeHtml(tenantId)}</span> / <span>${escapeHtml(workerId)}</span>
  `;
  
  // Show save button, hide create button
  saveWorkerBtn.style.display = 'inline-flex';
  createWorkerBtn.style.display = 'none';
  
  // Update sidebar selection
  updateSidebarTenantSelection(tenantId);
  
  try {
    const res = await fetch(`/api/tenants/${tenantId}/workers/${workerId}`);
    const data = await res.json();
    if (data.config?.files) {
      files = { ...data.config.files };
      renderTabs();
      selectFile(Object.keys(files)[0]);
    }
  } catch (err) {
    console.error('Failed to load worker:', err);
    navigateTo(`/tenants/${tenantId}`);
    return;
  }
  
  showViewDirect('worker');
}

// Get CodeMirror mode based on filename
function getModeForFile(filename) {
  if (!filename) return 'javascript';
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return { name: 'javascript', typescript: true };
    case 'js':
    case 'jsx':
    case 'mjs':
      return 'javascript';
    case 'json':
      return { name: 'javascript', json: true };
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
      return 'htmlmixed';
    case 'svg':
    case 'xml':
      return 'xml';
    default:
      return 'javascript';
  }
}

// Initialize CodeMirror
function initCodeMirror() {
  const cmOptions = {
    mode: { name: 'javascript', typescript: true },
    theme: 'dracula',
    lineNumbers: true,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: true,
  };
  
  // Main editor
  cmEditor = CodeMirror.fromTextArea(editorTextarea, { ...cmOptions, autofocus: true });
  cmEditor.on('change', () => {
    if (currentFile) {
      files[currentFile] = cmEditor.getValue();
    }
  });
  
  // Outbound worker editors
  cmNewOutbound = CodeMirror(document.getElementById('newOutboundCodeContainer'), cmOptions);
  cmOutboundDetail = CodeMirror(document.getElementById('outboundDetailCodeContainer'), cmOptions);
  
  // Tail worker editors
  cmNewTail = CodeMirror(document.getElementById('newTailCodeContainer'), cmOptions);
  cmTailDetail = CodeMirror(document.getElementById('tailDetailCodeContainer'), cmOptions);
  
  // Full-screen view editors
  cmTemplateView = CodeMirror(document.getElementById('templateCodeContainer'), cmOptions);
  cmTemplateView.on('change', () => {
    if (currentTemplateFile) {
      templateFiles[currentTemplateFile] = cmTemplateView.getValue();
    }
  });
  
  cmOutboundView = CodeMirror(document.getElementById('outboundCodeContainer'), cmOptions);
  cmTailView = CodeMirror(document.getElementById('tailCodeContainer'), cmOptions);
  cmTemplateWorkerPreview = CodeMirror(document.getElementById('templateWorkerPreviewContainer'), { ...cmOptions, readOnly: true });
}

// Initialize
async function init() {
  initCodeMirror();
  loadExample('hello');
  await Promise.all([
    loadDefaults(),
    loadTenants(),
    loadOutboundWorkers(),
    loadTailWorkers(),
    loadTemplates(),
  ]);
  setupEventListeners();
  
  // Initialize routing based on current URL
  const path = window.location.pathname;
  if (path && path !== '/') {
    // Replace current history entry to ensure proper state
    history.replaceState({ path }, '', path);
    handleRoute(path);
  }
}

function setupEventListeners() {
  // Welcome card buttons
  document.getElementById('welcomeCreateTenant').querySelector('.btn').addEventListener('click', () => {
    addTenantModal.classList.remove('hidden');
    document.getElementById('newTenantId').value = '';
    document.getElementById('newTenantEnv').value = '';
    document.getElementById('newTenantId').focus();
  });
  
  document.getElementById('welcomeCreateTemplate').querySelector('.btn').addEventListener('click', () => {
    showTemplateView(null); // New template
  });
  
  document.getElementById('welcomeAddOutbound').addEventListener('click', () => {
    showOutboundView(null); // New outbound
  });
  
  document.getElementById('welcomeAddTail').addEventListener('click', () => {
    showTailView(null); // New tail
  });
  
  // Logo click - go to home
  document.getElementById('logoLink').addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo('/');
  });
  
  // Back buttons in views
  document.getElementById('defaultsBackBtn').addEventListener('click', () => navigateTo('/'));
  document.getElementById('tenantBackBtn').addEventListener('click', () => navigateTo('/'));
  document.getElementById('templateBackBtn').addEventListener('click', () => navigateTo('/'));
  document.getElementById('outboundBackBtn').addEventListener('click', () => navigateTo('/'));
  document.getElementById('tailBackBtn').addEventListener('click', () => navigateTo('/'));
  document.getElementById('templateWorkerBackBtn').addEventListener('click', () => {
    if (selectedTenant) {
      showTenantView(selectedTenant);
    } else {
      navigateTo('/');
    }
  });
  document.getElementById('workerBackBtn').addEventListener('click', () => {
    if (selectedTenant) {
      showTenantView(selectedTenant);
    } else {
      navigateTo('/');
    }
  });
  
  // Template view buttons
  document.getElementById('saveTemplateViewBtn').addEventListener('click', saveTemplateFromView);
  document.getElementById('deleteTemplateViewBtn').addEventListener('click', deleteTemplateFromView);
  document.getElementById('addSlotBtn').addEventListener('click', addTemplateSlot);
  document.getElementById('useTemplateBtn').addEventListener('click', useTemplateToCreateWorker);
  
  // Template file management
  document.getElementById('addTemplateFile').addEventListener('click', () => {
    document.getElementById('addTemplateFileModal').classList.remove('hidden');
    document.getElementById('newTemplateFileName').value = '';
    document.getElementById('newTemplateFileName').focus();
  });
  document.getElementById('cancelAddTemplateFile').addEventListener('click', () => {
    document.getElementById('addTemplateFileModal').classList.add('hidden');
  });
  document.getElementById('confirmAddTemplateFile').addEventListener('click', addTemplateFile);
  document.getElementById('newTemplateFileName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTemplateFile();
    if (e.key === 'Escape') document.getElementById('addTemplateFileModal').classList.add('hidden');
  });
  
  // Outbound view buttons
  document.getElementById('saveOutboundViewBtn').addEventListener('click', saveOutboundFromView);
  document.getElementById('deleteOutboundViewBtn').addEventListener('click', deleteOutboundFromView);
  
  // Tail view buttons
  document.getElementById('saveTailViewBtn').addEventListener('click', saveTailFromView);
  document.getElementById('deleteTailViewBtn').addEventListener('click', deleteTailFromView);
  
  // Template worker view (create from template)
  document.getElementById('createTemplateWorkerBtn').addEventListener('click', createWorkerFromTemplateView);

  // Examples
  examples.addEventListener('change', (e) => {
    if (e.target.value) {
      loadExample(e.target.value);
      e.target.value = '';
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
    document.getElementById('newWorkerEnv').value = '';
    document.getElementById('workerOutboundSelect').value = '';
    // Clear tail worker selections
    const tailSelect = document.getElementById('workerTailSelect');
    Array.from(tailSelect.options).forEach(o => o.selected = false);
    document.getElementById('newWorkerId').focus();
  });
  document.getElementById('cancelAddWorker').addEventListener('click', () => addWorkerModal.classList.add('hidden'));
  document.getElementById('confirmAddWorker').addEventListener('click', createWorker);

  // Tenant detail modal (legacy, still used for edit button)
  document.getElementById('closeTenantDetail').addEventListener('click', () => tenantDetailModal.classList.add('hidden'));
  document.getElementById('cancelTenantEdit').addEventListener('click', () => tenantDetailModal.classList.add('hidden'));
  document.getElementById('saveTenantBtn').addEventListener('click', saveTenant);
  document.getElementById('deleteTenantBtn').addEventListener('click', deleteTenant);
  
  // Tenant view buttons
  document.getElementById('saveTenantViewBtn').addEventListener('click', saveTenantFromView);
  document.getElementById('deleteTenantViewBtn').addEventListener('click', deleteTenantFromView);
  
  // Helper to open add worker modal
  function openAddWorkerModal() {
    if (!selectedTenant) return;
    addWorkerModal.classList.remove('hidden');
    document.getElementById('newWorkerId').value = '';
    document.getElementById('newWorkerEnv').value = '';
    document.getElementById('workerOutboundSelect').value = '';
    const tailSelect = document.getElementById('workerTailSelect');
    if (tailSelect) {
      Array.from(tailSelect.options).forEach(o => o.selected = false);
    }
    document.getElementById('newWorkerId').focus();
  }
  
  document.getElementById('addWorkerToTenantBtn').addEventListener('click', openAddWorkerModal);
  document.getElementById('emptyStateCreateWorkerBtn')?.addEventListener('click', openAddWorkerModal);

  // Platform defaults modal
  document.getElementById('editDefaultsBtn').addEventListener('click', openPlatformDefaults);
  document.getElementById('closePlatformDefaults').addEventListener('click', () => platformDefaultsModal.classList.add('hidden'));
  document.getElementById('cancelPlatformDefaults').addEventListener('click', () => platformDefaultsModal.classList.add('hidden'));
  document.getElementById('savePlatformDefaults').addEventListener('click', savePlatformDefaults);

  // Section toggles
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.section-actions button')) return;
      if (e.target.closest('.info-icon')) return; // Don't toggle when clicking info icon
      const section = header.closest('.sidebar-section');
      section.classList.toggle('collapsed');
    });
  });
  
  // Info icon tooltips
  setupInfoTooltips();
  
  // Populate welcome card descriptions from constants
  document.querySelectorAll('.welcome-card[data-description]').forEach(card => {
    const key = card.dataset.description;
    const desc = DESCRIPTIONS[key];
    if (desc) {
      const p = card.querySelector('.welcome-card-desc');
      if (p) p.textContent = desc;
    }
  });

  // Outbound workers - sidebar buttons
  document.getElementById('addOutboundBtn').addEventListener('click', () => showOutboundView(null));
  document.getElementById('createDefaultOutboundBtn').addEventListener('click', createDefaultOutbound);

  // Tail workers - sidebar buttons
  document.getElementById('addTailBtn').addEventListener('click', () => showTailView(null));
  document.getElementById('createDefaultTailBtn').addEventListener('click', createDefaultTail);

  // Templates - sidebar buttons
  document.getElementById('addTemplateBtn').addEventListener('click', () => showTemplateView(null));
  document.getElementById('createDefaultTemplateBtn').addEventListener('click', createDefaultTemplate);

  // Worker type toggle (standard vs template)
  document.querySelectorAll('input[name="workerType"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const isTemplate = e.target.value === 'template';
      document.getElementById('standardWorkerFields').style.display = isTemplate ? 'none' : 'block';
      document.getElementById('templateWorkerFields').style.display = isTemplate ? 'block' : 'none';
    });
  });

}

// Default code templates
const DEFAULT_OUTBOUND_CODE = `import { WorkerEntrypoint } from 'cloudflare:workers';

export class OutboundHandler extends WorkerEntrypoint {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Only allow requests to zombo.com
    if (url.hostname === 'zombo.com' || url.hostname.endsWith('.zombo.com')) {
      console.log('[Outbound] Allowed:', request.method, request.url);
      return fetch(request);
    }
    
    // Block everything else
    console.log('[Outbound] Blocked:', request.method, request.url);
    return new Response('no no - outbound requests are only allowed to zombo.com', { 
      status: 403,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

export default {
  fetch() {
    return new Response('Outbound worker - use via binding');
  }
}`;

const DEFAULT_TEMPLATE_CODE = '// Worker Template\n' +
  '// Use {{slotName}} syntax for customizable values\n\n' +
  'export default {\n' +
  '  fetch(request: Request): Response {\n' +
  '    const value = {{myVar}};\n' +
  '    return new Response(JSON.stringify({ value }, null, 2), {\n' +
  '      headers: { \'Content-Type\': \'application/json\' },\n' +
  '    });\n' +
  '  }\n' +
  '}';

const DEFAULT_TAIL_CODE = `export default {
  async tail(events: TraceItem[]): Promise<void> {
    for (const event of events) {
      console.log('[TailWorker] Custom Log -', {
        scriptName: event.scriptName,
        outcome: event.outcome,
        eventTimestamp: event.eventTimestamp,
        logs: event.logs?.length ?? 0,
        exceptions: event.exceptions?.length ?? 0,
      });
      
      // Log any exceptions
      if (event.exceptions?.length) {
        for (const ex of event.exceptions) {
          console.error('[TailWorker] Exception:', ex.name, ex.message);
        }
      }
    }
  }
}`;

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

function openPlatformDefaults() {
  if (!platformDefaults) return;
  
  document.getElementById('defaultsEnvEditor').value = JSON.stringify(platformDefaults.env || {}, null, 2);
  document.getElementById('defaultsCompatDate').value = platformDefaults.compatibilityDate || '';
  document.getElementById('defaultsCompatFlags').value = (platformDefaults.compatibilityFlags || []).join(', ');
  document.getElementById('defaultsCpuMs').value = platformDefaults.limits?.cpuMs || '';
  document.getElementById('defaultsSubrequests').value = platformDefaults.limits?.subrequests || '';
  
  platformDefaultsModal.classList.remove('hidden');
}

async function savePlatformDefaults() {
  let env = {};
  const envText = document.getElementById('defaultsEnvEditor').value.trim();
  if (envText) {
    try {
      env = JSON.parse(envText);
    } catch {
      alert('Invalid JSON for environment variables');
      return;
    }
  }

  const compatibilityDate = document.getElementById('defaultsCompatDate').value.trim() || undefined;
  const flagsText = document.getElementById('defaultsCompatFlags').value.trim();
  const compatibilityFlags = flagsText ? flagsText.split(',').map(f => f.trim()).filter(Boolean) : undefined;
  
  const cpuMs = parseInt(document.getElementById('defaultsCpuMs').value) || undefined;
  const subrequests = parseInt(document.getElementById('defaultsSubrequests').value) || undefined;
  const limits = (cpuMs || subrequests) ? { cpuMs, subrequests } : undefined;

  try {
    await fetch('/api/defaults', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env, compatibilityDate, compatibilityFlags, limits }),
    });
    platformDefaultsModal.classList.add('hidden');
    await loadDefaults();
  } catch (err) {
    alert('Failed to save platform defaults: ' + err.message);
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

async function loadOutboundWorkers() {
  try {
    const res = await fetch('/api/outbound-workers');
    const data = await res.json();
    outboundWorkers = data.workers || [];
    renderOutboundWorkers();
    updateOutboundSelects();
  } catch (err) {
    console.error('Failed to load outbound workers:', err);
    outboundList.innerHTML = '<div class="error-state">Failed to load</div>';
  }
}

async function loadTailWorkers() {
  try {
    const res = await fetch('/api/tail-workers');
    const data = await res.json();
    tailWorkers = data.workers || [];
    renderTailWorkers();
    updateTailSelects();
  } catch (err) {
    console.error('Failed to load tail workers:', err);
    tailList.innerHTML = '<div class="error-state">Failed to load</div>';
  }
}

async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    const data = await res.json();
    templates = data.templates || [];
    renderTemplates();
    updateTemplateSelects();
  } catch (err) {
    console.error('Failed to load templates:', err);
    templateList.innerHTML = '<div class="error-state">Failed to load</div>';
  }
}

async function createTemplate() {
  const id = document.getElementById('newTemplateId').value.trim();
  const name = document.getElementById('newTemplateName').value.trim();
  const description = document.getElementById('newTemplateDescription').value.trim();
  const code = cmNewTemplate.getValue();
  
  if (!id || !name) {
    alert('Please fill in ID and Name');
    return;
  }
  
  let slots = [];
  const slotsText = document.getElementById('newTemplateSlots').value.trim();
  if (slotsText) {
    try {
      slots = JSON.parse(slotsText);
    } catch {
      alert('Invalid JSON for slots');
      return;
    }
  }

  try {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name,
        description,
        slots,
        files: {
          'src/index.ts': code,
          'package.json': JSON.stringify({ name: id, main: 'src/index.ts' }, null, 2),
        },
      }),
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create');
    }
    
    addTemplateModal.classList.add('hidden');
    await loadTemplates();
  } catch (err) {
    alert('Failed to create template: ' + err.message);
  }
}

async function createDefaultTemplate() {
  try {
    await fetch('/api/templates/create-default', { method: 'POST' });
    await loadTemplates();
  } catch (err) {
    alert('Failed to create default template: ' + err.message);
  }
}

async function saveTemplate() {
  const id = document.getElementById('templateDetailId').textContent;
  const name = document.getElementById('templateDetailName').value.trim();
  const description = document.getElementById('templateDetailDescription').value.trim();
  const code = cmTemplateDetail.getValue();
  
  let slots = [];
  const slotsText = document.getElementById('templateDetailSlots').value.trim();
  if (slotsText) {
    try {
      slots = JSON.parse(slotsText);
    } catch {
      alert('Invalid JSON for slots');
      return;
    }
  }

  try {
    await fetch(`/api/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        slots,
        files: {
          'src/index.ts': code,
          'package.json': JSON.stringify({ name: id, main: 'src/index.ts' }, null, 2),
        },
      }),
    });
    templateDetailModal.classList.add('hidden');
    await loadTemplates();
  } catch (err) {
    alert('Failed to save template: ' + err.message);
  }
}

async function deleteTemplateHandler() {
  const id = document.getElementById('templateDetailId').textContent;
  if (!confirm(`Delete template "${id}"?`)) return;

  try {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    templateDetailModal.classList.add('hidden');
    await loadTemplates();
  } catch (err) {
    alert('Failed to delete template: ' + err.message);
  }
}

// Render template slot inputs for create worker from template
function renderTemplateSlotInputs(slots, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  if (!slots || slots.length === 0) {
    container.innerHTML = '<div class="empty-state">No slots defined</div>';
    return;
  }
  
  slots.forEach(slot => {
    const group = document.createElement('div');
    group.className = 'slot-input-group';
    group.innerHTML = `
      <label><span class="slot-name">{{${slot.name}}}</span></label>
      <div class="slot-description">${escapeHtml(slot.description)}</div>
      <input type="text" data-slot="${slot.name}" value="${escapeHtml(slot.defaultValue)}" placeholder="${escapeHtml(slot.defaultValue)}">
      <div class="slot-default">Default: ${escapeHtml(slot.defaultValue)}</div>
    `;
    container.appendChild(group);
  });
}

// Get slot values from inputs
function getSlotValuesFromInputs(containerId) {
  const container = document.getElementById(containerId);
  const inputs = container.querySelectorAll('input[data-slot]');
  const values = {};
  inputs.forEach(input => {
    values[input.dataset.slot] = input.value;
  });
  return values;
}

// Render templates list
function renderTemplates() {
  if (templates.length === 0) {
    templateList.innerHTML = '<div class="empty-state">No templates</div>';
    return;
  }

  templateList.innerHTML = templates.map(t => `
    <div class="list-item" data-template="${t.id}">
      <div class="list-item-content">
        <span class="list-item-name">${escapeHtml(t.name || t.id)}</span>
        <span class="list-item-meta">${t.slots?.length || 0} slots</span>
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
  templateList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      showTemplateView(item.dataset.template);
    });
  });
}

async function openTemplateDetail(id) {
  try {
    const res = await fetch(`/api/templates/${id}`);
    const data = await res.json();
    
    document.getElementById('templateDetailId').textContent = id;
    document.getElementById('templateDetailName').value = data.name || '';
    document.getElementById('templateDetailDescription').value = data.description || '';
    document.getElementById('templateDetailSlots').value = JSON.stringify(data.slots || [], null, 2);
    cmTemplateDetail.setValue(data.files?.['src/index.ts'] || '');
    
    templateDetailModal.classList.remove('hidden');
    setTimeout(() => cmTemplateDetail.refresh(), 10);
  } catch (err) {
    alert('Failed to load template: ' + err.message);
  }
}

// Update template buttons in worker modal
function updateTemplateSelects() {
  const container = document.getElementById('templateButtonsContainer');
  if (!container) return;
  
  if (templates.length === 0) {
    container.innerHTML = '<div class="template-buttons-empty">No templates available. Create a template first.</div>';
    return;
  }
  
  container.innerHTML = templates.map(t => `
    <button class="template-button" data-template-id="${escapeHtml(t.id)}">
      <div class="template-button-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <span class="template-button-name">${escapeHtml(t.name || t.id)}</span>
      ${t.description ? `<span class="template-button-desc">${escapeHtml(t.description)}</span>` : ''}
    </button>
  `).join('');
  
  // Add click handlers
  container.querySelectorAll('.template-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const templateId = btn.dataset.templateId;
      if (templateId && selectedTenant) {
        addWorkerModal.classList.add('hidden');
        navigateTo(`/tenants/${selectedTenant}/create-from-template/${templateId}`);
      }
    });
  });
}

// Override createWorker to handle templates
const originalCreateWorker = createWorker;
async function createWorker() {
  const workerType = document.querySelector('input[name="workerType"]:checked')?.value;
  
  if (workerType === 'template') {
    await createWorkerFromTemplate();
  } else {
    // Call original standard worker creation
    if (!selectedTenant) return;
    const id = document.getElementById('newWorkerId').value.trim();
    if (!id) return;

    let env = {};
    const envText = document.getElementById('newWorkerEnv').value.trim();
    if (envText) {
      try {
        env = JSON.parse(envText);
      } catch {
        alert('Invalid JSON for environment variables');
        return;
      }
    }

    const outboundWorkerId = document.getElementById('workerOutboundSelect').value || undefined;
    const tailSelect = document.getElementById('workerTailSelect');
    const tailWorkerIds = Array.from(tailSelect.selectedOptions).map(o => o.value).filter(Boolean);

    try {
      await fetch(`/api/tenants/${selectedTenant}/workers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id, 
          files,
          env: Object.keys(env).length > 0 ? env : undefined,
          outboundWorkerId,
          tailWorkerIds: tailWorkerIds.length > 0 ? tailWorkerIds : undefined,
        }),
      });
      addWorkerModal.classList.add('hidden');
      await loadWorkers(selectedTenant);
      navigateTo(`/tenants/${selectedTenant}/workers/${id}`);
    } catch (err) {
      alert('Failed to create worker: ' + err.message);
    }
  }
}

async function createWorkerFromTemplate() {
  if (!selectedTenant || !selectedTemplateForWorker) {
    alert('Please select a template');
    return;
  }
  
  const id = document.getElementById('templateNewWorkerId').value.trim();
  if (!id) {
    alert('Please enter a Worker ID');
    return;
  }
  
  const slotValues = getSlotValuesFromInputs('workerTemplateSlots');
  
  try {
    // Generate files from template
    const genRes = await fetch(`/api/templates/${selectedTemplateForWorker.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotValues }),
    });
    const genData = await genRes.json();
    
    if (!genRes.ok) {
      throw new Error(genData.error || 'Failed to generate from template');
    }
    
    // Create worker with generated files
    await fetch(`/api/tenants/${selectedTenant}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id, 
        files: genData.files,
      }),
    });
    
    addWorkerModal.classList.add('hidden');
    await loadWorkers(selectedTenant);
    navigateTo(`/tenants/${selectedTenant}/workers/${id}`);
  } catch (err) {
    alert('Failed to create worker from template: ' + err.message);
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
    // Navigate to the new tenant's page
    showTenantView(id);
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

  // Get outbound/tail worker associations
  const outboundWorkerId = document.getElementById('tenantOutboundWorker').value || undefined;
  const tailSelect = document.getElementById('tenantTailWorkers');
  const tailWorkerIds = Array.from(tailSelect.selectedOptions).map(o => o.value).filter(Boolean);

  try {
    await fetch(`/api/tenants/${tenantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        env, 
        compatibilityDate, 
        compatibilityFlags,
        outboundWorkerId,
        tailWorkerIds: tailWorkerIds.length > 0 ? tailWorkerIds : undefined,
      }),
    });
    tenantDetailModal.classList.add('hidden');
    await loadTenants();
  } catch (err) {
    alert('Failed to save tenant: ' + err.message);
  }
}

// Save tenant from tenant view
async function saveTenantFromView() {
  const tenantId = document.getElementById('tenantViewId').textContent;
  
  let env = {};
  const envText = document.getElementById('tenantEnvInput').value.trim();
  if (envText) {
    try {
      env = JSON.parse(envText);
    } catch {
      alert('Invalid JSON for environment variables');
      return;
    }
  }

  const compatibilityDate = document.getElementById('tenantCompatDateInput').value.trim() || undefined;
  const flagsText = document.getElementById('tenantCompatFlagsInput').value.trim();
  const compatibilityFlags = flagsText ? flagsText.split(',').map(f => f.trim()).filter(Boolean) : undefined;

  const outboundWorkerId = document.getElementById('tenantOutboundInput').value || undefined;
  const tailSelect = document.getElementById('tenantTailInput');
  const tailWorkerIds = Array.from(tailSelect.selectedOptions).map(o => o.value).filter(Boolean);

  try {
    await fetch(`/api/tenants/${tenantId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        env, 
        compatibilityDate, 
        compatibilityFlags,
        outboundWorkerId,
        tailWorkerIds: tailWorkerIds.length > 0 ? tailWorkerIds : undefined,
      }),
    });
    await loadTenants();
    alert('Tenant saved successfully');
  } catch (err) {
    alert('Failed to save tenant: ' + err.message);
  }
}

// Delete tenant from tenant view
async function deleteTenantFromView() {
  const tenantId = document.getElementById('tenantViewId').textContent;
  if (!confirm(`Delete tenant "${tenantId}" and all its workers?`)) return;

  try {
    await fetch(`/api/tenants/${tenantId}`, { method: 'DELETE' });
    selectedTenant = null;
    selectedWorker = null;
    workersSection.style.display = 'none';
    updateContext();
    await loadTenants();
    showView('welcome');
  } catch (err) {
    alert('Failed to delete tenant: ' + err.message);
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

// Outbound worker CRUD
async function createOutboundWorker() {
  const id = document.getElementById('newOutboundId').value.trim();
  const name = document.getElementById('newOutboundName').value.trim();
  const code = cmNewOutbound.getValue();
  
  if (!id || !name) {
    alert('Please fill in ID and Name');
    return;
  }

  try {
    const res = await fetch('/api/outbound-workers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name,
        files: {
          'src/index.ts': code,
          'package.json': JSON.stringify({ name: id, main: 'src/index.ts' }, null, 2),
        },
      }),
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create');
    }
    
    addOutboundModal.classList.add('hidden');
    await loadOutboundWorkers();
  } catch (err) {
    alert('Failed to create outbound worker: ' + err.message);
  }
}

async function createDefaultOutbound() {
  try {
    await fetch('/api/outbound-workers/create-default', { method: 'POST' });
    await loadOutboundWorkers();
  } catch (err) {
    alert('Failed to create default outbound: ' + err.message);
  }
}

async function saveOutboundWorker() {
  const id = document.getElementById('outboundDetailId').textContent;
  const name = document.getElementById('outboundDetailName').value.trim();
  const code = cmOutboundDetail.getValue();

  try {
    await fetch(`/api/outbound-workers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        files: {
          'src/index.ts': code,
          'package.json': JSON.stringify({ name: id, main: 'src/index.ts' }, null, 2),
        },
      }),
    });
    outboundDetailModal.classList.add('hidden');
    await loadOutboundWorkers();
  } catch (err) {
    alert('Failed to save outbound worker: ' + err.message);
  }
}

async function deleteOutboundWorker() {
  const id = document.getElementById('outboundDetailId').textContent;
  if (!confirm(`Delete outbound worker "${id}"?`)) return;

  try {
    await fetch(`/api/outbound-workers/${id}`, { method: 'DELETE' });
    outboundDetailModal.classList.add('hidden');
    await loadOutboundWorkers();
  } catch (err) {
    alert('Failed to delete outbound worker: ' + err.message);
  }
}

// Tail worker CRUD
async function createTailWorker() {
  const id = document.getElementById('newTailId').value.trim();
  const name = document.getElementById('newTailName').value.trim();
  const code = cmNewTail.getValue();
  
  if (!id || !name) {
    alert('Please fill in ID and Name');
    return;
  }

  try {
    const res = await fetch('/api/tail-workers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name,
        files: {
          'src/index.ts': code,
          'package.json': JSON.stringify({ name: id, main: 'src/index.ts' }, null, 2),
        },
      }),
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create');
    }
    
    addTailModal.classList.add('hidden');
    await loadTailWorkers();
  } catch (err) {
    alert('Failed to create tail worker: ' + err.message);
  }
}

async function createDefaultTail() {
  try {
    await fetch('/api/tail-workers/create-default', { method: 'POST' });
    await loadTailWorkers();
  } catch (err) {
    alert('Failed to create default tail: ' + err.message);
  }
}

async function saveTailWorker() {
  const id = document.getElementById('tailDetailId').textContent;
  const name = document.getElementById('tailDetailName').value.trim();
  const code = cmTailDetail.getValue();

  try {
    await fetch(`/api/tail-workers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        files: {
          'src/index.ts': code,
          'package.json': JSON.stringify({ name: id, main: 'src/index.ts' }, null, 2),
        },
      }),
    });
    tailDetailModal.classList.add('hidden');
    await loadTailWorkers();
  } catch (err) {
    alert('Failed to save tail worker: ' + err.message);
  }
}

async function deleteTailWorker() {
  const id = document.getElementById('tailDetailId').textContent;
  if (!confirm(`Delete tail worker "${id}"?`)) return;

  try {
    await fetch(`/api/tail-workers/${id}`, { method: 'DELETE' });
    tailDetailModal.classList.add('hidden');
    await loadTailWorkers();
  } catch (err) {
    alert('Failed to delete tail worker: ' + err.message);
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
        // Click on tenant opens tenant view
        showTenantView(item.dataset.tenant);
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
        // Navigate to worker view
        await showWorkerView(selectedTenant, item.dataset.worker);
      }
    });
  });
}

function renderOutboundWorkers() {
  if (outboundWorkers.length === 0) {
    outboundList.innerHTML = '<div class="empty-state">No outbound workers</div>';
    return;
  }

  outboundList.innerHTML = outboundWorkers.map(w => `
    <div class="list-item" data-outbound="${w.id}">
      <div class="list-item-content">
        <span class="list-item-name">${escapeHtml(w.name || w.id)}</span>
        <span class="list-item-meta">${formatDate(w.updatedAt)}</span>
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
  outboundList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      showOutboundView(item.dataset.outbound);
    });
  });
}

function renderTailWorkers() {
  if (tailWorkers.length === 0) {
    tailList.innerHTML = '<div class="empty-state">No tail workers</div>';
    return;
  }

  tailList.innerHTML = tailWorkers.map(w => `
    <div class="list-item" data-tail="${w.id}">
      <div class="list-item-content">
        <span class="list-item-name">${escapeHtml(w.name || w.id)}</span>
        <span class="list-item-meta">${formatDate(w.updatedAt)}</span>
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
  tailList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      showTailView(item.dataset.tail);
    });
  });
}

// Update outbound worker selects in modals
function updateOutboundSelects() {
  const selects = [
    document.getElementById('tenantOutboundWorker'),
    document.getElementById('workerOutboundSelect'),
  ];
  
  selects.forEach(select => {
    if (!select) return;
    const currentValue = select.value;
    // Keep first option (None)
    const firstOption = select.options[0];
    select.innerHTML = '';
    select.appendChild(firstOption);
    
    outboundWorkers.forEach(w => {
      const option = document.createElement('option');
      option.value = w.id;
      option.textContent = w.name || w.id;
      select.appendChild(option);
    });
    
    // Restore selection if still valid
    if (currentValue && outboundWorkers.some(w => w.id === currentValue)) {
      select.value = currentValue;
    }
  });
}

// Update tail worker selects in modals
function updateTailSelects() {
  const selects = [
    document.getElementById('tenantTailWorkers'),
    document.getElementById('workerTailSelect'),
  ];
  
  selects.forEach(select => {
    if (!select) return;
    const selectedValues = Array.from(select.selectedOptions).map(o => o.value);
    select.innerHTML = '';
    
    tailWorkers.forEach(w => {
      const option = document.createElement('option');
      option.value = w.id;
      option.textContent = w.name || w.id;
      if (selectedValues.includes(w.id)) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  });
}

async function openOutboundDetail(id) {
  try {
    const res = await fetch(`/api/outbound-workers/${id}`);
    const data = await res.json();
    
    document.getElementById('outboundDetailId').textContent = id;
    document.getElementById('outboundDetailName').value = data.name || '';
    cmOutboundDetail.setValue(data.files?.['src/index.ts'] || '');
    
    outboundDetailModal.classList.remove('hidden');
    setTimeout(() => cmOutboundDetail.refresh(), 10);
  } catch (err) {
    alert('Failed to load outbound worker: ' + err.message);
  }
}

async function openTailDetail(id) {
  try {
    const res = await fetch(`/api/tail-workers/${id}`);
    const data = await res.json();
    
    document.getElementById('tailDetailId').textContent = id;
    document.getElementById('tailDetailName').value = data.name || '';
    cmTailDetail.setValue(data.files?.['src/index.ts'] || '');
    
    tailDetailModal.classList.remove('hidden');
    setTimeout(() => cmTailDetail.refresh(), 10);
  } catch (err) {
    alert('Failed to load tail worker: ' + err.message);
  }
}

async function openTenantDetail(tenantId) {
  try {
    const res = await fetch(`/api/tenants/${tenantId}`);
    const data = await res.json();
    
    document.getElementById('tenantDetailId').textContent = tenantId;
    document.getElementById('tenantEnvEditor').value = JSON.stringify(data.config?.env || {}, null, 2);
    document.getElementById('tenantCompatDate').value = data.config?.compatibilityDate || '';
    document.getElementById('tenantCompatFlags').value = (data.config?.compatibilityFlags || []).join(', ');
    
    // Set outbound worker selection
    const outboundSelect = document.getElementById('tenantOutboundWorker');
    outboundSelect.value = data.associations?.outboundWorkerId || '';
    
    // Set tail worker selections
    const tailSelect = document.getElementById('tenantTailWorkers');
    const selectedTails = data.associations?.tailWorkerIds || [];
    Array.from(tailSelect.options).forEach(option => {
      option.selected = selectedTails.includes(option.value);
    });
    
    tenantDetailModal.classList.remove('hidden');
  } catch (err) {
    alert('Failed to load tenant: ' + err.message);
  }
}

// Selection (updates sidebar state)
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

// Select tenant in sidebar (for when navigating from views)
function updateSidebarTenantSelection(tenantId) {
  selectedTenant = tenantId;
  selectedTenantBadge.textContent = tenantId;
  workersSection.style.display = 'block';
  
  const items = tenantList.querySelectorAll('.list-item');
  items.forEach(item => {
    item.classList.toggle('selected', item.dataset.tenant === tenantId);
  });
  
  loadWorkers(tenantId);
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
  // Context is now shown via breadcrumbs in the worker view
  // This function is kept for backward compatibility but does nothing
}

// File management
function loadExample(name) {
  files = { ...EXAMPLES[name] };
  // Keep the selected worker - user can save manually if they want
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
  if (cmEditor) {
    cmEditor.setValue(files[name] || '');
    cmEditor.setOption('mode', getModeForFile(name));
    cmEditor.refresh();
  }
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
      <div class="output-label">Timing ${timing.cached ? '<span class="cache-badge">cached</span>' : ''}</div>
      <div class="timing-grid">
        <div class="timing-item">
          <div class="timing-value">${timing.cached ? '0' : timing.buildTime}ms</div>
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
      <div class="output-label">Build Info ${buildInfo.cached ? '<span class="cache-badge">cached</span>' : ''}</div>
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

// Info tooltips
function setupInfoTooltips() {
  // Create tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'info-tooltip';
  document.body.appendChild(tooltip);
  
  // Setup hover handlers for all info icons
  document.querySelectorAll('.info-icon[data-info]').forEach(icon => {
    icon.addEventListener('mouseenter', (e) => {
      const key = e.currentTarget.dataset.info;
      const text = DESCRIPTIONS[key];
      if (!text) return;
      
      tooltip.textContent = text;
      
      // Position tooltip to the right of the icon
      const rect = e.currentTarget.getBoundingClientRect();
      tooltip.style.left = `${rect.right + 8}px`;
      tooltip.style.top = `${rect.top - 4}px`;
      
      // Ensure tooltip stays within viewport
      requestAnimationFrame(() => {
        const tooltipRect = tooltip.getBoundingClientRect();
        if (tooltipRect.right > window.innerWidth - 16) {
          // Position to the left instead
          tooltip.style.left = `${rect.left - tooltipRect.width - 8}px`;
        }
        if (tooltipRect.bottom > window.innerHeight - 16) {
          tooltip.style.top = `${window.innerHeight - tooltipRect.height - 16}px`;
        }
      });
      
      tooltip.classList.add('visible');
    });
    
    icon.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
  });
}

// Start
init();
