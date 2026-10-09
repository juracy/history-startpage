const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_PAGE_SIZE = 5000;
const VISITS_CONCURRENCY = 100;
const DEFAULT_GIT_HOSTS = ['github.com', 'gitlab.com'];

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const EXCLUDED_HOSTS = new Set([
  'localhost', '127.0.0.1'
]);

const GIT_STOP_KEYWORDS = new Set([
  '-', 'tree', 'blob', 'raw', 'blame', 'edit', 'commits', 'commit',
  'branches', 'pull', 'pulls', 'merge_requests', 'issues', 'pipelines',
  'jobs', 'activity', 'settings', 'releases', 'tags', 'compare', 'actions',
  'wiki', 'wikis', 'discussions', 'security', 'projects', 'network',
  'graphs', 'pulse', 'milestones', 'labels', 'packages', 'deployments',
  'environments', 'forks', 'stargazers', 'watchers', 'find', 'search'
]);

let currentGitHosts = [...DEFAULT_GIT_HOSTS];

// Cache do histórico já processado: [{ url: URL, visits }], do acesso mais recente ao mais antigo
let historyEntries = null;

// --- Utilitários ---

function normalizeHost(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;

  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '') || null;
  } catch (e) {
    return null;
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

function parseWebUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;

    const host = url.hostname.replace(/^www\./, '');
    if (!host || EXCLUDED_HOSTS.has(host)) return null;

    return url;
  } catch (e) {
    return null;
  }
}

// --- Gerenciamento de Configurações (Storage) ---

async function loadGitHosts() {
  try {
    const data = await chrome.storage.sync.get({ gitHosts: DEFAULT_GIT_HOSTS });
    const stored = Array.isArray(data.gitHosts) ? data.gitHosts : DEFAULT_GIT_HOSTS;
    currentGitHosts = [...new Set(stored.map(normalizeHost).filter(Boolean))];
  } catch (e) {
    console.error('Falha ao carregar hosts Git:', e);
    currentGitHosts = [...DEFAULT_GIT_HOSTS];
  }
  return currentGitHosts;
}

async function saveGitHosts(hosts) {
  try {
    await chrome.storage.sync.set({ gitHosts: hosts });
  } catch (e) {
    console.error('Falha ao salvar hosts Git:', e);
    showSettingsError(`Não foi possível salvar: ${e.message}`);
    return false;
  }

  showSettingsError('');
  currentGitHosts = hosts;
  renderModalList();
  renderDashboard();
  return true;
}

function parseGitRepository(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  // Os dois primeiros segmentos (dono/repositório) nunca são tratados como palavras de parada
  const cleanSegments = segments.slice(0, 2);
  for (const seg of segments.slice(2)) {
    if (GIT_STOP_KEYWORDS.has(seg)) break;
    cleanSegments.push(seg);
  }

  const repoName = cleanSegments[cleanSegments.length - 1];
  const groupSegments = cleanSegments.slice(0, cleanSegments.length - 1);
  const fullRepoPath = cleanSegments.join('/');

  return {
    projectGroup: safeDecode(groupSegments.join('/')),
    repoName: safeDecode(repoName),
    repoUrl: `${url.origin}/${fullRepoPath}`,
    uniqueKey: `${url.host}/${fullRepoPath}`
  };
}

// --- Carregamento do Histórico ---

async function fetchHistoryItems(startTime) {
  const seen = new Map();
  let endTime = Date.now();

  // Pagina pelo histórico usando endTime, já que history.search limita a quantidade de resultados
  while (true) {
    const page = await chrome.history.search({
      text: '',
      startTime,
      endTime,
      maxResults: HISTORY_PAGE_SIZE
    });

    let added = 0;
    let oldest = endTime;
    for (const item of page) {
      if (!seen.has(item.id)) {
        seen.set(item.id, item);
        added++;
      }
      if (item.lastVisitTime < oldest) oldest = item.lastVisitTime;
    }

    if (page.length < HISTORY_PAGE_SIZE) break;
    endTime = added > 0 ? oldest + 1 : oldest;
  }

  return [...seen.values()];
}

async function countRecentVisits(rawUrl, startTime) {
  const visits = await chrome.history.getVisits({ url: rawUrl });
  return visits.filter(v => v.visitTime >= startTime).length;
}

async function buildHistoryEntries() {
  const startTime = Date.now() - ONE_MONTH_MS;
  const items = await fetchHistoryItems(startTime);

  const candidates = [];
  for (const item of items) {
    const url = parseWebUrl(item.url);
    if (url) candidates.push({ url, rawUrl: item.url, lastVisitTime: item.lastVisitTime });
  }

  // visitCount do history.search é o total histórico; conta apenas as visitas dentro da janela
  const entries = [];
  for (let i = 0; i < candidates.length; i += VISITS_CONCURRENCY) {
    const batch = candidates.slice(i, i + VISITS_CONCURRENCY);
    const counts = await Promise.all(batch.map(c => countRecentVisits(c.rawUrl, startTime)));
    batch.forEach((c, j) => {
      if (counts[j] > 0) {
        entries.push({ url: c.url, lastVisitTime: c.lastVisitTime, visits: counts[j] });
      }
    });
  }

  entries.sort((a, b) => b.lastVisitTime - a.lastVisitTime);
  return entries;
}

async function loadHistory() {
  renderMessage(document.getElementById('git-repos'), 'Carregando…');
  renderMessage(document.getElementById('top-domains'), 'Carregando…');

  try {
    historyEntries = await buildHistoryEntries();
  } catch (e) {
    console.error('Falha ao carregar histórico:', e);
    renderMessage(document.getElementById('git-repos'), 'Erro ao carregar o histórico.');
    renderMessage(document.getElementById('top-domains'), 'Erro ao carregar o histórico.');
    return;
  }

  renderDashboard();
}

