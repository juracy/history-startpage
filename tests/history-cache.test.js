import { beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, HISTORY_CACHE_FULL_RELOAD_MS, HISTORY_CACHE_WRITE_INTERVAL_MS, findPeriod } from '../lib/constants.js';
import {
  HISTORY_CACHE_VERSION, buildHistoryCache, readHistoryCache, refreshHistoryCache, removeFromHistoryCache,
  updateHistoryCache, writeHistoryCache
} from '../lib/history-cache.js';
import { installFakeChrome } from './fake-chrome.js';

const always = () => true;
const day = findPeriod('1d');
const week = findPeriod('7d');
let now;

beforeEach(() => {
  now = Date.now();
});

function cacheOf(records, { periodMs = day.ms, builtAt = now - 1000, updatedAt = builtAt } = {}) {
  return { version: HISTORY_CACHE_VERSION, periodMs, builtAt, updatedAt, records };
}

function record(rawUrl, visitTimes, title = '') {
  return { rawUrl, title, lastVisitTime: Math.max(...visitTimes), visitTimes };
}

describe('readHistoryCache', () => {
  it('serve o período do cache e os menores, mas não os maiores', async () => {
    const cache = cacheOf([record('https://a.com/', [now - 2000])], { periodMs: week.ms });
    installFakeChrome({ local: { historyCache: cache } });

    expect(await readHistoryCache(day, now)).toEqual(cache);
    expect(await readHistoryCache(week, now)).toEqual(cache);
    expect(await readHistoryCache(findPeriod('30d'), now)).toBeNull();
  });

  it.each([
    ['de outra versão', { version: HISTORY_CACHE_VERSION + 1 }],
    ['mais velho que a janela', { updatedAt: now - 2 * DAY_MS }],
    ['do futuro', { updatedAt: now + 60_000 }],
    ['sem carimbo da carga completa', { builtAt: undefined }],
    ['com registro malformado', { records: [{ rawUrl: 'https://a.com/', visitTimes: 'x' }] }]
  ])('descarta o cache %s', async (_, override) => {
    installFakeChrome({ local: { historyCache: { ...cacheOf([record('https://a.com/', [now - 2000])]), ...override } } });
    expect(await readHistoryCache(day, now)).toBeNull();
  });
});

describe('writeHistoryCache', () => {
  it('grava o cache e o estado', async () => {
    const chrome = installFakeChrome();
    const cache = cacheOf([record('https://a.com/', [now - 2000])], { builtAt: now });

    expect(await writeHistoryCache(cache, now)).toBe(true);

    expect(chrome.storage.local.data.historyCache).toEqual(cache);
    expect(chrome.storage.local.data.historyCacheState).toEqual({ builtAt: now, updatedAt: now });
  });

  it('não grava se o cache foi alterado por uma remoção depois que a aba o leu', async () => {
    const chrome = installFakeChrome({ local: { historyCacheState: { invalidatedAt: now + 10 } } });

    expect(await writeHistoryCache(cacheOf([], { builtAt: now }), now)).toBe(false);
    expect(chrome.storage.local.data.historyCache).toBeUndefined();
  });

  it('não sobrescreve uma carga completa mais nova', async () => {
    installFakeChrome({ local: { historyCacheState: { builtAt: now, updatedAt: now } } });
    expect(await writeHistoryCache(cacheOf([], { builtAt: now - DAY_MS, updatedAt: now + 60_000 }), now)).toBe(false);
  });

  it('não regrava a mesma carga logo depois de outra aba', async () => {
    const builtAt = now - DAY_MS;
    installFakeChrome({ local: { historyCacheState: { builtAt, updatedAt: now } } });
    const soon = now + HISTORY_CACHE_WRITE_INTERVAL_MS / 2;
    const later = now + HISTORY_CACHE_WRITE_INTERVAL_MS * 2;

    expect(await writeHistoryCache(cacheOf([], { builtAt, updatedAt: soon }), soon)).toBe(false);
    expect(await writeHistoryCache(cacheOf([], { builtAt, updatedAt: later }), later)).toBe(true);
  });

  it('grava uma carga completa nova mesmo logo depois de outra gravação', async () => {
    installFakeChrome({ local: { historyCacheState: { builtAt: now - DAY_MS, updatedAt: now - 1000 } } });
    expect(await writeHistoryCache(cacheOf([], { builtAt: now }), now)).toBe(true);
  });
});

describe('removeFromHistoryCache', () => {
  it('tira só as URLs removidas e marca o estado', async () => {
    const cache = cacheOf([record('https://a.com/', [now - 2000]), record('https://b.com/', [now - 2000])]);
    const chrome = installFakeChrome({ local: { historyCache: cache, historyCacheState: { builtAt: cache.builtAt } } });

    await removeFromHistoryCache({ allHistory: false, urls: ['https://a.com/'] }, now);

    expect(chrome.storage.local.data.historyCache.records.map(r => r.rawUrl)).toEqual(['https://b.com/']);
    expect(chrome.storage.local.data.historyCacheState).toEqual({ builtAt: cache.builtAt, invalidatedAt: now });
  });

  it('apaga o cache quando todo o histórico é apagado', async () => {
    const chrome = installFakeChrome({ local: { historyCache: cacheOf([]), outra: 1 } });

    await removeFromHistoryCache({ allHistory: true, urls: [] }, now);

    expect(chrome.storage.local.data).toEqual({ outra: 1, historyCacheState: { invalidatedAt: now } });
  });

  it('impede que uma aba que leu o cache antes da remoção o regrave', async () => {
    installFakeChrome({ local: { historyCache: cacheOf([record('https://a.com/', [now - 2000])]) } });
    const startedAt = now - 100;

    await removeFromHistoryCache({ allHistory: false, urls: ['https://a.com/'] }, now);

    expect(await writeHistoryCache(cacheOf([record('https://a.com/', [now - 2000])], { builtAt: startedAt }), startedAt))
      .toBe(false);
  });
});

