// Substitutos mínimos das APIs chrome.* usadas em lib/, instalados em globalThis.chrome

export function createFakeChrome({ storage = {}, visits = [] } = {}) {
  const data = structuredClone(storage);
  const store = {
    data,
    failNextSet: null,
    async get(defaults) {
      const result = {};
      for (const [key, value] of Object.entries(defaults)) {
        result[key] = Object.hasOwn(data, key) ? structuredClone(data[key]) : value;
      }
      return result;
    },
    async set(items) {
      if (store.failNextSet) {
        const error = store.failNextSet;
        store.failNextSet = null;
        throw error;
      }
      Object.assign(data, structuredClone(items));
    }
  };

  // visits: [{ url, title, visitTime }]; cada URL vira um item com o horário da visita mais recente,
  // como no chrome.history.search
  const items = new Map();
  for (const visit of visits) {
    const item = items.get(visit.url);
    if (!item) {
      items.set(visit.url, { id: String(items.size + 1), url: visit.url, title: visit.title ?? '', lastVisitTime: visit.visitTime });
    } else if (visit.visitTime > item.lastVisitTime) {
      item.lastVisitTime = visit.visitTime;
      if (visit.title !== undefined) item.title = visit.title;
    }
  }

  const history = {
    searchCalls: [],
    async search({ startTime = 0, endTime = Infinity, maxResults = 100 }) {
      history.searchCalls.push({ startTime, endTime, maxResults });
      return [...items.values()]
        .filter(item => item.lastVisitTime >= startTime && item.lastVisitTime < endTime)
        .sort((a, b) => b.lastVisitTime - a.lastVisitTime)
        .slice(0, maxResults)
        .map(item => ({ ...item }));
    },
    async getVisits({ url }) {
      return visits.filter(v => v.url === url).map(v => ({ visitTime: v.visitTime }));
    }
  };

  return { storage: { sync: store }, history };
}

export function installFakeChrome(options) {
  const chrome = createFakeChrome(options);
  globalThis.chrome = chrome;
  return chrome;
}