// --- Processamento do Histórico ---

function categorizeHistory(entries) {
  const gitHosts = new Set(currentGitHosts);
  const projectGroups = new Map();
  const domainCounts = new Map();

  for (const { url, visits } of entries) {
    const hostname = url.hostname.replace(/^www\./, '');

    if (gitHosts.has(hostname)) {
      const repoInfo = parseGitRepository(url);
      if (repoInfo) {
        const groupKey = `${hostname} › ${repoInfo.projectGroup}`;

        if (!projectGroups.has(groupKey)) {
          projectGroups.set(groupKey, new Map());
        }

        const groupRepos = projectGroups.get(groupKey);
        const current = groupRepos.get(repoInfo.uniqueKey) || {
          name: repoInfo.repoName,
          url: repoInfo.repoUrl,
          count: 0
        };
        current.count += visits;
        groupRepos.set(repoInfo.uniqueKey, current);
        continue;
      }
    }

    // Demais domínios: agrupa por host + porta; o link usa a origem do acesso mais recente
    const domainKey = url.host.replace(/^www\./, '');
    const currentDomain = domainCounts.get(domainKey) || {
      name: domainKey,
      url: url.origin,
      count: 0
    };
    currentDomain.count += visits;
    domainCounts.set(domainKey, currentDomain);
  }

  return { projectGroups, domainCounts };
}

function renderDashboard() {
  if (!historyEntries) return;

  const { projectGroups, domainCounts } = categorizeHistory(historyEntries);
  renderCategorizedRepos(projectGroups);
  renderTopDomains(domainCounts);
}

// --- Renderização na Interface ---

function renderMessage(container, text) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = text;
  container.replaceChildren(div);
}

function createItemCard({ name, url, count }) {
  const a = document.createElement('a');
  a.className = 'item-card';
  a.href = url;

  const nameEl = document.createElement('span');
  nameEl.className = 'item-name';
  nameEl.title = url;
  nameEl.textContent = name;

  const countEl = document.createElement('span');
  countEl.className = 'item-count';
  countEl.textContent = count;

  a.append(nameEl, countEl);
  return a;
}

function renderCategorizedRepos(projectGroups) {
  const container = document.getElementById('git-repos');

  if (projectGroups.size === 0) {
    renderMessage(container, 'Nenhum repositório acessado no último mês.');
    return;
  }

  container.replaceChildren();

  const sortedGroups = Array.from(projectGroups.entries())
    .map(([groupName, reposMap]) => {
      const repos = Array.from(reposMap.values()).sort((a, b) => b.count - a.count);
      const totalVisits = repos.reduce((acc, r) => acc + r.count, 0);
      return { groupName, repos, totalVisits };
    })
    .sort((a, b) => b.totalVisits - a.totalVisits)
    .slice(0, 8);

  for (const group of sortedGroups) {
    const groupBlock = document.createElement('div');
    groupBlock.className = 'project-group';

    const groupTitle = document.createElement('div');
    groupTitle.className = 'project-group-title';
    groupTitle.textContent = group.groupName;
    groupBlock.appendChild(groupTitle);

    const repoList = document.createElement('div');
    repoList.className = 'sub-list';

    for (const repo of group.repos.slice(0, 5)) {
      repoList.appendChild(createItemCard(repo));
    }

    groupBlock.appendChild(repoList);
    container.appendChild(groupBlock);
  }
}

function renderTopDomains(domainCounts) {
  const container = document.getElementById('top-domains');

  const top = Array.from(domainCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  if (top.length === 0) {
    renderMessage(container, 'Nenhum domínio registrado.');
    return;
  }

  container.replaceChildren(...top.map(createItemCard));
}

// --- Controles do Modal de Configuração ---

function showSettingsError(message) {
  const el = document.getElementById('settings-error');
  el.textContent = message;
  el.hidden = !message;
}

function renderModalList() {
  const listEl = document.getElementById('registered-domains');
  listEl.replaceChildren();

  for (const domain of currentGitHosts) {
    const div = document.createElement('div');
    div.className = 'tag-item';

    const label = document.createElement('span');
    label.textContent = domain;

    const btn = document.createElement('button');
    btn.className = 'btn-delete';
    btn.title = 'Remover';
    btn.textContent = '×';
    btn.addEventListener('click', () => {
      saveGitHosts(currentGitHosts.filter(h => h !== domain));
    });

    div.append(label, btn);
    listEl.appendChild(div);
  }
}

function setupModalListeners() {
  const dialog = document.getElementById('settings-dialog');
  const openBtn = document.getElementById('open-settings-btn');
  const closeBtn = document.getElementById('close-settings-btn');
  const addBtn = document.getElementById('add-domain-btn');
  const input = document.getElementById('domain-input');

  openBtn.addEventListener('click', () => {
    showSettingsError('');
    renderModalList();
    dialog.showModal();
    input.focus();
  });

  closeBtn.addEventListener('click', () => dialog.close());

  // Fecha apenas em cliques no backdrop, não no padding do próprio dialog
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) dialog.close();
  });

  const handleAdd = async () => {
    if (!input.value.trim()) return;

    const host = normalizeHost(input.value);
    if (!host) {
      showSettingsError('Domínio inválido.');
      return;
    }

    if (currentGitHosts.includes(host)) {
      input.value = '';
      showSettingsError('');
      return;
    }

    if (await saveGitHosts([...currentGitHosts, host])) {
      input.value = '';
    }
  };

  addBtn.addEventListener('click', handleAdd);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAdd();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupModalListeners();
  await loadGitHosts();
  await loadHistory();
});
