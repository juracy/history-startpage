import { DEFAULT_GIT_HOSTS, DEFAULT_PERIOD_ID, DEFAULT_SORT_ID, findPeriod, findSortOrder } from './constants.js';
import { toGitHost } from './forges.js';
import { normalizeHost, normalizePattern, splitItemKey } from './text.js';

// Serializa as gravações: cada uma calcula a nova lista a partir do que a anterior salvou,
// evitando que cliques rápidos sobrescrevam uns aos outros
export function createSaveQueue() {
  let saveQueue = Promise.resolve();
  return function enqueueSave(task) {
    const run = saveQueue.then(task);
    saveQueue = run.catch(() => {});
    return run;
  };
}

// Os leitores normalizam e deduplicam: o storage pode ter sido editado à mão ou mesclado entre dispositivos

export async function readGitHosts() {
  try {
    const data = await chrome.storage.sync.get({ gitHosts: DEFAULT_GIT_HOSTS, gitHostForges: {} });
    const stored = Array.isArray(data.gitHosts) ? data.gitHosts : DEFAULT_GIT_HOSTS;
    const forges = data.gitHostForges && typeof data.gitHostForges === 'object' ? data.gitHostForges : {};
    const hosts = [...new Set(stored.map(normalizeHost).filter(Boolean))];
    return hosts.map(host => toGitHost(host, Object.hasOwn(forges, host) ? forges[host] : null));
  } catch (e) {
    console.error('Falha ao carregar hosts Git:', e);
    return DEFAULT_GIT_HOSTS.map(host => toGitHost(host));
  }
}

// O tipo fica numa chave separada para que versões anteriores continuem lendo gitHosts como lista de hosts
export function writeGitHosts(hosts) {
  return chrome.storage.sync.set({
    gitHosts: hosts.map(h => h.host),
    gitHostForges: Object.fromEntries(hosts.map(h => [h.host, h.forge]))
  });
}

export async function readUrlGroups() {
  try {
    const data = await chrome.storage.sync.get({ urlGroups: [] });
    const stored = Array.isArray(data.urlGroups) ? data.urlGroups : [];
    const seenIds = new Set();
    const seenPatterns = new Set();

    const groups = [];
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
      groups.push({ id, title, pattern });
    }
    return groups;
  } catch (e) {
    console.error('Falha ao carregar agrupamentos:', e);
    return [];
  }
}

export function writeUrlGroups(groups) {
  return chrome.storage.sync.set({ urlGroups: groups });
}

// Chaves dos itens ocultos ("repo:…" ou "domain:…", as mesmas de categorizeHistory)
export async function readHiddenItems() {
  try {
    const data = await chrome.storage.sync.get({ hiddenItems: [] });
    const stored = Array.isArray(data.hiddenItems) ? data.hiddenItems : [];
    const keys = stored.filter(key => typeof key === 'string').map(key => key.trim());
    return [...new Set(keys.filter(key => splitItemKey(key)))];
  } catch (e) {
    console.error('Falha ao carregar itens ocultos:', e);
    return [];
  }
}

export function writeHiddenItems(keys) {
  return chrome.storage.sync.set({ hiddenItems: keys });
}

export async function readHistoryPeriod() {
  try {
    const data = await chrome.storage.sync.get({ historyPeriod: DEFAULT_PERIOD_ID });
    return findPeriod(data.historyPeriod) || findPeriod(DEFAULT_PERIOD_ID);
  } catch (e) {
    console.error('Falha ao carregar o período:', e);
    return findPeriod(DEFAULT_PERIOD_ID);
  }
}

export function writeHistoryPeriod(id) {
  return chrome.storage.sync.set({ historyPeriod: id });
}

export async function readSortOrder() {
  try {
    const data = await chrome.storage.sync.get({ sortOrder: DEFAULT_SORT_ID });
    return findSortOrder(data.sortOrder) || findSortOrder(DEFAULT_SORT_ID);
  } catch (e) {
    console.error('Falha ao carregar a ordenação:', e);
    return findSortOrder(DEFAULT_SORT_ID);
  }
}

export function writeSortOrder(id) {
  return chrome.storage.sync.set({ sortOrder: id });
}

// Páginas internas encontradas pela busca, abaixo do card. Desativado por padrão: o painel fica mais limpo
export async function readShowMatchedPages() {
  try {
    const data = await chrome.storage.sync.get({ showMatchedPages: false });
    return data.showMatchedPages === true;
  } catch (e) {
    console.error('Falha ao carregar a opção de páginas encontradas:', e);
    return false;
  }
}

export function writeShowMatchedPages(enabled) {
  return chrome.storage.sync.set({ showMatchedPages: enabled });
}

// Uma configuração do storage.sync espelhada na memória da página. Cada gravação relê o storage
// dentro da fila antes de aplicar `update`: outra aba ou outro dispositivo pode ter gravado depois
// da última leitura, e partir da cópia em memória desfaria essa gravação. onChange só é chamado
// quando o valor muda, pois redesenhar à toa tira o foco do controle que acabou de ser usado
export function createSyncedSetting({ keys, read, write, enqueue, onChange }) {
  let value;
  let loaded = false;

  const apply = (next) => {
    if (loaded && JSON.stringify(next) === JSON.stringify(value)) return;
    loaded = true;
    value = next;
    onChange(next);
  };

  return {
    keys,
    refresh: () => enqueue(async () => apply(await read())),
    // update(atual) → novo valor; devolver a mesma referência significa "nada a salvar".
    // Rejeita se a gravação falhar, mantendo o valor anterior
    save: update => enqueue(async () => {
      const current = await read();
      const next = update(current);
      if (next !== current) await write(next);
      apply(next);
    })
  };
}

// Relê as configurações cujas chaves mudaram, gravadas por outra página, por outro dispositivo
// ou pela própria página (caso em que o valor não muda e nada é redesenhado)
export function watchSyncedSettings(settings) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const setting of settings) {
      if (setting.keys.some(key => Object.hasOwn(changes, key))) setting.refresh();
    }
  });
}
