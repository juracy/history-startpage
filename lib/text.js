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

// Trechos [início, fim) do texto original onde aparecem os termos, já normalizados, em ordem e sem
// sobreposição. Cada caractere é normalizado à parte para saber a que posição do original cada
// caractere normalizado corresponde (o NFD e a remoção dos acentos mudam o comprimento)
export function findHighlightRanges(text, searchTerms) {
  if (!text || searchTerms.length === 0) return [];
  let normalized = '';
  const starts = [];
  const ends = [];
  let index = 0;
  for (const char of text) {
    const next = index + char.length;
    const part = normalizeSearchText(char);
    if (part) {
      normalized += part;
      for (let i = 0; i < part.length; i++) {
        starts.push(index);
        ends.push(next);
      }
    } else if (ends.length > 0) {
      // Acento já decomposto no original: fica junto da letra anterior
      ends[ends.length - 1] = next;
    }
    index = next;
  }

  const ranges = [];
  for (const term of searchTerms) {
    for (let at = normalized.indexOf(term); at >= 0; at = normalized.indexOf(term, at + 1)) {
      ranges.push([starts[at], ends[at + term.length - 1]]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
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

const relativeTime = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'always' });
const RELATIVE_UNITS = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000]
];

// "há 2 horas", "há 3 dias"; menos de um minuto vira "agora há pouco"
export function formatTimeAgo(time, now = Date.now()) {
  const elapsed = Math.max(0, now - time);
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (elapsed >= ms) return relativeTime.format(-Math.floor(elapsed / ms), unit);
  }
  return 'agora há pouco';
}
