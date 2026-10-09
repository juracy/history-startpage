const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_PERIODS = [
  { id: '1d', label: '24 horas', phrase: 'nas últimas 24 horas', ms: DAY_MS },
  { id: '7d', label: '1 semana', phrase: 'na última semana', ms: 7 * DAY_MS },
  { id: '30d', label: '1 mês', phrase: 'no último mês', ms: 30 * DAY_MS },
  { id: '90d', label: '3 meses', phrase: 'nos últimos 3 meses', ms: 90 * DAY_MS },
  { id: '180d', label: '6 meses', phrase: 'nos últimos 6 meses', ms: 180 * DAY_MS },
  { id: '365d', label: '1 ano', phrase: 'no último ano', ms: 365 * DAY_MS }
];
const DEFAULT_PERIOD_ID = '30d';
const HISTORY_PAGE_SIZE = 5000;
const VISITS_CONCURRENCY = 100;
const DEFAULT_GIT_HOSTS = ['github.com', 'gitlab.com'];
const SEARCH_DEBOUNCE_MS = 200;
const PERIOD_DEBOUNCE_MS = 400;

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
  'environments', 'forks', 'stargazers', 'watchers', 'find', 'search',
  'agents', 'custom-properties', 'insights', 'models', 'codespaces',
  'attestations', 'rules', 'contributors', 'community', 'sponsors',
  'archive', 'subscription'
]);

let currentGitHosts = [...DEFAULT_GIT_HOSTS];

let currentPeriod = findPeriod(DEFAULT_PERIOD_ID);

// Incrementado a cada carregamento; resultados de um carregamento anterior são descartados
let historyLoadId = 0;

// Agrupamentos do usuário: [{ id, title, pattern }]; a primeira regra que casar vence
let currentUrlGroups = [];

// Cache do histórico já processado: [{ url: URL, visits }], do acesso mais recente ao mais antigo
let historyEntries = null;

// Página raiz visitada de cada host (sem "www."), de onde vem o ícone do site
let hostIconPages = new Map();

// Termos da busca já normalizados; vazio = sem filtro
let searchTerms = [];

// --- Utilitários ---

function findPeriod(id) {
  return HISTORY_PERIODS.find(p => p.id === id) || null;
}

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

// Raiz = caminho com exatamente rootSegmentCount segmentos; a query é ignorada,
// mas rotas de SPA no hash (#/... ou #!/...) contam como página interna
function isRootUrl(url, rootSegmentCount) {
  const segmentCount = url.pathname.split('/').filter(Boolean).length;
  return segmentCount === rootSegmentCount && !/^#!?\//.test(url.hash);
}

// Remove contadores de notificação do início, como "(17) Inbox"
function cleanTitle(title) {
  return (title || '').trim().replace(/^\(\d+\+?\)\s*/, '');
}

// Remove do título o que o card já mostra: "GitHub - ", "owner/repo: " e " · GitLab"
function stripRepoTitle(title, fullPath) {
  let result = title.replace(/^GitHub - /, '').replace(/\s*·\s*GitLab$/, '');
  const normalized = result.replace(/\s*\/\s*/g, '/');
  if (normalized.toLowerCase().startsWith(fullPath.toLowerCase())) {
    result = normalized.slice(fullPath.length).replace(/^[\s:·|–-]+/, '');
  }
  return result.trim();
}

