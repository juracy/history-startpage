import { FRECENCY_HALF_LIVES_PER_PERIOD, FRECENCY_MAX_WINDOW_MS, HISTORY_PAGE_SIZE, VISITS_CONCURRENCY } from './constants.js';
import { cleanTitle, isRootUrl, normalizeSearchText, parseWebUrl, safeDecode } from './text.js';

// isCurrent() falso = carregamento substituído por outro; a função para e devolve null
export async function fetchHistoryItems(startTime, isCurrent) {
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

// Os horários (e não só a contagem) permitem ao cache descartar as visitas que saem da janela
// sem consultar o histórico de novo
export async function fetchVisitTimes(rawUrl, startTime) {
  const visits = await chrome.history.getVisits({ url: rawUrl });
  return visits.map(v => v.visitTime).filter(time => time >= startTime);
}

// visitCount do history.search é o total histórico; conta apenas as visitas dentro da janela.
// Devolve os registros guardados no cache: { rawUrl, title, lastVisitTime, visitTimes }.
// onProgress(feitas, total) é chamado a cada lote: em períodos longos são milhares de getVisits
export async function collectVisits(items, startTime, isCurrent, onProgress) {
  const candidates = items.filter(item => parseWebUrl(item.url));
  const records = [];
  onProgress?.(0, candidates.length);
  for (let i = 0; i < candidates.length; i += VISITS_CONCURRENCY) {
    const batch = candidates.slice(i, i + VISITS_CONCURRENCY);
    const times = await Promise.all(batch.map(item => fetchVisitTimes(item.url, startTime)));
    if (!isCurrent()) return null;
    onProgress?.(i + batch.length, candidates.length);
    batch.forEach((item, j) => {
      if (times[j].length > 0) {
        records.push({
          rawUrl: item.url,
          title: cleanTitle(item.title),
          lastVisitTime: item.lastVisitTime,
          visitTimes: times[j]
        });
      }
    });
  }
  return records;
}

// Cada visita vale 1 agora e metade a cada meia-vida; a soma ordena por "frequentes e recentes"
export function frecencyScore(visitTimes, halfLife, now) {
  let score = 0;
  for (const time of visitTimes) score += 2 ** (-Math.max(0, now - time) / halfLife);
  return score;
}

// Monta as entradas usadas pela categorização; o objeto URL e o texto de busca não vão para o cache.
// now é o fim da janela: com startTime, define a meia-vida da frecency
export function buildHistoryEntries(records, startTime, now = Date.now()) {
  const frecencyWindow = Math.min(Math.max(1, now - startTime), FRECENCY_MAX_WINDOW_MS);
  const halfLife = frecencyWindow / FRECENCY_HALF_LIVES_PER_PERIOD;
  const entries = [];
  for (const record of records) {
    const url = parseWebUrl(record.rawUrl);
    const visitTimes = record.visitTimes.filter(time => time >= startTime);
    const visits = visitTimes.length;
    if (!url || visits === 0) continue;
    entries.push({
      url,
      // O cache de favicons do Chrome é indexado pela URL como está no histórico
      rawUrl: record.rawUrl,
      title: record.title,
      lastVisitTime: record.lastVisitTime,
      visits,
      score: frecencyScore(visitTimes, halfLife, now),
      // Como nos agrupamentos, só host + caminho: query e hash (redirects, buscas) não contam
      searchText: normalizeSearchText(`${safeDecode(url.host + url.pathname)}\n${record.title}`)
    });
  }

  entries.sort((a, b) => b.lastVisitTime - a.lastVisitTime);
  return entries;
}

// O ícone do site sai da raiz do host: páginas internas podem trocar o favicon
// (status de pipeline, contador de não lidas). Entre várias raízes, vale a mais recente
export function buildHostIconPages(entries) {
  const pages = new Map();
  for (const { url, rawUrl } of entries) {
    const host = url.host.replace(/^www\./, '');
    if (!pages.has(host) && isRootUrl(url, 0)) pages.set(host, rawUrl);
  }
  return pages;
}

// Para a página de configurações, que não tem o histórico processado do painel. Basta uma página
// do history.search, sem contar visitas: só se procuram as raízes visitadas dos hosts
export async function fetchHostIconPages() {
  const items = await chrome.history.search({ text: '', startTime: 0, maxResults: HISTORY_PAGE_SIZE });
  const entries = items
    .map(item => ({ url: parseWebUrl(item.url), rawUrl: item.url }))
    .filter(entry => entry.url);
  return buildHostIconPages(entries);
}
