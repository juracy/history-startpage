import { DEFAULT_FORGE, GIT_FORGES, findKnownForge, upsertGitHost } from './lib/forges.js';
import { moveGroup, updateGroup } from './lib/groups.js';
import { fetchHostIconPages } from './lib/history.js';
import {
  createSaveQueue, createSyncedSetting, readGitHosts, readHiddenItems, readUrlGroups, watchSyncedSettings,
  writeGitHosts, writeHiddenItems, writeUrlGroups
} from './lib/storage.js';
import { normalizeHost, normalizePattern, safeDecode, splitItemKey } from './lib/text.js';
import { createFavicon, hostIconPage, renderMessage, showError } from './dom.js';

// Hosts Git monitorados: [{ host, forge }]
let currentGitHosts = [];

// Agrupamentos do usuário: [{ id, title, pattern }]; a primeira regra que casar vence
let currentUrlGroups = [];

// Agrupamento carregado no formulário para edição; null = formulário de inclusão
let editingGroupId = null;

// Chaves dos itens ocultos pelo usuário ("repo:host/caminho" ou "domain:host")
let hiddenItems = [];

// Página raiz visitada de cada host (sem "www."), de onde vem o ícone do site
let hostIconPages = new Map();

// --- Gravação ---

const enqueueSave = createSaveQueue();

const gitHostsSetting = createSyncedSetting({
  keys: ['gitHosts', 'gitHostForges'], read: readGitHosts, write: writeGitHosts, enqueue: enqueueSave,
  onChange: (hosts) => {
    currentGitHosts = hosts;
    renderGitHostsList();
  }
});

const urlGroupsSetting = createSyncedSetting({
  keys: ['urlGroups'], read: readUrlGroups, write: writeUrlGroups, enqueue: enqueueSave,
  onChange: (groups) => {
    currentUrlGroups = groups;
    // Um agrupamento em edição que sumiu em outro lugar não pode mais ser salvo
    if (editingGroupId && !groups.some(g => g.id === editingGroupId)) setGroupEditing(null);
    else renderGroupsList();
  }
});

const hiddenItemsSetting = createSyncedSetting({
  keys: ['hiddenItems'], read: readHiddenItems, write: writeHiddenItems, enqueue: enqueueSave,
  onChange: (keys) => {
    hiddenItems = keys;
    renderHiddenList();
  }
});

// O erro de gravação aparece na própria seção; devolve se a gravação deu certo
async function saveSetting(setting, errorId, label, update) {
  try {
    await setting.save(update);
  } catch (e) {
    console.error(`Falha ao salvar ${label}:`, e);
    showFormError(errorId, `Não foi possível salvar: ${e.message}`);
    return false;
  }
  showFormError(errorId, '');
  return true;
}

const saveGitHosts = update => saveSetting(gitHostsSetting, 'hosts-error', 'hosts Git', update);
const saveUrlGroups = update => saveSetting(urlGroupsSetting, 'groups-error', 'agrupamentos', update);
const saveHiddenItems = update => saveSetting(hiddenItemsSetting, 'hidden-error', 'itens ocultos', update);

// --- Renderização ---

function showFormError(id, message) {
  showError(document.getElementById(id), message);
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

function renderGitHostsList() {
  const listEl = document.getElementById('registered-domains');

  if (currentGitHosts.length === 0) {
    renderMessage(listEl, 'Nenhum host cadastrado.');
    return;
  }

  listEl.replaceChildren(...currentGitHosts.map(({ host, forge }) => {
    const label = document.createElement('span');
    label.className = 'tag-label';

    const nameEl = document.createElement('span');
    nameEl.textContent = host;

    const forgeEl = document.createElement('span');
    forgeEl.className = 'tag-forge';
    forgeEl.textContent = GIT_FORGES[forge].label;

    label.append(createFavicon(hostIconPage(hostIconPages, host)), nameEl, forgeEl);
    return createTagItem(label, `Remover ${host}`, () => saveGitHosts(hosts => hosts.filter(h => h.host !== host)));
  }));
}

function renderGroupsList() {
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

// Carrega um agrupamento no formulário para edição, ou volta ao modo de inclusão
function setGroupEditing(group) {
  const titleInput = document.getElementById('group-title-input');
  editingGroupId = group?.id ?? null;
  titleInput.value = group?.title ?? '';
  document.getElementById('group-pattern-input').value = group?.pattern ?? '';
  document.getElementById('add-group-btn').textContent = group ? 'Salvar' : 'Adicionar';
  document.getElementById('cancel-group-edit-btn').hidden = !group;
  showFormError('groups-error', '');
  renderGroupsList();
  titleInput.focus();
}

function renderHiddenList() {
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

    label.append(createFavicon(hostIconPage(hostIconPages, host)), nameEl, kindEl);
    const showBtn = createActionButton('Mostrar', `Mostrar ${safeDecode(parsed.name)} de novo`,
      () => saveHiddenItems(keys => keys.filter(k => k !== key)));
    return createTagItem(label, '', null, [showBtn]);
  }));
}

