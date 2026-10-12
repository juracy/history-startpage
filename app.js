import { categorizeHistory } from './lib/categorize.js';
import {
  DEFAULT_GIT_HOSTS, DEFAULT_PERIOD_ID, DOMAINS_LIMIT, HISTORY_PERIODS, ITEMS_PER_GROUP, REPO_GROUPS_LIMIT, findPeriod
} from './lib/constants.js';
import { DEFAULT_FORGE, GIT_FORGES, findKnownForge, toGitHost } from './lib/forges.js';
import { moveGroup, updateGroup } from './lib/groups.js';
import { buildHistoryEntries, buildHostIconPages } from './lib/history.js';
import {
  createSaveQueue, readGitHosts, readHiddenItems, readHistoryPeriod, readUrlGroups,
  writeGitHosts, writeHiddenItems, writeHistoryPeriod, writeUrlGroups
} from './lib/storage.js';
import { formatTimeAgo, normalizeHost, normalizePattern, parseSearchTerms, safeDecode, splitItemKey } from './lib/text.js';

const SEARCH_DEBOUNCE_MS = 200;
const PERIOD_DEBOUNCE_MS = 400;

// Hosts Git monitorados: [{ host, forge }]
let currentGitHosts = DEFAULT_GIT_HOSTS.map(host => toGitHost(host));

let currentPeriod = findPeriod(DEFAULT_PERIOD_ID);

// Incrementado a cada carregamento; resultados de um carregamento anterior são descartados
let historyLoadId = 0;

// Agrupamentos do usuário: [{ id, title, pattern }]; a primeira regra que casar vence
let currentUrlGroups = [];

// Agrupamento carregado no formulário do modal para edição; null = formulário de inclusão
let editingGroupId = null;

// Chaves dos itens ocultos pelo usuário ("repo:host/caminho" ou "domain:host")
let hiddenItems = [];

// Cache do histórico já processado: [{ url: URL, visits }], do acesso mais recente ao mais antigo
let historyEntries = null;

// Página raiz visitada de cada host (sem "www."), de onde vem o ícone do site
let hostIconPages = new Map();

// Termos da busca já normalizados; vazio = sem filtro
let searchTerms = [];

// Listas abertas pelo "Mostrar mais" (ids como "domains" ou "repos:<grupo>"); zerado ao trocar o período
const expandedLists = new Set();

// Última categorização, reaproveitada quando só muda o que é exibido (abrir ou fechar uma lista)
let lastCategorized = null;

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

async function loadHiddenItems() {
  hiddenItems = await readHiddenItems();
  updateHiddenButton();
  return hiddenItems;
}

