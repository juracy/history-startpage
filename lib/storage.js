import { DEFAULT_GIT_HOSTS, DEFAULT_PERIOD_ID, findPeriod } from './constants.js';
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
