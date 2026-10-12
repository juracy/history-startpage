import { beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, HISTORY_PAGE_SIZE } from '../lib/constants.js';
import { buildHistoryEntries, buildHostIconPages, fetchHistoryItems, fetchHostIconPages } from '../lib/history.js';
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

describe('buildHistoryEntries', () => {
  it('conta só as visitas dentro do período', async () => {
    installFakeChrome({
      visits: [
        { url: 'https://example.com/', title: '(2) Exemplo', visitTime: now - 1000 },
        { url: 'https://example.com/', visitTime: now - 2000 },
        { url: 'https://example.com/', visitTime: now - 10 * DAY_MS }
      ]
    });

    const [entry] = await buildHistoryEntries(DAY_MS, always);

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

    const entries = await buildHistoryEntries(DAY_MS, always);
    expect(entries.map(e => e.rawUrl)).toEqual(['https://recente.com/', 'https://antigo.com/']);
  });

  it('monta o texto de busca com host, caminho decodificado e título, sem acentos', async () => {
    installFakeChrome({
      visits: [{ url: 'https://wiki.com/P%C3%A1gina?q=ignorada', title: 'Configuração', visitTime: now - 1000 }]
    });

    const [entry] = await buildHistoryEntries(DAY_MS, always);
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
