import { categorizeHistory } from './lib/categorize.js';
import {
  DEFAULT_GIT_HOSTS, DEFAULT_PERIOD_ID, DOMAINS_LIMIT, HISTORY_PERIODS, ITEMS_PER_GROUP, REPO_GROUPS_LIMIT, findPeriod
} from './lib/constants.js';
import { toGitHost } from './lib/forges.js';
import { buildHistoryEntries, buildHostIconPages } from './lib/history.js';
import { readHistoryCache, updateHistoryCache, writeHistoryCache } from './lib/history-cache.js';
import {
  createSaveQueue, createSyncedSetting, readGitHosts, readHiddenItems, readHistoryPeriod, readShowMatchedPages,
  readUrlGroups, watchSyncedSettings, writeHiddenItems, writeHistoryPeriod
} from './lib/storage.js';
import { findHighlightRanges, formatTimeAgo, parseSearchTerms } from './lib/text.js';
import { createFavicon, renderMessage, showError } from './dom.js';

const SEARCH_DEBOUNCE_MS = 200;
const PERIOD_DEBOUNCE_MS = 400;

// Hosts Git monitorados: [{ host, forge }]
let currentGitHosts = DEFAULT_GIT_HOSTS.map(host => toGitHost(host));

let currentPeriod = findPeriod(DEFAULT_PERIOD_ID);

// Incrementado a cada carregamento; resultados de um carregamento anterior são descartados
let historyLoadId = 0;

// Mensagens "Carregando…" do carregamento em andamento, atualizadas com o progresso da carga completa
let loadingMessages = [];

// Agrupamentos do usuário: [{ id, title, pattern }]; a primeira regra que casar vence
let currentUrlGroups = [];

// Chaves dos itens ocultos pelo usuário ("repo:host/caminho" ou "domain:host")
let hiddenItems = [];

// Cache do histórico já processado: [{ url: URL, visits }], do acesso mais recente ao mais antigo
let historyEntries = null;

// Página raiz visitada de cada host (sem "www."), de onde vem o ícone do site
let hostIconPages = new Map();

// Termos da busca já normalizados; vazio = sem filtro
let searchTerms = [];

// Mostra abaixo do card as páginas internas encontradas pela busca (opção das configurações)
let showMatchedPages = false;

// Listas abertas pelo "Mostrar mais" (ids como "domains" ou "repos:<grupo>"); zerado ao trocar o período
const expandedLists = new Set();

// Última categorização, reaproveitada quando só muda o que é exibido (abrir ou fechar uma lista)
let lastCategorized = null;

// --- Gerenciamento de Configurações (Storage) ---

const enqueueSave = createSaveQueue();

// Hosts e agrupamentos são editados na página de configurações (options.html); o painel só os
// acompanha e recategoriza o cache, sem reler o histórico. Dos ocultos, grava o × dos cards
const gitHostsSetting = createSyncedSetting({
  keys: ['gitHosts', 'gitHostForges'], read: readGitHosts, enqueue: enqueueSave,
  onChange: (hosts) => {
    currentGitHosts = hosts;
    renderDashboard();
  }
});

const urlGroupsSetting = createSyncedSetting({
  keys: ['urlGroups'], read: readUrlGroups, enqueue: enqueueSave,
  onChange: (groups) => {
    currentUrlGroups = groups;
    renderDashboard();
  }
});

// Desligada, a categorização nem junta as páginas encontradas; por isso a troca recategoriza
const showMatchedPagesSetting = createSyncedSetting({
  keys: ['showMatchedPages'], read: readShowMatchedPages, enqueue: enqueueSave,
  onChange: (enabled) => {
    showMatchedPages = enabled;
    renderDashboard();
  }
});

const hiddenItemsSetting = createSyncedSetting({
  keys: ['hiddenItems'], read: readHiddenItems, write: writeHiddenItems, enqueue: enqueueSave,
  onChange: (keys) => {
    hiddenItems = keys;
    updateHiddenButton();
    renderDashboard();
  }
});

