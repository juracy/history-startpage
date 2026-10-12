import { categorizeHistory } from './lib/categorize.js';
import { DEFAULT_GIT_HOSTS, DEFAULT_PERIOD_ID, HISTORY_PERIODS, findPeriod } from './lib/constants.js';
import { DEFAULT_FORGE, GIT_FORGES, findKnownForge, toGitHost } from './lib/forges.js';
import { buildHistoryEntries, buildHostIconPages } from './lib/history.js';
import {
  createSaveQueue, readGitHosts, readHistoryPeriod, readUrlGroups,
  writeGitHosts, writeHistoryPeriod, writeUrlGroups
} from './lib/storage.js';
import { normalizeHost, normalizePattern, parseSearchTerms } from './lib/text.js';

const SEARCH_DEBOUNCE_MS = 200;
const PERIOD_DEBOUNCE_MS = 400;

// Hosts Git monitorados: [{ host, forge }]
let currentGitHosts = DEFAULT_GIT_HOSTS.map(host => toGitHost(host));

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

// --- Gerenciamento de Configurações (Storage) ---

const enqueueSave = createSaveQueue();

async function loadGitHosts() {
  currentGitHosts = await readGitHosts();
  return currentGitHosts;
}

function saveGitHosts(update) {
  return enqueueSave(async () => {
    const hosts = update(currentGitHosts);
    if (hosts === currentGitHosts) return true;

    try {
      await writeGitHosts(hosts);
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
  currentUrlGroups = await readUrlGroups();
  return currentUrlGroups;
}

function saveUrlGroups(update) {
  return enqueueSave(async () => {
    const groups = update(currentUrlGroups);
    if (groups === currentUrlGroups) return true;

    try {
      await writeUrlGroups(groups);
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
  currentPeriod = await readHistoryPeriod();
  return currentPeriod;
}

// A troca vale na hora; falha ao salvar só impede que a escolha valha para as próximas abas
function saveHistoryPeriod(id) {
  return enqueueSave(async () => {
    try {
      await writeHistoryPeriod(id);
    } catch (e) {
      console.error('Falha ao salvar o período:', e);
    }
  });
}

// --- Carregamento do Histórico ---

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

// --- Renderização na Interface ---

function renderDashboard() {
  updateUrlGroupsVisibility();
  if (!historyEntries) return;

  const { userGroups, projectGroups, domainCounts } = categorizeHistory(historyEntries, {
    gitHosts: currentGitHosts, urlGroups: currentUrlGroups, searchTerms, hostIconPages
  });
  renderUrlGroups(userGroups);
  renderCategorizedRepos(projectGroups);
  renderTopDomains(domainCounts);
}

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

  listEl.replaceChildren(...currentGitHosts.map(({ host, forge }) => {
    const label = document.createElement('span');
    label.className = 'tag-label';

    const nameEl = document.createElement('span');
    nameEl.textContent = host;

    const forgeEl = document.createElement('span');
    forgeEl.className = 'tag-forge';
    forgeEl.textContent = GIT_FORGES[forge].label;

    // Sem a raiz no histórico, o Chrome procura um ícone qualquer do host
    label.append(createFavicon(hostIconPages.get(host) || `https://${host}/`), nameEl, forgeEl);
    return createTagItem(label, () => saveGitHosts(hosts => hosts.filter(h => h.host !== host)));
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
  const forgeSelect = document.getElementById('forge-select');

  forgeSelect.replaceChildren(...Object.entries(GIT_FORGES).map(([id, { label }]) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    return option;
  }));
  forgeSelect.value = DEFAULT_FORGE;

  // Só hosts conhecidos mudam o tipo sozinhos, para não desfazer a escolha feita para um host próprio
  input.addEventListener('input', () => {
    const host = normalizeHost(input.value);
    const known = host && findKnownForge(host);
    if (known) forgeSelect.value = known;
  });

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

    const forge = forgeSelect.value;
    const reset = () => {
      input.value = '';
      forgeSelect.value = DEFAULT_FORGE;
    };

    if (currentGitHosts.some(h => h.host === host && h.forge === forge)) {
      reset();
      showDialogError('settings-error', '');
      return;
    }

    // Adicionar de novo um host já cadastrado troca o tipo dele
    const saved = await saveGitHosts(hosts => {
      const existing = hosts.find(h => h.host === host);
      if (existing?.forge === forge) return hosts;
      const entry = { host, forge };
      return existing ? hosts.map(h => h === existing ? entry : h) : [...hosts, entry];
    });
    if (saved) reset();
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