function saveHiddenItems(update) {
  return enqueueSave(async () => {
    const keys = update(hiddenItems);
    if (keys === hiddenItems) return true;

    try {
      await writeHiddenItems(keys);
    } catch (e) {
      console.error('Falha ao salvar itens ocultos:', e);
      showDialogError('hidden-error', `Não foi possível salvar: ${e.message}`);
      return false;
    }

    showDialogError('hidden-error', '');
    hiddenItems = keys;
    updateHiddenButton();
    renderHiddenModalList();
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

function renderDashboard({ recategorize = true } = {}) {
  updateUrlGroupsVisibility();
  if (!historyEntries) return;

  if (recategorize || !lastCategorized) {
    lastCategorized = categorizeHistory(historyEntries, {
      gitHosts: currentGitHosts, urlGroups: currentUrlGroups, searchTerms, hostIconPages,
      hiddenKeys: new Set(hiddenItems)
    });
  }
  const { userGroups, projectGroups, domainCounts } = lastCategorized;
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

function createItemCard({ key, name, url, count, lastVisitTime, title, iconPageUrl }) {
  const a = document.createElement('a');
  a.className = 'item-card';
  a.href = url;

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
  countEl.textContent = count.toLocaleString('pt-BR');

  mainEl.append(createFavicon(iconPageUrl), textEl);
  a.append(mainEl, countEl);

  // O "há X" muda com o tempo e a aba pode ficar aberta por horas, então tooltip e rótulo
  // são refeitos ao passar o mouse ou focar. O rótulo evita que o leitor de tela anuncie
  // só o número solto ao final do nome
  const updateLabels = () => {
    const visits = `${count.toLocaleString('pt-BR')} ${count === 1 ? 'visita' : 'visitas'} ${currentPeriod.phrase}`;
    const visitsText = lastVisitTime ? `${visits} · último acesso ${formatTimeAgo(lastVisitTime)}` : visits;
    a.title = [title, url, visitsText].filter(Boolean).join('\n');
    a.setAttribute('aria-label', [name, title, visitsText].filter(Boolean).join(', '));
  };
  updateLabels();
  a.addEventListener('pointerenter', updateLabels);
  a.addEventListener('focus', updateLabels);

  // O botão fica fora do link, pois um botão dentro de <a> é HTML inválido
  const hideBtn = document.createElement('button');
  hideBtn.className = 'item-hide';
  hideBtn.textContent = '×';
  hideBtn.title = 'Ocultar do painel';
  hideBtn.setAttribute('aria-label', `Ocultar ${name}`);
  hideBtn.addEventListener('click', () => hideItem(key, a, hideBtn));

  const row = document.createElement('div');
  row.className = 'item-row';
  row.append(a, hideBtn);
  return row;
}

// Ao ocultar pelo teclado, o foco passa para o card que ocupa o lugar do removido. O Chrome
// também foca o botão no clique do mouse; só :focus-visible distingue os dois casos.
// Se a gravação falhar, o erro aparece no modal de ocultos, pois o card não tem onde mostrá-lo
async function hideItem(key, card, hideBtn) {
  const index = getResultCards().indexOf(card);
  const byKeyboard = hideBtn.matches(':focus-visible');

  const hidden = await saveHiddenItems(keys => keys.includes(key) ? keys : [...keys, key]);
  if (!hidden) {
    renderHiddenModalList();
    document.getElementById('hidden-dialog').showModal();
    document.getElementById('close-hidden-btn').focus();
    return;
  }
  if (!byKeyboard) return;

  const cards = getResultCards();
  (cards[index] || cards[cards.length - 1] || document.getElementById('search-input')).focus();
}

function sortByCount(bucket) {
  return Array.from(bucket.values()).sort((a, b) => b.count - a.count);
}

// Até `limit` itens e, se houver mais, o botão "Mostrar mais"/"Mostrar menos". Vale também
// durante a busca: o botão diz quantos resultados faltam, sem o custo de desenhar todos a cada tecla.
// O primeiro item além do limite ganha data-first-extra, para onde o foco vai ao expandir
function limitedNodes(listId, items, limit, render, [singular, plural]) {
  const expanded = expandedLists.has(listId);
  const nodes = (expanded ? items : items.slice(0, limit)).map(render);
  if (items.length <= limit) return nodes;
  if (expanded) nodes[limit].dataset.firstExtra = '';

  const rest = items.length - limit;
  const btn = document.createElement('button');
  btn.className = 'list-toggle';
  btn.dataset.listId = listId;
  btn.textContent = expanded ? 'Mostrar menos' : `Mostrar mais ${rest} ${rest === 1 ? singular : plural}`;
  btn.addEventListener('click', () => toggleList(listId));
  return [...nodes, btn];
}

// O redesenho substitui o botão, então o foco é devolvido ao novo (ao recolher, isso também
// traz a lista de volta à vista). Pelo teclado, expandir leva ao primeiro item que estava escondido
function toggleList(listId) {
  const byKeyboard = document.activeElement?.matches(':focus-visible');
  const expanding = !expandedLists.has(listId);
  if (expanding) expandedLists.add(listId);
  else expandedLists.delete(listId);
  renderDashboard({ recategorize: false });

  const newBtn = document.querySelector(`.list-toggle[data-list-id="${CSS.escape(listId)}"]`);
  if (!newBtn) return;
  const firstExtra = expanding && byKeyboard
    ? newBtn.parentElement.querySelector(':scope > [data-first-extra] .item-card')
    : null;
  if (firstExtra) firstExtra.focus();
  else newBtn.focus({ preventScroll: expanding });
}

function createGroupBlock(listId, title, items, emptyMessage, noun) {
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
    list.append(...limitedNodes(listId, items, ITEMS_PER_GROUP, createItemCard, noun));
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
    createGroupBlock(`group:${group.id}`, group.title, sortByCount(userGroups.get(group.id)),
      `Nenhum acesso ${currentPeriod.phrase}.`, ['item', 'itens'])
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
    .sort((a, b) => b.totalVisits - a.totalVisits);

  container.replaceChildren(...limitedNodes('repo-groups', sortedGroups, REPO_GROUPS_LIMIT, group =>
    createGroupBlock(`repos:${group.groupName}`, group.groupName, group.repos, '', ['repositório', 'repositórios']),
    ['grupo', 'grupos']
  ));
}

function renderTopDomains(domainCounts) {
  const container = document.getElementById('top-domains');

  const domains = sortByCount(domainCounts);

  if (domains.length === 0) {
    renderMessage(container, searchTerms.length > 0 ? 'Nenhum domínio encontrado.' : 'Nenhum domínio registrado.');
    return;
  }

  container.replaceChildren(...limitedNodes('domains', domains, DOMAINS_LIMIT, createItemCard, ['domínio', 'domínios']));
}

// --- Controles dos Modais ---

function showDialogError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = !message;
}

function createActionButton(text, label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn-action';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

// Sem onDelete, o item não tem o botão × (só as ações passadas)
function createTagItem(contentEl, deleteLabel, onDelete, actionButtons = []) {
  const div = document.createElement('div');
  div.className = 'tag-item';

  const actions = document.createElement('span');
  actions.className = 'tag-actions';
  actions.append(...actionButtons);

  if (onDelete) {
    const btn = document.createElement('button');
    btn.className = 'btn-delete';
    btn.title = deleteLabel;
    btn.setAttribute('aria-label', deleteLabel);
    btn.textContent = '×';
    btn.addEventListener('click', onDelete);
    actions.append(btn);
  }

  div.append(contentEl, actions);
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
    return createTagItem(label, `Remover ${host}`, () => saveGitHosts(hosts => hosts.filter(h => h.host !== host)));
  }));
}

function renderGroupsModalList() {
  const listEl = document.getElementById('registered-groups');

  if (currentUrlGroups.length === 0) {
    renderMessage(listEl, 'Nenhum agrupamento cadastrado.');
    return;
  }

  listEl.replaceChildren(...currentUrlGroups.map((group, index) => {
    const content = document.createElement('span');
    content.className = 'tag-text';

    const titleEl = document.createElement('strong');
    titleEl.textContent = group.title;

    const patternEl = document.createElement('code');
    patternEl.textContent = group.pattern;

    content.append(titleEl, patternEl);

    const upBtn = createActionButton('↑', `Subir ${group.title}`, () => moveUrlGroup(group.id, -1));
    upBtn.dataset.action = 'up';
    upBtn.disabled = index === 0;

    const downBtn = createActionButton('↓', `Descer ${group.title}`, () => moveUrlGroup(group.id, 1));
    downBtn.dataset.action = 'down';
    downBtn.disabled = index === currentUrlGroups.length - 1;

    const editBtn = createActionButton('✎', `Editar ${group.title}`, () => setGroupEditing(group));

    const item = createTagItem(content, `Remover ${group.title}`, async () => {
      const removed = await saveUrlGroups(groups => groups.filter(g => g.id !== group.id));
      if (removed && editingGroupId === group.id) setGroupEditing(null);
    }, [upBtn, downBtn, editBtn]);
    item.dataset.groupId = group.id;
    item.classList.toggle('editing', group.id === editingGroupId);
    return item;
  }));
}

// A lista é redesenhada ao salvar; o foco volta para o botão do item movido ou, se ele
// chegou à ponta e o botão ficou desabilitado, para o de sentido contrário
async function moveUrlGroup(id, delta) {
  const moved = await saveUrlGroups(groups => moveGroup(groups, id, delta));
  if (!moved) return;

  const item = document.querySelector(`#registered-groups [data-group-id="${CSS.escape(id)}"]`);
  const same = item?.querySelector(`[data-action="${delta < 0 ? 'up' : 'down'}"]`);
  const other = item?.querySelector(`[data-action="${delta < 0 ? 'down' : 'up'}"]`);
  (same && !same.disabled ? same : other)?.focus();
}

// Carrega um agrupamento no formulário do modal para edição, ou volta ao modo de inclusão
function setGroupEditing(group) {
  const titleInput = document.getElementById('group-title-input');
  editingGroupId = group?.id ?? null;
  titleInput.value = group?.title ?? '';
  document.getElementById('group-pattern-input').value = group?.pattern ?? '';
  document.getElementById('add-group-btn').textContent = group ? 'Salvar' : 'Adicionar';
  document.getElementById('cancel-group-edit-btn').hidden = !group;
  showDialogError('groups-error', '');
  renderGroupsModalList();
  titleInput.focus();
}

// O botão só aparece quando há algo para mostrar de novo
function updateHiddenButton() {
  const btn = document.getElementById('open-hidden-btn');
  btn.hidden = hiddenItems.length === 0;
  btn.textContent = `⊘ Ocultos (${hiddenItems.length})`;
}

function renderHiddenModalList() {
  const listEl = document.getElementById('registered-hidden');

  if (hiddenItems.length === 0) {
    renderMessage(listEl, 'Nenhum item oculto.');
    return;
  }

  listEl.replaceChildren(...hiddenItems.map(key => {
    const label = document.createElement('span');
    label.className = 'tag-label';

    const parsed = splitItemKey(key);
    const host = parsed.kind === 'repo' ? parsed.name.split('/')[0] : parsed.name;

    const nameEl = document.createElement('span');
    nameEl.className = 'tag-name';
    nameEl.textContent = safeDecode(parsed.name);

    const kindEl = document.createElement('span');
    kindEl.className = 'tag-forge';
    kindEl.textContent = parsed.kind === 'repo' ? 'repositório' : 'domínio';

    label.append(createFavicon(hostIconPages.get(host.replace(/^www\./, '')) || `https://${host}/`), nameEl, kindEl);
    const showBtn = createActionButton('Mostrar', `Mostrar ${safeDecode(parsed.name)} de novo`,
      () => saveHiddenItems(keys => keys.filter(k => k !== key)));
    return createTagItem(label, '', null, [showBtn]);
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
  const dialog = document.getElementById('groups-dialog');
  const titleInput = document.getElementById('group-title-input');
  const patternInput = document.getElementById('group-pattern-input');

  setupDialog(
    dialog,
    document.getElementById('open-groups-btn'),
    document.getElementById('close-groups-btn'),
    titleInput,
    () => {
      // Uma edição deixada pela metade não volta ao reabrir o modal
      if (editingGroupId) setGroupEditing(null);
      showDialogError('groups-error', '');
      renderGroupsModalList();
    }
  );

  // Durante a edição, o Esc cancela a edição em vez de fechar o modal
  dialog.addEventListener('cancel', (e) => {
    if (!editingGroupId) return;
    e.preventDefault();
    setGroupEditing(null);
  });

  document.getElementById('cancel-group-edit-btn').addEventListener('click', () => setGroupEditing(null));

  const handleAdd = async () => {
    const title = titleInput.value.trim();
    const pattern = normalizePattern(patternInput.value);

    if (!title || !pattern) {
      showDialogError('groups-error', 'Informe o título e o trecho da URL.');
      return;
    }

    if (currentUrlGroups.some(g => g.pattern === pattern && g.id !== editingGroupId)) {
      showDialogError('groups-error', 'Já existe um agrupamento com este trecho.');
      return;
    }

    if (editingGroupId) {
      const id = editingGroupId;
      const saved = await saveUrlGroups(groups => updateGroup(groups, id, { title, pattern }));
      if (saved && editingGroupId === id) setGroupEditing(null);
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

function setupHiddenModal() {
  setupDialog(
    document.getElementById('hidden-dialog'),
    document.getElementById('open-hidden-btn'),
    document.getElementById('close-hidden-btn'),
    document.getElementById('close-hidden-btn'),
    () => {
      showDialogError('hidden-error', '');
      renderHiddenModalList();
    }
  );
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
    expandedLists.clear();
    startHistoryLoading();

    clearTimeout(timer);
    timer = setTimeout(() => {
      saveHistoryPeriod(period.id);
      loadHistory();
    }, PERIOD_DEBOUNCE_MS);
  });
}

// --- Busca ---

// Na ordem do documento: agrupamentos, repositórios e domínios
function getResultCards() {
  return Array.from(document.querySelectorAll('.container .item-card'));
}

// O que as setas percorrem: os cards e os botões "Mostrar mais" entre eles
function getNavigableItems() {
  return Array.from(document.querySelectorAll('.container .item-card, .container .list-toggle'));
}

// ↑/↓ percorrem os cards e os botões "Mostrar mais"; ↑ no primeiro volta para a busca. Enter e Ctrl+Enter num card
// focado já são tratados pelo próprio link
function setupResultsNavigation(input) {
  document.querySelector('.container').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    const card = e.target.closest('.item-card, .list-toggle');
    if (!card) return;

    const cards = getNavigableItems();
    const index = cards.indexOf(card);
    e.preventDefault();
    if (e.key === 'ArrowDown') {
      cards[index + 1]?.focus();
    } else if (index === 0) {
      input.focus();
    } else {
      cards[index - 1].focus();
    }
  });
}

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

  // Esc limpa a busca na hora, sem esperar o debounce. Enter e ↓ também aplicam o que
  // foi digitado antes de agir, para não abrir um resultado da busca anterior
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;

    if (e.key === 'Escape' && input.value) {
      input.value = '';
      apply();
    } else if (e.key === 'Enter') {
      apply();
      // Sem busca, um Enter por reflexo (logo após o Alt+T, por exemplo) não deve navegar
      if (searchTerms.length === 0) return;
      const first = getResultCards()[0];
      if (!first) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Página da extensão pode criar abas sem a permissão "tabs"
        chrome.tabs.create({ url: first.href, active: false });
      } else {
        location.assign(first.href);
      }
    } else if (e.key === 'ArrowDown') {
      apply();
      const first = getResultCards()[0];
      if (!first) return;
      e.preventDefault();
      first.focus();
    }
  });

  setupResultsNavigation(input);

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
  setupHiddenModal();
  await Promise.all([loadGitHosts(), loadUrlGroups(), loadHiddenItems(), loadHistoryPeriod()]);
  setupPeriodSelect();
  await loadHistory();
});
