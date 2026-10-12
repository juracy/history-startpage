import { HISTORY_PAGE_SIZE, VISITS_CONCURRENCY } from './constants.js';
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

export async function countRecentVisits(rawUrl, startTime) {
  const visits = await chrome.history.getVisits({ url: rawUrl });
  return visits.filter(v => v.visitTime >= startTime).length;
}

export async function buildHistoryEntries(periodMs, isCurrent) {
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
export function buildHostIconPages(entries) {
  const pages = new Map();
  for (const { url, rawUrl } of entries) {
    const host = url.host.replace(/^www\./, '');
    if (!pages.has(host) && isRootUrl(url, 0)) pages.set(host, rawUrl);
  }
  return pages;
}