// --- Formulários ---

// Ignora o Enter que confirma uma composição de IME (acentos, etc.)
function onEnter(input, handler) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) handler();
  });
}

function setupGitHosts() {
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

  const handleAdd = async () => {
    if (!input.value.trim()) return;

    const host = normalizeHost(input.value);
    if (!host) {
      showFormError('hosts-error', 'Domínio inválido.');
      return;
    }

    const saved = await saveGitHosts(hosts => upsertGitHost(hosts, { host, forge: forgeSelect.value }));
    if (saved) {
      input.value = '';
      forgeSelect.value = DEFAULT_FORGE;
      showFormError('hosts-error', '');
    }
  };

  document.getElementById('add-domain-btn').addEventListener('click', handleAdd);
  onEnter(input, handleAdd);
}

function setupUrlGroups() {
  const titleInput = document.getElementById('group-title-input');
  const patternInput = document.getElementById('group-pattern-input');

  // Durante a edição, o Esc nos campos cancela a edição
  for (const input of [titleInput, patternInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.isComposing || !editingGroupId) return;
      e.preventDefault();
      setGroupEditing(null);
    });
  }

  document.getElementById('cancel-group-edit-btn').addEventListener('click', () => setGroupEditing(null));

  const handleAdd = async () => {
    const title = titleInput.value.trim();
    const pattern = normalizePattern(patternInput.value);

    if (!title || !pattern) {
      showFormError('groups-error', 'Informe o título e o trecho da URL.');
      return;
    }

    if (currentUrlGroups.some(g => g.pattern === pattern && g.id !== editingGroupId)) {
      showFormError('groups-error', 'Já existe um agrupamento com este trecho.');
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

// --- Navegação entre seções ---

// Rola até a seção e foca o primeiro controle dela
function focusSection(id) {
  const section = document.getElementById(id);
  if (section?.tagName !== 'SECTION') return;
  section.scrollIntoView();
  section.querySelector('input, .btn-action')?.focus({ preventScroll: true });
}

// A seção pode ser pedida pela âncora (links do topo, URL digitada) ou pelo painel, que a deixa no
// storage.session porque openOptionsPage não aceita âncora. O pedido é apagado depois de atendido,
// para não valer de novo ao recarregar a página
async function setupSectionRequests() {
  window.addEventListener('hashchange', () => focusSection(location.hash.slice(1)));

  chrome.storage.onChanged.addListener((changes, area) => {
    const section = area === 'session' && changes.optionsSection?.newValue;
    if (!section) return;
    chrome.storage.session.remove('optionsSection');
    focusSection(section);
  });

  const { optionsSection } = await chrome.storage.session.get('optionsSection');
  if (optionsSection) chrome.storage.session.remove('optionsSection');
  const initial = optionsSection || location.hash.slice(1);
  if (!initial) return;

  // O Chrome aplica a âncora da URL no load, e isso tira o foco dado antes
  if (document.readyState === 'complete') focusSection(initial);
  else window.addEventListener('load', () => focusSection(initial), { once: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupGitHosts();
  setupUrlGroups();
  const settings = [gitHostsSetting, urlGroupsSetting, hiddenItemsSetting];
  watchSyncedSettings(settings);
  // Os ícones vêm antes das listas, para não desenhá-las duas vezes; sem eles, vale o globo padrão
  hostIconPages = await fetchHostIconPages().catch((e) => {
    console.error('Falha ao ler o histórico para os ícones:', e);
    return new Map();
  });
  await Promise.all(settings.map(setting => setting.refresh()));
  await setupSectionRequests();
});