describe('buildHistoryCache', () => {
  it('monta os registros do período a partir do início da carga', async () => {
    installFakeChrome({
      visits: [
        { url: 'https://a.com/', title: 'A', visitTime: now - 1000 },
        { url: 'https://a.com/', visitTime: now - 2 * DAY_MS }
      ]
    });

    const cache = await buildHistoryCache(day.ms, always, now);

    expect(cache).toEqual(cacheOf([record('https://a.com/', [now - 1000], 'A')], { builtAt: now }));
  });

  it('devolve null quando o carregamento foi substituído', async () => {
    installFakeChrome({ visits: [{ url: 'https://a.com/', visitTime: now - 1000 }] });
    expect(await buildHistoryCache(day.ms, () => false, now)).toBeNull();
  });
});

describe('refreshHistoryCache', () => {
  it('consulta só as URLs visitadas desde a última atualização', async () => {
    const updatedAt = now - 60_000;
    const chrome = installFakeChrome({
      visits: [
        { url: 'https://a.com/', visitTime: now - 120_000 },
        { url: 'https://b.com/', visitTime: now - 90_000 },
        { url: 'https://b.com/', title: 'B', visitTime: now - 1000 }
      ]
    });
    const cache = cacheOf(
      [record('https://a.com/', [now - 120_000]), record('https://b.com/', [now - 90_000])],
      { builtAt: now - 120_000, updatedAt }
    );

    const result = await refreshHistoryCache(cache, always, now);

    expect(chrome.history.searchCalls[0].startTime).toBe(updatedAt);
    expect(chrome.history.getVisitsCalls).toEqual(['https://b.com/']);
    expect(result.changed).toBe(true);
    expect(result.cache).toMatchObject({ builtAt: cache.builtAt, updatedAt: now });
    expect(result.cache.records).toEqual([
      record('https://b.com/', [now - 90_000, now - 1000], 'B'),
      record('https://a.com/', [now - 120_000])
    ]);
  });

  it('usa a janela do período do cache, e não a do período exibido', async () => {
    installFakeChrome();
    const cache = cacheOf([record('https://a.com/', [now - 3 * DAY_MS])], { periodMs: week.ms, updatedAt: now - 500 });

    const result = await refreshHistoryCache(cache, always, now);

    expect(result.changed).toBe(false);
    expect(result.cache.records).toEqual(cache.records);
  });

  it('descarta as visitas que saíram da janela e os registros que ficaram vazios', async () => {
    installFakeChrome();
    const cache = cacheOf([
      record('https://a.com/', [now - 2 * DAY_MS, now - 1000]),
      record('https://b.com/', [now - 2 * DAY_MS])
    ], { updatedAt: now - 500 });

    const result = await refreshHistoryCache(cache, always, now);

    expect(result.changed).toBe(true);
    expect(result.cache.records).toEqual([record('https://a.com/', [now - 1000])]);
  });

  it('devolve null quando o carregamento foi substituído', async () => {
    installFakeChrome({ visits: [{ url: 'https://a.com/', visitTime: now - 100 }] });
    expect(await refreshHistoryCache(cacheOf([]), () => false, now)).toBeNull();
  });
});

describe('updateHistoryCache', () => {
  const visits = () => [{ url: 'https://a.com/', visitTime: now - 1000 }];

  it('faz a carga completa do período pedido quando não há cache', async () => {
    installFakeChrome({ visits: visits() });

    const result = await updateHistoryCache(null, week, always, now);

    expect(result.changed).toBe(true);
    expect(result.cache).toMatchObject({ periodMs: week.ms, builtAt: now });
  });

  it('atualiza de forma incremental um cache recente', async () => {
    const chrome = installFakeChrome({ visits: visits() });
    const cache = cacheOf([], { periodMs: week.ms, builtAt: now - 60_000 });

    const result = await updateHistoryCache(cache, day, always, now);

    expect(chrome.history.searchCalls[0].startTime).toBe(cache.updatedAt);
    expect(result.cache.builtAt).toBe(cache.builtAt);
  });

  it('informa o progresso só na carga completa', async () => {
    installFakeChrome({ visits: visits() });
    const progress = [];
    const onProgress = (done, total) => progress.push([done, total]);

    await updateHistoryCache(null, week, always, now, onProgress);
    expect(progress).toEqual([[0, 1], [1, 1]]);

    progress.length = 0;
    await updateHistoryCache(cacheOf([], { periodMs: week.ms, builtAt: now - 60_000 }), day, always, now, onProgress);
    expect(progress).toEqual([]);
  });

  it('refaz a carga completa, no período do cache, quando ela tem mais de um dia', async () => {
    const chrome = installFakeChrome({ visits: visits() });
    const cache = cacheOf([], { periodMs: week.ms, builtAt: now - HISTORY_CACHE_FULL_RELOAD_MS - 1, updatedAt: now - 60_000 });

    const result = await updateHistoryCache(cache, day, always, now);

    expect(chrome.history.searchCalls[0].startTime).toBe(now - week.ms);
    expect(result).toMatchObject({ changed: true, cache: { periodMs: week.ms, builtAt: now } });
  });
});
