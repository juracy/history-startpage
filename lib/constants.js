export const DAY_MS = 24 * 60 * 60 * 1000;
export const HISTORY_PERIODS = [
  { id: '1d', label: '24 horas', phrase: 'nas últimas 24 horas', ms: DAY_MS },
  { id: '7d', label: '1 semana', phrase: 'na última semana', ms: 7 * DAY_MS },
  { id: '30d', label: '1 mês', phrase: 'no último mês', ms: 30 * DAY_MS },
  { id: '90d', label: '3 meses', phrase: 'nos últimos 3 meses', ms: 90 * DAY_MS },
  { id: '180d', label: '6 meses', phrase: 'nos últimos 6 meses', ms: 180 * DAY_MS },
  { id: '365d', label: '1 ano', phrase: 'no último ano', ms: 365 * DAY_MS }
];
export const DEFAULT_PERIOD_ID = '30d';
export const HISTORY_PAGE_SIZE = 5000;
export const VISITS_CONCURRENCY = 100;
export const DEFAULT_GIT_HOSTS = ['github.com', 'gitlab.com'];

// Itens exibidos antes do "Mostrar mais"; durante a busca não há corte
export const ITEMS_PER_GROUP = 5;
export const REPO_GROUPS_LIMIT = 8;
export const DOMAINS_LIMIT = 15;

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export const EXCLUDED_HOSTS = new Set([
  'localhost', '127.0.0.1'
]);

export function findPeriod(id) {
  return HISTORY_PERIODS.find(p => p.id === id) || null;
}
