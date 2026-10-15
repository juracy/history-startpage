import { beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, HISTORY_PAGE_SIZE, VISITS_CONCURRENCY } from '../lib/constants.js';
import {
  buildHistoryEntries, buildHostIconPages, collectVisits, fetchHistoryItems, fetchHostIconPages
} from '../lib/history.js';
import { installFakeChrome } from './fake-chrome.js';

const always = () => true;
let now;

beforeEach(() => {
  now = Date.now();
});

describe('fetchHistoryItems', () => {
  it('pagina por endTime até esgotar o período', async () => {
    const total = HISTORY_PAGE_SIZE + 3;
    const visits = Array.from({ length: total }, (_, i) => ({ url: `https://example.com/${i}`, visitTime: now - 1000 - i }));
    const chrome = installFakeChrome({ visits });

    const items = await fetchHistoryItems(now - DAY_MS, always);

    expect(items).toHaveLength(total);
    expect(chrome.history.searchCalls).toHaveLength(2);
  });

  it('para e devolve null quando o carregamento foi substituído', async () => {
    installFakeChrome({ visits: [{ url: 'https://example.com/', visitTime: now - 1000 }] });
    expect(await fetchHistoryItems(now - DAY_MS, () => false)).toBeNull();
  });
});

async function loadEntries(periodMs) {
  const startTime = now - periodMs;
  const records = await collectVisits(await fetchHistoryItems(startTime, always), startTime, always);
  return buildHistoryEntries(records, startTime);
}

describe('collectVisits', () => {
  it('guarda os horários das visitas dentro do período, com o título limpo', async () => {
    installFakeChrome({
      visits: [
        { url: 'https://example.com/', title: '(2) Exemplo', visitTime: now - 1000 },
        { url: 'https://example.com/', visitTime: now - 10 * DAY_MS },
        { url: 'chrome://extensions/', visitTime: now - 500 }
      ]
    });
    const startTime = now - DAY_MS;

    const records = await collectVisits(await fetchHistoryItems(startTime, always), startTime, always);

    expect(records).toEqual([
      { rawUrl: 'https://example.com/', title: 'Exemplo', lastVisitTime: now - 1000, visitTimes: [now - 1000] }
    ]);
  });

  it('para e devolve null quando o carregamento foi substituído', async () => {
    installFakeChrome({ visits: [{ url: 'https://example.com/', visitTime: now - 1000 }] });
    const items = await fetchHistoryItems(now - DAY_MS, always);
    expect(await collectVisits(items, now - DAY_MS, () => false)).toBeNull();
  });

  it('informa o progresso a cada lote, só com as URLs consideradas', async () => {
    const total = VISITS_CONCURRENCY + 5;
    installFakeChrome({
      visits: [
        ...Array.from({ length: total }, (_, i) => ({ url: `https://example.com/${i}`, visitTime: now - 1000 - i })),
        { url: 'chrome://extensions/', visitTime: now - 500 }
      ]
    });
    const items = await fetchHistoryItems(now - DAY_MS, always);
    const progress = [];

    await collectVisits(items, now - DAY_MS, always, (done, count) => progress.push([done, count]));

    expect(progress).toEqual([[0, total], [VISITS_CONCURRENCY, total], [total, total]]);
  });
});

describe('buildHistoryEntries', () => {
  it('ignora as visitas guardadas que saíram do período', () => {
    const records = [
      { rawUrl: 'https://a.com/', title: 'A', lastVisitTime: now - 1000, visitTimes: [now - 1000, now - 2 * DAY_MS] },
      { rawUrl: 'https://b.com/', title: 'B', lastVisitTime: now - 3 * DAY_MS, visitTimes: [now - 3 * DAY_MS] }
    ];

    const entries = buildHistoryEntries(records, now - DAY_MS);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ rawUrl: 'https://a.com/', visits: 1 });
  });

  it('conta só as visitas dentro do período', async () => {
    installFakeChrome({
      visits: [
        { url: 'https://example.com/', title: '(2) Exemplo', visitTime: now - 1000 },
        { url: 'https://example.com/', visitTime: now - 2000 },
        { url: 'https://example.com/', visitTime: now - 10 * DAY_MS }
      ]
    });

    const [entry] = await loadEntries(DAY_MS);

    expect(entry).toMatchObject({ rawUrl: 'https://example.com/', title: 'Exemplo', visits: 2 });
    expect(entry.url).toBeInstanceOf(URL);
  });

  it('descarta protocolos e hosts excluídos e ordena do mais recente ao mais antigo', async () => {
    installFakeChrome({
      visits: [
        { url: 'https://antigo.com/', visitTime: now - 5000 },
        { url: 'chrome://extensions/', visitTime: now - 4000 },
        { url: 'http://localhost:3000/', visitTime: now - 3000 },
        { url: 'https://recente.com/', visitTime: now - 1000 }
      ]
    });

    const entries = await loadEntries(DAY_MS);
    expect(entries.map(e => e.rawUrl)).toEqual(['https://recente.com/', 'https://antigo.com/']);
  });

  it('monta o texto de busca com host, caminho decodificado e título, sem acentos', async () => {
    installFakeChrome({
      visits: [{ url: 'https://wiki.com/P%C3%A1gina?q=ignorada', title: 'Configuração', visitTime: now - 1000 }]
    });

    const [entry] = await loadEntries(DAY_MS);
    expect(entry.searchText).toBe('wiki.com/pagina\nconfiguracao');
  });
});

describe('buildHostIconPages', () => {
  it('usa a raiz mais recente de cada host, sem www', () => {
    const entries = ['https://www.example.com/', 'https://example.com/?x=1', 'https://outro.com/pagina']
      .map(rawUrl => ({ url: new URL(rawUrl), rawUrl }));

    expect(buildHostIconPages(entries)).toEqual(new Map([['example.com', 'https://www.example.com/']]));
  });
});

describe('fetchHostIconPages', () => {
  it('acha a raiz mais recente de cada host em todo o histórico, ignorando URLs que não são web', async () => {
    installFakeChrome({
      visits: [
        { url: 'https://www.example.com/', visitTime: now - 400 * DAY_MS },
        { url: 'https://example.com/', visitTime: now - 500 * DAY_MS },
        { url: 'http://intranet.local/', visitTime: now - 1000 },
        { url: 'chrome://settings/', visitTime: now - 10 }
      ]
    });

    expect(await fetchHostIconPages()).toEqual(new Map([
      ['intranet.local', 'http://intranet.local/'],
      ['example.com', 'https://www.example.com/']
    ]));
  });
});