// Minúsculas e sem acentos, para que "configuracao" encontre "Configuração"
function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function parseSearchTerms(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

// Todos os termos precisam aparecer na URL ou no título (em qualquer ordem)
function matchesSearch(searchText) {
  return searchTerms.every(term => searchText.includes(term));
}

function normalizePattern(value) {
  return String(value ?? '').trim().toLowerCase();
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

// Serializa as gravações: cada uma calcula a nova lista a partir do que a anterior salvou,
// evitando que cliques rápidos sobrescrevam uns aos outros
let saveQueue = Promise.resolve();

function enqueueSave(task) {
  const run = saveQueue.then(task);
  saveQueue = run.catch(() => {});
  return run;
}

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

function saveGitHosts(update) {
  return enqueueSave(async () => {
    const hosts = update(currentGitHosts);
    if (hosts === currentGitHosts) return true;

    try {
      await chrome.storage.sync.set({ gitHosts: hosts });
    } catch (e) {
      console.error('Falha ao salvar hosts Git:', e);
      showDialogError('settings-error', `Não foi possível salvar: ${e.message}`);
      return false;
    }

    showDialogError('settings-error', '');
    currentGitHosts = hosts;
    renderModalList();
    renderDashboard();
    return true;
  });
}

async function loadUrlGroups() {
  try {
    const data = await chrome.storage.sync.get({ urlGroups: [] });
    const stored = Array.isArray(data.urlGroups) ? data.urlGroups : [];
    const seenIds = new Set();
    const seenPatterns = new Set();

    currentUrlGroups = [];
    for (const g of stored) {
      if (!g || typeof g.title !== 'string' || typeof g.pattern !== 'string') continue;

      const title = g.title.trim();
      const pattern = normalizePattern(g.pattern);
      if (!title || !pattern || seenPatterns.has(pattern)) continue;

      // IDs repetidos (edição manual ou merge entre dispositivos) ganham um novo
      let id = String(g.id || '');
      if (!id || seenIds.has(id)) id = crypto.randomUUID();

      seenIds.add(id);
      seenPatterns.add(pattern);
      currentUrlGroups.push({ id, title, pattern });
    }
  } catch (e) {
    console.error('Falha ao carregar agrupamentos:', e);
    currentUrlGroups = [];
  }
  return currentUrlGroups;
}

function saveUrlGroups(update) {
  return enqueueSave(async () => {
    const groups = update(currentUrlGroups);
    if (groups === currentUrlGroups) return true;

    try {
      await chrome.storage.sync.set({ urlGroups: groups });
    } catch (e) {
      console.error('Falha ao salvar agrupamentos:', e);
      showDialogError('groups-error', `Não foi possível salvar: ${e.message}`);
      return false;
    }

    showDialogError('groups-error', '');
    currentUrlGroups = groups;
    renderGroupsModalList();
    renderDashboard();
    return true;
  });
}

async function loadHistoryPeriod() {
  try {
    const data = await chrome.storage.sync.get({ historyPeriod: DEFAULT_PERIOD_ID });
    currentPeriod = findPeriod(data.historyPeriod) || findPeriod(DEFAULT_PERIOD_ID);
  } catch (e) {
    console.error('Falha ao carregar o período:', e);
    currentPeriod = findPeriod(DEFAULT_PERIOD_ID);
  }
  return currentPeriod;
}

// A troca vale na hora; falha ao salvar só impede que a escolha valha para as próximas abas
function saveHistoryPeriod(id) {
  return enqueueSave(async () => {
    try {
      await chrome.storage.sync.set({ historyPeriod: id });
    } catch (e) {
      console.error('Falha ao salvar o período:', e);
    }
  });
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
    fullPath: safeDecode(fullRepoPath),
    projectGroup: safeDecode(groupSegments.join('/')),
    repoName: safeDecode(repoName),
    repoUrl: `${url.origin}/${fullRepoPath}`,
    uniqueKey: `${url.host}/${fullRepoPath}`,
    isRoot: isRootUrl(url, cleanSegments.length)
  };
}

// --- Carregamento do Histórico ---

// isCurrent() falso = carregamento substituído por outro; a função para e devolve null
async function fetchHistoryItems(startTime, isCurrent) {
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
    if (!isCurrent()) return null;

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

async function buildHistoryEntries(periodMs, isCurrent) {
  const startTime = Date.now() - periodMs;
  const items = await fetchHistoryItems(startTime, isCurrent);
  if (!items) return null;

  const candidates = [];
  for (const item of items) {
    const url = parseWebUrl(item.url);
    if (url) {
      candidates.push({
        url,
        rawUrl: item.url,
        title: cleanTitle(item.title),
        lastVisitTime: item.lastVisitTime
      });
    }
  }

  // visitCount do history.search é o total histórico; conta apenas as visitas dentro da janela
  const entries = [];
  for (let i = 0; i < candidates.length; i += VISITS_CONCURRENCY) {
    const batch = candidates.slice(i, i + VISITS_CONCURRENCY);
    const counts = await Promise.all(batch.map(c => countRecentVisits(c.rawUrl, startTime)));
    if (!isCurrent()) return null;
    batch.forEach((c, j) => {
      if (counts[j] > 0) {
        entries.push({
          url: c.url,
          // O cache de favicons do Chrome é indexado pela URL como está no histórico
          rawUrl: c.rawUrl,
          title: c.title,
          lastVisitTime: c.lastVisitTime,
          visits: counts[j],
          // Como nos agrupamentos, só host + caminho: query e hash (redirects, buscas) não contam
          searchText: normalizeSearchText(`${safeDecode(c.url.host + c.url.pathname)}\n${c.title}`)
        });
      }
    });
  }

  entries.sort((a, b) => b.lastVisitTime - a.lastVisitTime);
  return entries;
}

// O ícone do site sai da raiz do host: páginas internas podem trocar o favicon
// (status de pipeline, contador de não lidas). Entre várias raízes, vale a mais recente
function buildHostIconPages(entries) {
  const pages = new Map();
  for (const { url, rawUrl } of entries) {
    const host = url.host.replace(/^www\./, '');
    if (!pages.has(host) && isRootUrl(url, 0)) pages.set(host, rawUrl);
  }
  return pages;
}

// Invalida o carregamento em andamento e mostra o estado de carregamento.
// Sem cache nesse intervalo, para que busca ou configurações não redesenhem dados de outro período
function startHistoryLoading() {
  historyEntries = null;
  updateUrlGroupsVisibility();
  renderMessage(document.getElementById('url-groups'), 'Carregando…');
  renderMessage(document.getElementById('git-repos'), 'Carregando…');
  renderMessage(document.getElementById('top-domains'), 'Carregando…');
  return ++historyLoadId;
}

async function loadHistory() {
  const loadId = startHistoryLoading();
  const isCurrent = () => loadId === historyLoadId;

  let entries;
  try {
    entries = await buildHistoryEntries(currentPeriod.ms, isCurrent);
  } catch (e) {
    if (loadId !== historyLoadId) return;
    console.error('Falha ao carregar histórico:', e);
    renderMessage(document.getElementById('url-groups'), 'Erro ao carregar o histórico.');
    renderMessage(document.getElementById('git-repos'), 'Erro ao carregar o histórico.');
    renderMessage(document.getElementById('top-domains'), 'Erro ao carregar o histórico.');
    return;
  }

  if (loadId !== historyLoadId) return;
  historyEntries = entries;
  hostIconPages = buildHostIconPages(entries);
  renderDashboard();
}

// --- Processamento do Histórico ---

// Acumula visitas e candidatos a título e a página do ícone; resolveAggregate reduz a
// { name, url, count, title, iconPageUrl }. matched indica se alguma URL do item casou com a busca
function newAggregate(name, url, allowFallback, hostIconPage) {
  return {
    name, url, count: 0, allowFallback, hostIconPage, rootTitle: '', topTitle: '', topTitleVisits: 0,
    rootPageUrl: '', topPageUrl: '', topPageVisits: 0, matched: false
  };
}

function trackVisit(target, pageUrl, title, visits, isRoot, matched) {
  target.count += visits;
  if (matched) target.matched = true;
  if (isRoot && !target.rootPageUrl) target.rootPageUrl = pageUrl;
  if (visits > target.topPageVisits) {
    target.topPageUrl = pageUrl;
    target.topPageVisits = visits;
  }
  if (!title) return;
  if (isRoot && !target.rootTitle) target.rootTitle = title;
  if (visits > target.topTitleVisits) {
    target.topTitle = title;
    target.topTitleVisits = visits;
  }
}

// Repositórios usam só o título da raiz; domínios caem para o da página mais visitada.
// O ícone segue a mesma regra, mas prefere a raiz do host: num repositório, as páginas de
// PR, MR e pipeline trocam o favicon pelo status do CI. Sem nenhuma raiz visitada, o
// Chrome procura um ícone qualquer do host a partir da URL do próprio item
function resolveAggregate({ name, url, count, allowFallback, hostIconPage, rootTitle, topTitle, rootPageUrl, topPageUrl }) {
  const title = rootTitle || (allowFallback ? topTitle : '');
  const iconPageUrl = hostIconPage || rootPageUrl || (allowFallback ? topPageUrl : '') || url;
  return { name, url, count, title: title === name ? '' : title, iconPageUrl };
}

// Com busca ativa, descarta os itens sem nenhuma URL encontrada
function resolveBucket(bucket) {
  for (const [key, aggregate] of bucket) {
    if (aggregate.matched) bucket.set(key, resolveAggregate(aggregate));
    else bucket.delete(key);
  }
}

// Casa o trecho só com host + caminho, para que query e hash (buscas, redirects) não contem
function findUrlGroupIndex(url) {
  if (currentUrlGroups.length === 0) return -1;
  const haystack = safeDecode(url.host + url.pathname).toLowerCase();
  return currentUrlGroups.findIndex(g => haystack.includes(g.pattern));
}

function categorizeHistory(entries) {
  const gitHosts = new Set(currentGitHosts);
  const userGroups = new Map(currentUrlGroups.map(g => [g.id, new Map()]));
  const projectGroups = new Map();
  const domainCounts = new Map();

  const classified = entries.map(entry => {
    const hostname = entry.url.hostname.replace(/^www\./, '');
    const repoInfo = gitHosts.has(hostname) ? parseGitRepository(entry.url) : null;
    const domainKey = entry.url.host.replace(/^www\./, '');
    const key = repoInfo ? `repo:${repoInfo.uniqueKey}` : `domain:${domainKey}`;
    return { ...entry, hostname, repoInfo, domainKey, key, groupIndex: findUrlGroupIndex(entry.url) };
  });

  // O agrupamento é decidido por repositório/domínio, não por URL: se qualquer URL casar,
  // o item inteiro vai para o agrupamento (o de menor posição na lista, se houver vários)
  const groupIndexByKey = new Map();
  for (const { key, groupIndex } of classified) {
    if (groupIndex < 0) continue;
    const previous = groupIndexByKey.get(key);
    if (previous === undefined || groupIndex < previous) groupIndexByKey.set(key, groupIndex);
  }

  // Contagens, títulos e agrupamentos consideram todo o histórico; a busca só decide o que aparece
  const filtering = searchTerms.length > 0;

  for (const { url, rawUrl, title, visits, searchText, hostname, repoInfo, domainKey, key } of classified) {
    const matched = !filtering || matchesSearch(searchText);

    const groupIndex = groupIndexByKey.get(key);
    const urlGroup = groupIndex === undefined ? null : currentUrlGroups[groupIndex];

    let bucket, aggregate;

    if (repoInfo) {
      if (urlGroup) {
        bucket = userGroups.get(urlGroup.id);
      } else {
        const groupKey = `${hostname} › ${repoInfo.projectGroup}`;
        if (!projectGroups.has(groupKey)) projectGroups.set(groupKey, new Map());
        bucket = projectGroups.get(groupKey);
      }
      // Nos agrupamentos do usuário, o caminho completo evita ambiguidade entre donos
      const name = urlGroup ? repoInfo.fullPath : repoInfo.repoName;
      aggregate = bucket.get(key) || newAggregate(name, repoInfo.repoUrl, false, hostIconPages.get(domainKey));
      trackVisit(aggregate, rawUrl, stripRepoTitle(title, repoInfo.fullPath), visits, repoInfo.isRoot, matched);
    } else {
      // Demais domínios: agrupa por host + porta; o link usa a origem do acesso mais recente
      bucket = urlGroup ? userGroups.get(urlGroup.id) : domainCounts;
      aggregate = bucket.get(key) || newAggregate(domainKey, url.origin, true, hostIconPages.get(domainKey));
      trackVisit(aggregate, rawUrl, title, visits, isRootUrl(url, 0), matched);
    }

    bucket.set(key, aggregate);
  }

  for (const bucket of userGroups.values()) resolveBucket(bucket);
  for (const [groupKey, bucket] of projectGroups) {
    resolveBucket(bucket);
    if (bucket.size === 0) projectGroups.delete(groupKey);
  }
  resolveBucket(domainCounts);

  return { userGroups, projectGroups, domainCounts };
}

function renderDashboard() {
  updateUrlGroupsVisibility();
  if (!historyEntries) return;

  const { userGroups, projectGroups, domainCounts } = categorizeHistory(historyEntries);
  renderUrlGroups(userGroups);
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

// Lê o cache local de favicons do Chrome (permissão "favicon"), sem nenhuma requisição externa;
// sem ícone em cache, o Chrome devolve o globo padrão. O dobro do tamanho exibido (32px nos
// cards), para ficar nítido em telas HiDPI quando o site oferece um ícone maior
function faviconUrl(pageUrl) {
  const params = new URLSearchParams({ pageUrl, size: '64' });
  return chrome.runtime.getURL(`/_favicon/?${params}`);
}

function createFavicon(pageUrl) {
  const img = document.createElement('img');
  img.className = 'item-icon';
  img.src = faviconUrl(pageUrl);
  img.alt = '';
  img.loading = 'lazy';
  return img;
}

function createItemCard({ name, url, count, title, iconPageUrl }) {
  const a = document.createElement('a');
  a.className = 'item-card';
  a.href = url;
  a.title = title ? `${title}\n${url}` : url;

  const mainEl = document.createElement('span');
  mainEl.className = 'item-main';

  const textEl = document.createElement('span');
  textEl.className = 'item-text';

  const nameEl = document.createElement('span');
  nameEl.className = 'item-name';
  nameEl.textContent = name;
  textEl.appendChild(nameEl);

  if (title) {
    const titleEl = document.createElement('span');
    titleEl.className = 'item-title';
    titleEl.textContent = title;
    textEl.appendChild(titleEl);
  }

  const countEl = document.createElement('span');
  countEl.className = 'item-count';
  countEl.textContent = count;

  mainEl.append(createFavicon(iconPageUrl), textEl);
  a.append(mainEl, countEl);
  return a;
}

function sortByCount(bucket) {
  return Array.from(bucket.values()).sort((a, b) => b.count - a.count);
}

function createGroupBlock(title, items, emptyMessage) {
  const groupBlock = document.createElement('div');
  groupBlock.className = 'project-group';

  const groupTitle = document.createElement('div');
  groupTitle.className = 'project-group-title';
  groupTitle.textContent = title;
  groupBlock.appendChild(groupTitle);

  const list = document.createElement('div');
  list.className = 'sub-list';
  if (items.length === 0) {
    renderMessage(list, emptyMessage);
  } else {
    list.append(...items.slice(0, 5).map(createItemCard));
  }

  groupBlock.appendChild(list);
  return groupBlock;
}

function updateUrlGroupsVisibility() {
  document.getElementById('url-groups-section').hidden = currentUrlGroups.length === 0;
}

function renderUrlGroups(userGroups) {
  const container = document.getElementById('url-groups');

  // Durante a busca, agrupamentos sem resultado somem em vez de mostrar a mensagem de vazio
  const groups = searchTerms.length > 0
    ? currentUrlGroups.filter(group => userGroups.get(group.id).size > 0)
    : currentUrlGroups;

  document.getElementById('url-groups-section').hidden = groups.length === 0;
  container.replaceChildren(...groups.map(group =>
    createGroupBlock(group.title, sortByCount(userGroups.get(group.id)), `Nenhum acesso ${currentPeriod.phrase}.`)
  ));
}

function renderCategorizedRepos(projectGroups) {
  const container = document.getElementById('git-repos');

  if (projectGroups.size === 0) {
    renderMessage(container, searchTerms.length > 0
      ? 'Nenhum repositório encontrado.'
      : `Nenhum repositório acessado ${currentPeriod.phrase}.`);
    return;
  }

  const sortedGroups = Array.from(projectGroups.entries())
    .map(([groupName, reposMap]) => {
      const repos = sortByCount(reposMap);
      const totalVisits = repos.reduce((acc, r) => acc + r.count, 0);
      return { groupName, repos, totalVisits };
    })
    .sort((a, b) => b.totalVisits - a.totalVisits)
    .slice(0, 8);

  container.replaceChildren(...sortedGroups.map(group =>
    createGroupBlock(group.groupName, group.repos, '')
  ));
}

function renderTopDomains(domainCounts) {
  const container = document.getElementById('top-domains');

  const top = sortByCount(domainCounts).slice(0, 15);

  if (top.length === 0) {
    renderMessage(container, searchTerms.length > 0 ? 'Nenhum domínio encontrado.' : 'Nenhum domínio registrado.');
    return;
  }

  container.replaceChildren(...top.map(createItemCard));
}

// --- Controles dos Modais ---

function showDialogError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = !message;
}

function createTagItem(contentEl, onDelete) {
  const div = document.createElement('div');
  div.className = 'tag-item';

  const btn = document.createElement('button');
  btn.className = 'btn-delete';
  btn.title = 'Remover';
  btn.textContent = '×';
  btn.addEventListener('click', onDelete);

  div.append(contentEl, btn);
  return div;
}

function renderModalList() {
  const listEl = document.getElementById('registered-domains');

  listEl.replaceChildren(...currentGitHosts.map(domain => {
    const label = document.createElement('span');
    label.className = 'tag-label';

    const nameEl = document.createElement('span');
    nameEl.textContent = domain;

    // Sem a raiz no histórico, o Chrome procura um ícone qualquer do host
    label.append(createFavicon(hostIconPages.get(domain) || `https://${domain}/`), nameEl);
    return createTagItem(label, () => saveGitHosts(hosts => hosts.filter(h => h !== domain)));
  }));
}

function renderGroupsModalList() {
  const listEl = document.getElementById('registered-groups');

  if (currentUrlGroups.length === 0) {
    renderMessage(listEl, 'Nenhum agrupamento cadastrado.');
    return;
  }

  listEl.replaceChildren(...currentUrlGroups.map(group => {
    const content = document.createElement('span');
    content.className = 'tag-text';

    const titleEl = document.createElement('strong');
    titleEl.textContent = group.title;

    const patternEl = document.createElement('code');
    patternEl.textContent = group.pattern;

    content.append(titleEl, patternEl);
    return createTagItem(content, () => saveUrlGroups(groups => groups.filter(g => g.id !== group.id)));
  }));
}

// Ignora o Enter que confirma uma composição de IME (acentos, etc.)
function onEnter(input, handler) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) handler();
  });
}

