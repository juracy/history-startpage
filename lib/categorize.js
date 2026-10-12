import { parseGitRepository } from './forges.js';
import { isRootUrl, safeDecode, stripRepoTitle } from './text.js';

// Todos os termos precisam aparecer na URL ou no título (em qualquer ordem)
export function matchesSearch(searchText, searchTerms) {
  return searchTerms.every(term => searchText.includes(term));
}

// Acumula visitas e candidatos a título e a página do ícone; resolveAggregate reduz a
// { key, name, url, count, title, iconPageUrl }. matched indica se alguma URL do item casou com a busca
export function newAggregate(key, name, url, allowFallback, hostIconPage) {
  return {
    key, name, url, count: 0, allowFallback, hostIconPage, rootTitle: '', topTitle: '', topTitleVisits: 0,
    rootPageUrl: '', topPageUrl: '', topPageVisits: 0, matched: false
  };
}

export function trackVisit(target, pageUrl, title, visits, isRoot, matched) {
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
export function resolveAggregate({ key, name, url, count, allowFallback, hostIconPage, rootTitle, topTitle, rootPageUrl, topPageUrl }) {
  const title = rootTitle || (allowFallback ? topTitle : '');
  const iconPageUrl = hostIconPage || rootPageUrl || (allowFallback ? topPageUrl : '') || url;
  return { key, name, url, count, title: title === name ? '' : title, iconPageUrl };
}

// Com busca ativa, descarta os itens sem nenhuma URL encontrada
export function resolveBucket(bucket) {
  for (const [key, aggregate] of bucket) {
    if (aggregate.matched) bucket.set(key, resolveAggregate(aggregate));
    else bucket.delete(key);
  }
}

// Casa o trecho só com host + caminho, para que query e hash (buscas, redirects) não contem
export function findUrlGroupIndex(url, urlGroups) {
  if (urlGroups.length === 0) return -1;
  const haystack = safeDecode(url.host + url.pathname).toLowerCase();
  return urlGroups.findIndex(g => haystack.includes(g.pattern));
}

// gitHosts: [{ host, forge }]; urlGroups: [{ id, title, pattern }]; searchTerms já normalizados;
// hostIconPages: host → página raiz de onde vem o ícone; hiddenKeys: chaves dos itens ocultos
export function categorizeHistory(entries, { gitHosts, urlGroups, searchTerms, hostIconPages, hiddenKeys = new Set() }) {
  const gitForges = new Map(gitHosts.map(h => [h.host, h.forge]));
  const userGroups = new Map(urlGroups.map(g => [g.id, new Map()]));
  const projectGroups = new Map();
  const domainCounts = new Map();

  const classified = entries.map(entry => {
    const hostname = entry.url.hostname.replace(/^www\./, '');
    const forge = gitForges.get(hostname);
    const repoInfo = forge ? parseGitRepository(entry.url, forge) : null;
    const domainKey = entry.url.host.replace(/^www\./, '');
    const key = repoInfo ? `repo:${repoInfo.uniqueKey}` : `domain:${domainKey}`;
    return { ...entry, hostname, repoInfo, domainKey, key, groupIndex: findUrlGroupIndex(entry.url, urlGroups) };
  }).filter(({ key }) => !hiddenKeys.has(key));

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
    const matched = !filtering || matchesSearch(searchText, searchTerms);

    const groupIndex = groupIndexByKey.get(key);
    const urlGroup = groupIndex === undefined ? null : urlGroups[groupIndex];

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
      aggregate = bucket.get(key) || newAggregate(key, name, repoInfo.repoUrl, false, hostIconPages.get(domainKey));
      trackVisit(aggregate, rawUrl, stripRepoTitle(title, repoInfo.fullPath), visits, repoInfo.isRoot, matched);
    } else {
      // Demais domínios: agrupa por host + porta; o link usa a origem do acesso mais recente
      bucket = urlGroup ? userGroups.get(urlGroup.id) : domainCounts;
      aggregate = bucket.get(key) || newAggregate(key, domainKey, url.origin, true, hostIconPages.get(domainKey));
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
