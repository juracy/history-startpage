import { ALLOWED_PROTOCOLS, EXCLUDED_HOSTS } from './constants.js';

export function normalizeHost(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;

  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '') || null;
  } catch (e) {
    return null;
  }
}

export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

// Raiz = caminho com exatamente rootSegmentCount segmentos; a query é ignorada,
// mas rotas de SPA no hash (#/... ou #!/...) contam como página interna
export function isRootUrl(url, rootSegmentCount, segmentCount = url.pathname.split('/').filter(Boolean).length) {
  return segmentCount === rootSegmentCount && !/^#!?\//.test(url.hash);
}

// Remove contadores de notificação do início, como "(17) Inbox"
export function cleanTitle(title) {
  return (title || '').trim().replace(/^\(\d+\+?\)\s*/, '');
}

// Remove do título o que o card já mostra: "GitHub - ", "owner/repo: " e " · GitLab"
export function stripRepoTitle(title, fullPath) {
  let result = title.replace(/^GitHub - /, '').replace(/\s*·\s*GitLab$/, '');
  const normalized = result.replace(/\s*\/\s*/g, '/');
  if (normalized.toLowerCase().startsWith(fullPath.toLowerCase())) {
    result = normalized.slice(fullPath.length).replace(/^[\s:·|–-]+/, '');
  }
  return result.trim();
}

// Minúsculas e sem acentos, para que "configuracao" encontre "Configuração"
export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function parseSearchTerms(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

export function normalizePattern(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function parseWebUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;

    const host = url.hostname.replace(/^www\./, '');
    if (!host || EXCLUDED_HOSTS.has(host)) return null;

    return url;
  } catch (e) {
    return null;
  }
}

// Chave de um item do painel: "repo:host/caminho" ou "domain:host"
export function splitItemKey(key) {
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  if (separator < 0 || (kind !== 'repo' && kind !== 'domain')) return null;
  const name = key.slice(separator + 1);
  return name ? { kind, name } : null;
}