function isModalOpen() {
  return document.querySelector('dialog[open]') !== null;
}

function setupDialog(dialog, openBtn, closeBtn, focusEl, onOpen) {
  openBtn.addEventListener('click', () => {
    onOpen();
    dialog.showModal();
    focusEl.focus();
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
}

function setupGitHostsModal() {
  const input = document.getElementById('domain-input');

  setupDialog(
    document.getElementById('settings-dialog'),
    document.getElementById('open-settings-btn'),
    document.getElementById('close-settings-btn'),
    input,
    () => {
      showDialogError('settings-error', '');
      renderModalList();
    }
  );

  const handleAdd = async () => {
    if (!input.value.trim()) return;

    const host = normalizeHost(input.value);
    if (!host) {
      showDialogError('settings-error', 'Domínio inválido.');
      return;
    }

    if (currentGitHosts.includes(host)) {
      input.value = '';
      showDialogError('settings-error', '');
      return;
    }

    if (await saveGitHosts(hosts => hosts.includes(host) ? hosts : [...hosts, host])) {
      input.value = '';
    }
  };

  document.getElementById('add-domain-btn').addEventListener('click', handleAdd);
  onEnter(input, handleAdd);
}

function setupUrlGroupsModal() {
  const titleInput = document.getElementById('group-title-input');
  const patternInput = document.getElementById('group-pattern-input');

  setupDialog(
    document.getElementById('groups-dialog'),
    document.getElementById('open-groups-btn'),
    document.getElementById('close-groups-btn'),
    titleInput,
    () => {
      showDialogError('groups-error', '');
      renderGroupsModalList();
    }
  );

  const handleAdd = async () => {
    const title = titleInput.value.trim();
    const pattern = normalizePattern(patternInput.value);

    if (!title || !pattern) {
      showDialogError('groups-error', 'Informe o título e o trecho da URL.');
      return;
    }

    if (currentUrlGroups.some(g => g.pattern === pattern)) {
      showDialogError('groups-error', 'Já existe um agrupamento com este trecho.');
      return;
    }

    const group = { id: crypto.randomUUID(), title, pattern };
    const added = await saveUrlGroups(groups =>
      groups.some(g => g.pattern === pattern) ? groups : [...groups, group]
    );
    if (added) {
      titleInput.value = '';
      patternInput.value = '';
      titleInput.focus();
    }
  };

  document.getElementById('add-group-btn').addEventListener('click', handleAdd);
  onEnter(titleInput, () => patternInput.focus());
  onEnter(patternInput, handleAdd);
}

// --- Período ---

function updatePeriodTitle() {
  document.getElementById('page-title').textContent = `Visão Geral · ${currentPeriod.label}`;
}

function setupPeriodSelect() {
  const select = document.getElementById('period-select');

  select.replaceChildren(...HISTORY_PERIODS.map(period => {
    const option = document.createElement('option');
    option.value = period.id;
    option.textContent = period.label;
    return option;
  }));
  select.value = currentPeriod.id;
  updatePeriodTitle();

  // Com o select fechado, cada seta do teclado dispara um change: a troca aparece na hora,
  // mas a recarga e a gravação esperam o usuário parar
  let timer = null;
  select.addEventListener('change', () => {
    const period = findPeriod(select.value);
    if (!period || period === currentPeriod) return;
    currentPeriod = period;
    updatePeriodTitle();
    startHistoryLoading();

    clearTimeout(timer);
    timer = setTimeout(() => {
      saveHistoryPeriod(period.id);
      loadHistory();
    }, PERIOD_DEBOUNCE_MS);
  });
}

// --- Busca ---

function setupSearch() {
  const input = document.getElementById('search-input');
  let timer = null;

  const apply = () => {
    clearTimeout(timer);
    const terms = parseSearchTerms(input.value);
    if (terms.join(' ') === searchTerms.join(' ')) return;
    searchTerms = terms;
    renderDashboard();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(apply, SEARCH_DEBOUNCE_MS);
  });

  // Esc limpa a busca na hora, sem esperar o debounce
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      input.value = '';
      apply();
    }
  });

  // O Chrome dá o foco da nova aba à barra de endereço; quando a página o recebe pelo
  // teclado (F6/Shift+F6), ele vai para a busca. Foco vindo de clique é ignorado, para não
  // roubar o clique num card nem uma seleção de texto. A ordem entre o evento de foco e o
  // pointerdown varia, então a decisão espera um instante e olha os dois lados
  let lastPointerDown = -Infinity;
  window.addEventListener('pointerdown', () => { lastPointerDown = performance.now(); }, true);

  window.addEventListener('focus', () => {
    const focusedAt = performance.now();
    setTimeout(() => {
      if (lastPointerDown >= focusedAt - 100) return;
      if (document.activeElement === document.body && !isModalOpen()) {
        input.focus({ preventScroll: true });
      }
    }, 50);
  });

  // "/" foca a busca de qualquer ponto da página, como no GitHub e no YouTube.
  // AltGr (que em alguns layouts produz "/") chega como Ctrl+Alt no Windows
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.getModifierState('AltGraph')) return;

    const target = e.target;
    if (target.isContentEditable || target.closest('input, textarea, select') || isModalOpen()) return;

    e.preventDefault();
    input.focus();
    input.select();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupSearch();
  setupGitHostsModal();
  setupUrlGroupsModal();
  await Promise.all([loadGitHosts(), loadUrlGroups(), loadHistoryPeriod()]);
  setupPeriodSelect();
  await loadHistory();
});
