import { describe, expect, it } from 'vitest';
import { categorizeHistory } from '../lib/categorize.js';
import { normalizeSearchText, parseSearchTerms, safeDecode } from '../lib/text.js';

// Mesmo formato das entradas montadas por buildHistoryEntries
function entry(rawUrl, visits, title = '', lastVisitTime = 0) {
  const url = new URL(rawUrl);
  return {
    url, rawUrl, title, visits, lastVisitTime,
    searchText: normalizeSearchText(`${safeDecode(url.host + url.pathname)}\n${title}`)
  };
}

function categorize(entries, { gitHosts = [{ host: 'github.com', forge: 'github' }], urlGroups = [], search = '', hostIconPages = new Map(), hidden = [] } = {}) {
  return categorizeHistory(entries, { gitHosts, urlGroups, searchTerms: parseSearchTerms(search), hostIconPages, hiddenKeys: new Set(hidden) });
}

describe('categorizeHistory', () => {
  it('soma as visitas de um repositório e agrupa por host e dono', () => {
    const { projectGroups, domainCounts } = categorize([
      entry('https://github.com/dono/repo/pull/1', 3, 'Corrige bug · Pull Request #1 · dono/repo'),
      entry('https://github.com/dono/repo', 2, 'GitHub - dono/repo: Descrição do repo')
    ]);

    expect([...projectGroups.keys()]).toEqual(['github.com › dono']);
    expect([...projectGroups.get('github.com › dono').values()]).toEqual([{
      key: 'repo:github.com/dono/repo',
      name: 'repo',
      url: 'https://github.com/dono/repo',
      count: 5,
      lastVisitTime: 0,
      title: 'Descrição do repo',
      iconPageUrl: 'https://github.com/dono/repo'
    }]);
    expect(domainCounts.size).toBe(0);
  });

  it('agrega os demais endereços por host com porta, sem www', () => {
    const { domainCounts } = categorize([
      entry('https://www.example.com/a', 1),
      entry('https://example.com/b', 2),
      entry('http://intranet:8080/', 4)
    ]);

    expect(domainCounts.get('domain:example.com')).toMatchObject({ name: 'example.com', count: 3 });
    expect(domainCounts.get('domain:intranet:8080')).toMatchObject({ name: 'intranet:8080', url: 'http://intranet:8080', count: 4 });
  });

  it('trata como domínio os hosts Git que não estão configurados', () => {
    const { projectGroups, domainCounts } = categorize([entry('https://gitlab.com/grupo/projeto', 1)]);
    expect(projectGroups.size).toBe(0);
    expect(domainCounts.has('domain:gitlab.com')).toBe(true);
  });

  describe('agrupamentos do usuário', () => {
    const urlGroups = [
      { id: 'a', title: 'Revisões', pattern: '/pull/' },
      { id: 'b', title: 'Repo', pattern: 'dono/repo' }
    ];

    it('leva o repositório inteiro quando qualquer URL casa, e o de menor índice vence', () => {
      const { userGroups, projectGroups } = categorize([
        entry('https://github.com/dono/repo', 2),
        entry('https://github.com/dono/repo/pull/1', 1)
      ], { urlGroups });

      expect([...userGroups.get('a').values()]).toEqual([expect.objectContaining({ name: 'dono/repo', count: 3 })]);
      expect(userGroups.get('b').size).toBe(0);
      expect(projectGroups.size).toBe(0);
    });

    it('casa só com host e caminho, ignorando query e hash', () => {
      const { userGroups } = categorize([entry('https://busca.com/?q=/pull/', 1)], { urlGroups });
      expect(userGroups.get('a').size).toBe(0);
    });
  });

  describe('busca', () => {
    const entries = [
      entry('https://github.com/dono/repo', 2),
      entry('https://github.com/dono/repo/pull/1', 1, 'Configuração do CI'),
      entry('https://github.com/outro/lib', 5),
      entry('https://example.com/', 4)
    ];

    it('mantém a contagem completa dos itens encontrados e descarta os demais', () => {
      const { projectGroups, domainCounts } = categorize(entries, { search: 'configuracao' });

      expect([...projectGroups.keys()]).toEqual(['github.com › dono']);
      expect(projectGroups.get('github.com › dono').get('repo:github.com/dono/repo').count).toBe(3);
      expect(domainCounts.size).toBe(0);
    });

    it('exige todos os termos, em qualquer ordem', () => {
      expect(categorize(entries, { search: 'ci dono' }).projectGroups.size).toBe(1);
      expect(categorize(entries, { search: 'ci outro' }).projectGroups.size).toBe(0);
    });
  });

  describe('título e ícone', () => {
    it('repositórios só usam o título da raiz', () => {
      const { projectGroups } = categorize([entry('https://github.com/dono/repo/issues', 5, 'Issues')]);
      expect(projectGroups.get('github.com › dono').get('repo:github.com/dono/repo')).toMatchObject({
        title: '',
        iconPageUrl: 'https://github.com/dono/repo'
      });
    });

    it('domínios caem para a página mais visitada', () => {
      const { domainCounts } = categorize([
        entry('https://example.com/pouco', 1, 'Pouco'),
        entry('https://example.com/muito', 3, 'Muito')
      ]);
      expect(domainCounts.get('domain:example.com')).toMatchObject({
        title: 'Muito',
        iconPageUrl: 'https://example.com/muito'
      });
    });

    it('omite o título igual ao nome', () => {
      const { domainCounts } = categorize([entry('https://example.com/', 1, 'example.com')]);
      expect(domainCounts.get('domain:example.com').title).toBe('');
    });

    it('prefere o ícone da raiz do host', () => {
      const hostIconPages = new Map([['github.com', 'https://github.com/']]);
      const { projectGroups } = categorize([entry('https://github.com/dono/repo', 1)], { hostIconPages });
      expect(projectGroups.get('github.com › dono').get('repo:github.com/dono/repo').iconPageUrl).toBe('https://github.com/');
    });
  });
});