async function saveHiddenItems(update) {
  const errorEl = document.getElementById('dashboard-error');
  try {
    await hiddenItemsSetting.save(update);
  } catch (e) {
    console.error('Falha ao salvar itens ocultos:', e);
    showError(errorEl, `Não foi possível ocultar: ${e.message}`);
    return false;
  }
  showError(errorEl, '');
  return true;
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
// Sem entradas em memória nesse intervalo, para que busca ou configurações não redesenhem dados de outro período
function startHistoryLoading() {
  historyEntries = null;
  updateUrlGroupsVisibility();
  loadingMessages = renderStatusMessage('Carregando…');
  // Só a mensagem dos repositórios, cuja seção nunca fica oculta, é anunciada pelo leitor de tela;
  // nas três, o mesmo progresso seria lido três vezes
  loadingMessages[1].setAttribute('role', 'status');
  return ++historyLoadId;
}

function renderStatusMessage(text) {
  return ['url-groups', 'git-repos', 'top-domains']
    .map(id => renderMessage(document.getElementById(id), text));
}

// A carga completa de um período longo faz milhares de chamadas a getVisits. Troca só o texto:
// recriar as mensagens a cada lote reiniciaria o anúncio do role="status"
function showLoadingProgress(done, total) {
  if (total === 0) return;
  const text = `Carregando… ${done.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} páginas`;
  for (const message of loadingMessages) message.textContent = text;
}

// now, e não o updatedAt do cache: o cache pode cobrir um período maior ou ser de horas atrás
function showHistory(cache, period, now) {
  historyEntries = buildHistoryEntries(cache.records, now - period.ms);
  hostIconPages = buildHostIconPages(historyEntries);
  renderDashboard();
}

// O cache aparece na hora e é atualizado em seguida; só as URLs visitadas desde a última
// atualização voltam a consultar o histórico
async function loadHistory() {
  const loadId = startHistoryLoading();
  const isCurrent = () => loadId === historyLoadId;
  const period = currentPeriod;
  const startedAt = Date.now();

  const cached = await readHistoryCache(period, startedAt);
  if (!isCurrent()) return;
  if (cached) showHistory(cached, period, startedAt);

  let updated;
  try {
    // Com o cache na tela, a carga completa diária roda por trás, sem trocar os cards pelo progresso
    updated = await updateHistoryCache(cached, period, isCurrent, startedAt, cached ? undefined : showLoadingProgress);
  } catch (e) {
    if (!isCurrent()) return;
    console.error('Falha ao carregar histórico:', e);
    if (cached) return;
    renderStatusMessage('Erro ao carregar o histórico.');
    return;
  }

  if (!isCurrent() || !updated?.changed) return;
  showHistory(updated.cache, period, startedAt);
  // Falha ao gravar só faz a próxima aba refazer o trabalho
  writeHistoryCache(updated.cache, startedAt).catch(e => console.error('Falha ao gravar o cache do histórico:', e));
}

// --- Renderização na Interface ---

function renderDashboard({ recategorize = true } = {}) {
  updateUrlGroupsVisibility();
  if (!historyEntries) return;

  if (recategorize || !lastCategorized) {
    lastCategorized = categorizeHistory(historyEntries, {
      gitHosts: currentGitHosts, urlGroups: currentUrlGroups, searchTerms, hostIconPages,
      hiddenKeys: new Set(hiddenItems), collectPages: showMatchedPages
    });
  }
  const { userGroups, projectGroups, domainCounts } = lastCategorized;
  // A atualização do cache e as mudanças de configuração redesenham os cards; o foco volta ao mesmo item
  const focusedKey = document.activeElement?.closest?.('.item-card, .item-page')?.dataset.key;
  renderUrlGroups(userGroups);
  renderCategorizedRepos(projectGroups);
  renderTopDomains(domainCounts);
  if (focusedKey) document.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus();
}

// Texto com os termos da busca em <mark>; os pedaços entram como nós de texto, nunca como HTML
function setHighlightedText(el, text) {
  let last = 0;
  for (const [start, end] of findHighlightRanges(text, searchTerms)) {
    if (start > last) el.append(text.slice(last, start));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    el.append(mark);
    last = end;
  }
  el.append(text.slice(last));
}

function formatVisits(count) {
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? 'visita' : 'visitas'} ${currentPeriod.phrase}`;
}

// Páginas internas que casaram com a busca, quando o card sozinho não explica o resultado
function createPageLinks(pages) {
  const list = document.createElement('div');
  list.className = 'item-pages';
  list.append(...pages.map(({ url, title, visits }) => {
    const a = document.createElement('a');
    a.className = 'item-page';
    a.dataset.key = `page:${url}`;
    a.href = url;
    a.title = `${title}\n${url}`;
    a.setAttribute('aria-label', `${title}, ${formatVisits(visits)}`);

    const titleEl = document.createElement('span');
    titleEl.className = 'item-page-title';
    setHighlightedText(titleEl, title);

    const countEl = document.createElement('span');
    countEl.className = 'item-page-count';
    countEl.textContent = visits.toLocaleString('pt-BR');

    a.append(titleEl, countEl);
    return a;
  }));
  return list;
}

function createItemCard({ key, name, url, count, lastVisitTime, title, iconPageUrl, pages }) {
  const a = document.createElement('a');
  a.className = 'item-card';
  a.dataset.key = key;
  a.href = url;

  const mainEl = document.createElement('span');
  mainEl.className = 'item-main';

  const textEl = document.createElement('span');
  textEl.className = 'item-text';

  const nameEl = document.createElement('span');
  nameEl.className = 'item-name';
  setHighlightedText(nameEl, name);
  textEl.appendChild(nameEl);

  if (title) {
    const titleEl = document.createElement('span');
    titleEl.className = 'item-title';
    setHighlightedText(titleEl, title);
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
    const visits = formatVisits(count);
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
  if (pages.length > 0) row.append(createPageLinks(pages));
  return row;
}

// Ao ocultar pelo teclado, o foco passa para o card que ocupa o lugar do removido. O Chrome
// também foca o botão no clique do mouse; só :focus-visible distingue os dois casos.
// Se a gravação falhar, o erro aparece abaixo da busca, pois o card não tem onde mostrá-lo
async function hideItem(key, card, hideBtn) {
  const index = getResultCards().indexOf(card);
  const byKeyboard = hideBtn.matches(':focus-visible');

  const hidden = await saveHiddenItems(keys => keys.includes(key) ? keys : [...keys, key]);
  if (!hidden || !byKeyboard) return;

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

// --- Configurações ---

// O botão só aparece quando há algo para mostrar de novo
function updateHiddenButton() {
  const btn = document.getElementById('open-hidden-btn');
  btn.hidden = hiddenItems.length === 0;
  btn.textContent = `⊘ Ocultos (${hiddenItems.length})`;
}

// openOptionsPage reaproveita a aba de configurações já aberta, mas não aceita âncora: a seção
// pedida vai pelo storage.session, que a página lê ao abrir ou, se já estava aberta, ao mudar
function setupSettingsButtons() {
  document.getElementById('open-settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('open-hidden-btn').addEventListener('click', async () => {
    await chrome.storage.session.set({ optionsSection: 'ocultos' });
    chrome.runtime.openOptionsPage();
  });
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

// O que as setas percorrem: os cards, as páginas encontradas abaixo deles e os botões "Mostrar mais"
const NAVIGABLE_SELECTOR = '.item-card, .item-page, .list-toggle';

function getNavigableItems() {
  return Array.from(document.querySelector('.container').querySelectorAll(NAVIGABLE_SELECTOR));
}

// ↑/↓ percorrem os cards, as páginas encontradas e os botões "Mostrar mais"; ↑ no primeiro volta para a busca.
// Enter e Ctrl+Enter num card focado já são tratados pelo próprio link
function setupResultsNavigation(input) {
  document.querySelector('.container').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    const card = e.target.closest(NAVIGABLE_SELECTOR);
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
      const card = getResultCards()[0];
      if (!card) return;
      // Se o card só aparece por causa de uma página interna, é ela que o usuário procura
      const first = card.parentElement.querySelector('.item-page') || card;
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
      if (document.activeElement === document.body) {
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
    if (target.isContentEditable || target.closest('input, textarea, select')) return;

    e.preventDefault();
    input.focus();
    input.select();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupSearch();
  setupSettingsButtons();
  // O período fica de fora: trocá-lo em outra aba não deve recarregar o histórico desta
  const settings = [gitHostsSetting, urlGroupsSetting, hiddenItemsSetting, showMatchedPagesSetting];
  watchSyncedSettings(settings);
  await Promise.all([...settings.map(setting => setting.refresh()), loadHistoryPeriod()]);
  setupPeriodSelect();
  await loadHistory();
});
