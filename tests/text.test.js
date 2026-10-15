import { describe, expect, it } from 'vitest';
import {
  cleanTitle, findHighlightRanges, normalizeHost, normalizePattern, parseSearchTerms, parseWebUrl, safeDecode, splitItemKey, stripRepoTitle, formatTimeAgo
} from '../lib/text.js';

describe('normalizeHost', () => {
  it.each([
    ['gitlab.empresa.com', 'gitlab.empresa.com'],
    ['  HTTPS://www.GitLab.Empresa.com/grupo  ', 'gitlab.empresa.com'],
    ['git.empresa.com:8443', 'git.empresa.com'],
    ['', null],
    [null, null],
    ['http://', null]
  ])('%j → %j', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });
});

describe('safeDecode', () => {
  it('devolve o valor original quando a codificação é inválida', () => {
    expect(safeDecode('caf%C3%A9')).toBe('café');
    expect(safeDecode('100%')).toBe('100%');
  });
});

describe('cleanTitle', () => {
  it('remove contadores de notificação do início', () => {
    expect(cleanTitle('(17) Inbox')).toBe('Inbox');
    expect(cleanTitle('(99+) Inbox')).toBe('Inbox');
    expect(cleanTitle('  Inbox (3) ')).toBe('Inbox (3)');
    expect(cleanTitle(undefined)).toBe('');
  });
});

describe('stripRepoTitle', () => {
  it('remove o prefixo do GitHub e o caminho do repositório', () => {
    expect(stripRepoTitle('GitHub - dono/repo: Uma descrição', 'dono/repo')).toBe('Uma descrição');
  });

  it('remove o sufixo do GitLab e aceita espaços em volta da barra', () => {
    expect(stripRepoTitle('grupo / projeto · GitLab', 'grupo/projeto')).toBe('');
    expect(stripRepoTitle('Projeto X · GitLab', 'grupo/projeto')).toBe('Projeto X');
  });
});

describe('parseSearchTerms', () => {
  it('normaliza acentos e caixa e separa por espaços', () => {
    expect(parseSearchTerms('  Configuração   API ')).toEqual(['configuracao', 'api']);
    expect(parseSearchTerms('   ')).toEqual([]);
  });
});

describe('normalizePattern', () => {
  it('apara e põe em minúsculas', () => {
    expect(normalizePattern('  Jira.Empresa.com/Browse ')).toBe('jira.empresa.com/browse');
    expect(normalizePattern(undefined)).toBe('');
  });
});

describe('parseWebUrl', () => {
  it('aceita só http e https', () => {
    expect(parseWebUrl('https://www.example.com/a')?.href).toBe('https://www.example.com/a');
    expect(parseWebUrl('chrome://extensions')).toBeNull();
    expect(parseWebUrl('file:///home/user/a.html')).toBeNull();
  });

  it('descarta hosts excluídos e URLs inválidas', () => {
    expect(parseWebUrl('http://localhost:3000/')).toBeNull();
    expect(parseWebUrl('http://127.0.0.1/')).toBeNull();
    expect(parseWebUrl('não é url')).toBeNull();
    expect(parseWebUrl('')).toBeNull();
  });
});

describe('splitItemKey', () => {
  it.each([
    ['repo:github.com/dono/repo', { kind: 'repo', name: 'github.com/dono/repo' }],
    ['domain:intranet:8080', { kind: 'domain', name: 'intranet:8080' }],
    ['domain:', null],
    ['outro:x', null],
    ['semprefixo', null]
  ])('%j → %j', (key, expected) => {
    expect(splitItemKey(key)).toEqual(expected);
  });
});

describe('formatTimeAgo', () => {
  const now = Date.UTC(2026, 9, 12, 12);
  const MIN = 60 * 1000;
  it.each([
    [now - 20 * 1000, 'agora há pouco'],
    [now - 5 * MIN, 'há 5 minutos'],
    [now - 1 * 60 * MIN, 'há 1 hora'],
    [now - 26 * 60 * MIN, 'há 1 dia'],
    [now - 45 * 24 * 60 * MIN, 'há 1 mês'],
    [now + 5 * MIN, 'agora há pouco']
  ])('%j → %j', (time, expected) => {
    expect(formatTimeAgo(time, now)).toBe(expected);
  });
});

describe('findHighlightRanges', () => {
  it('marca os termos no texto original, ignorando acentos e maiúsculas', () => {
    const text = 'Configuração do CI';
    const ranges = findHighlightRanges(text, parseSearchTerms('configuracao ci'));
    expect(ranges.map(([start, end]) => text.slice(start, end))).toEqual(['Configuração', 'CI']);
  });

  it('marca todas as ocorrências e junta as sobrepostas', () => {
    expect(findHighlightRanges('abc-abc', ['ab', 'bc'])).toEqual([[0, 3], [4, 7]]);
  });

  it('mantém juntos a letra e o acento já decomposto', () => {
    const text = 'cafe\u0301 forte';
    const [[start, end]] = findHighlightRanges(text, ['cafe']);
    expect(text.slice(start, end)).toBe('cafe\u0301');
  });

  it('não marca nada sem termos', () => {
    expect(findHighlightRanges('texto', [])).toEqual([]);
  });
});