describe('último acesso', () => {
  it('guarda o acesso mais recente entre as páginas do item', () => {
    const { domainCounts } = categorize([
      entry('https://example.com/a', 1, '', 3000),
      entry('https://example.com/b', 5, '', 1000)
    ]);
    expect(domainCounts.get('domain:example.com').lastVisitTime).toBe(3000);
  });

  it('vale também para repositórios e agrupamentos', () => {
    const { projectGroups, userGroups } = categorize([
      entry('https://github.com/dono/repo/pull/1', 1, '', 5000),
      entry('https://github.com/dono/repo', 2, '', 2000),
      entry('https://jira.example.com/a', 1, '', 7000)
    ], { urlGroups: [{ id: 'g', title: 'Jira', pattern: 'jira' }] });

    expect(projectGroups.get('github.com › dono').get('repo:github.com/dono/repo').lastVisitTime).toBe(5000);
    expect(userGroups.get('g').get('domain:jira.example.com').lastVisitTime).toBe(7000);
  });
});

describe('itens ocultos', () => {
  const entries = [
    entry('https://github.com/dono/repo', 2),
    entry('https://github.com/dono/outro', 1),
    entry('https://example.com/a', 3),
    entry('https://mail.example.com/', 1)
  ];

  it('descarta repositórios e domínios ocultos', () => {
    const { projectGroups, domainCounts } = categorize(entries, { hidden: ['repo:github.com/dono/repo', 'domain:example.com'] });
    expect([...projectGroups.get('github.com › dono').keys()]).toEqual(['repo:github.com/dono/outro']);
    expect([...domainCounts.keys()]).toEqual(['domain:mail.example.com']);
  });

  it('não deixa um item oculto levar outro para um agrupamento', () => {
    const { userGroups, domainCounts } = categorize([entry('https://example.com/a', 1)], {
      urlGroups: [{ id: 'g', title: 'G', pattern: 'example' }],
      hidden: ['domain:example.com']
    });
    expect(userGroups.get('g').size).toBe(0);
    expect(domainCounts.size).toBe(0);
  });
});
