import { HISTORY_CACHE_FULL_RELOAD_MS, HISTORY_CACHE_WRITE_INTERVAL_MS } from './constants.js';
import { collectVisits, fetchHistoryItems } from './history.js';

// Sobe quando o formato dos registros muda: um cache de outra versão é refeito do zero
export const HISTORY_CACHE_VERSION = 1;

// Um cache só, do maior período carregado: os períodos menores são filtrados dele na exibição.
// O estado fica numa chave à parte, pequena, para que a decisão de gravar não precise ler os registros
const CACHE_KEY = 'historyCache';
const STATE_KEY = 'historyCacheState';

function isValidRecord(record) {
  // Os horários não são conferidos um a um: o cache pode ter centenas de milhares deles
  return record && typeof record.rawUrl === 'string' && typeof record.title === 'string'
    && Number.isFinite(record.lastVisitTime) && Array.isArray(record.visitTimes);
}

// O storage.local pode ter sido gravado por outra versão ou corrompido; qualquer problema vira null,
// e o painel refaz a carga completa. Um cache de período menor que o pedido contaria visitas a menos
export async function readHistoryCache(period, now = Date.now()) {
  try {
    const { [CACHE_KEY]: cache } = await chrome.storage.local.get({ [CACHE_KEY]: null });
    if (!cache || cache.version !== HISTORY_CACHE_VERSION) return null;
    if (!Number.isFinite(cache.periodMs) || cache.periodMs < period.ms) return null;
    if (!Number.isFinite(cache.builtAt) || !Number.isFinite(cache.updatedAt)) return null;
    // Mais velho que a janela, nenhuma visita guardada continua valendo
    if (cache.updatedAt > now || cache.updatedAt < now - cache.periodMs) return null;
    if (!Array.isArray(cache.records) || !cache.records.every(isValidRecord)) return null;
    return cache;
  } catch (e) {
    console.error('Falha ao ler o cache do histórico:', e);
    return null;
  }
}

// startedAt é o momento em que a aba leu o cache. Não grava (e devolve false) se, depois disso,
// o service worker tirou páginas apagadas do cache (gravar devolveria essas páginas), se outra aba
// gravou uma carga completa mais nova ou se gravou a mesma há menos de HISTORY_CACHE_WRITE_INTERVAL_MS
export async function writeHistoryCache(cache, startedAt) {
  const { [STATE_KEY]: state } = await chrome.storage.local.get({ [STATE_KEY]: {} });
  if (state.invalidatedAt >= startedAt) return false;
  if (cache.builtAt < state.builtAt) return false;
  if (cache.builtAt === state.builtAt && state.updatedAt > cache.updatedAt - HISTORY_CACHE_WRITE_INTERVAL_MS) return false;

  await chrome.storage.local.set({
    [CACHE_KEY]: cache,
    [STATE_KEY]: { ...state, builtAt: cache.builtAt, updatedAt: cache.updatedAt }
  });
  return true;
}

// Chamado pelo service worker quando o histórico é apagado: a atualização incremental só acrescenta
// visitas e não perceberia a remoção. Apagar tudo descarta o cache; nos demais casos (inclusive a
// expiração automática do histórico antigo), só saem as URLs removidas, sem obrigar a uma carga completa
export async function removeFromHistoryCache({ allHistory, urls = [] }, now = Date.now()) {
  const { [CACHE_KEY]: cache, [STATE_KEY]: state } =
    await chrome.storage.local.get({ [CACHE_KEY]: null, [STATE_KEY]: {} });

  if (allHistory || !cache || !Array.isArray(cache.records)) {
    // O estado vai antes, para que nenhuma aba volte a gravar o cache que está sendo apagado
    await chrome.storage.local.set({ [STATE_KEY]: { invalidatedAt: now } });
    await chrome.storage.local.remove(CACHE_KEY);
    return;
  }

  const removed = new Set(urls);
  await chrome.storage.local.set({
    [CACHE_KEY]: { ...cache, records: cache.records.filter(record => !removed.has(record.rawUrl)) },
    [STATE_KEY]: { ...state, invalidatedAt: now }
  });
}

// builtAt e updatedAt são o início da carga: o que for visitado durante ela entra na próxima atualização
export async function buildHistoryCache(periodMs, isCurrent, now = Date.now()) {
  const startTime = now - periodMs;
  const items = await fetchHistoryItems(startTime, isCurrent);
  if (!items) return null;
  const records = await collectVisits(items, startTime, isCurrent);
  if (!records) return null;
  return { version: HISTORY_CACHE_VERSION, periodMs, builtAt: now, updatedAt: now, records };
}

// Só as URLs visitadas desde a última atualização voltam a consultar getVisits; nas demais,
// basta descartar as visitas que saíram da janela. changed evita redesenhar e regravar à toa
export async function refreshHistoryCache(cache, isCurrent, now = Date.now()) {
  const startTime = now - cache.periodMs;
  const items = await fetchHistoryItems(cache.updatedAt, isCurrent);
  if (!items) return null;
  const fresh = await collectVisits(items, startTime, isCurrent);
  if (!fresh) return null;

  const freshUrls = new Set(fresh.map(record => record.rawUrl));
  let changed = fresh.length > 0;
  const kept = [];
  for (const record of cache.records) {
    if (freshUrls.has(record.rawUrl)) continue;
    const visitTimes = record.visitTimes.filter(time => time >= startTime);
    if (visitTimes.length !== record.visitTimes.length) changed = true;
    if (visitTimes.length > 0) kept.push({ ...record, visitTimes });
  }

  return { cache: { ...cache, updatedAt: now, records: [...fresh, ...kept] }, changed };
}

// Sem cache utilizável, carga completa do período pedido; com cache de mais de um dia, carga completa
// do período que ele cobre; nos demais casos, atualização incremental. null = carregamento substituído
export async function updateHistoryCache(cache, period, isCurrent, now = Date.now()) {
  if (cache && now - cache.builtAt <= HISTORY_CACHE_FULL_RELOAD_MS) {
    return refreshHistoryCache(cache, isCurrent, now);
  }
  const built = await buildHistoryCache(cache ? cache.periodMs : period.ms, isCurrent, now);
  return built && { cache: built, changed: true };
}
