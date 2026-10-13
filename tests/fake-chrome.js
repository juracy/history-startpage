// Substitutos mínimos das APIs chrome.* usadas em lib/, instalados em globalThis.chrome

function createStore(area, initial, listeners) {
  const data = structuredClone(initial);
  const emit = changes => listeners.forEach(listener => listener(changes, area));
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
      emit(Object.fromEntries(Object.keys(items).map(key => [key, { newValue: structuredClone(items[key]) }])));
    },
    async remove(keys) {
      const removed = [keys].flat().filter(key => Object.hasOwn(data, key));
      removed.forEach(key => delete data[key]);
      if (removed.length > 0) emit(Object.fromEntries(removed.map(key => [key, {}])));
    }
  };
  return store;
}

export function createFakeChrome({ storage = {}, local = {}, visits = [] } = {}) {
  const listeners = [];
  const onChanged = {
    addListener: listener => listeners.push(listener),
    // Simula uma gravação feita por outra página ou dispositivo
    emit: (changes, area = 'sync') => listeners.forEach(listener => listener(changes, area))
  };

  // visits: [{ url, title, visitTime }]; cada URL vira um item com o horário da visita mais recente,
  // como no chrome.history.search. history.visits pode ganhar visitas depois, como numa navegação
  function historyItems() {
    const items = new Map();
    for (const visit of history.visits) {
      const item = items.get(visit.url);
      if (!item) {
        items.set(visit.url, { id: String(items.size + 1), url: visit.url, title: visit.title ?? '', lastVisitTime: visit.visitTime });
      } else if (visit.visitTime > item.lastVisitTime) {
        item.lastVisitTime = visit.visitTime;
        if (visit.title !== undefined) item.title = visit.title;
      }
    }
    return [...items.values()];
  }

  const history = {
    visits: [...visits],
    searchCalls: [],
    getVisitsCalls: [],
    async search({ startTime = 0, endTime = Infinity, maxResults = 100 }) {
      history.searchCalls.push({ startTime, endTime, maxResults });
      return historyItems()
        .filter(item => item.lastVisitTime >= startTime && item.lastVisitTime < endTime)
        .sort((a, b) => b.lastVisitTime - a.lastVisitTime)
        .slice(0, maxResults);
    },
    async getVisits({ url }) {
      history.getVisitsCalls.push(url);
      return history.visits.filter(v => v.url === url).map(v => ({ visitTime: v.visitTime }));
    }
  };

  return {
    storage: { sync: createStore('sync', storage, listeners), local: createStore('local', local, listeners), onChanged },
    history
  };
}

export function installFakeChrome(options) {
  const chrome = createFakeChrome(options);
  globalThis.chrome = chrome;
  return chrome;
}
