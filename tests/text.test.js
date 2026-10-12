import { describe, expect, it } from 'vitest';
import {
  cleanTitle, normalizeHost, normalizePattern, parseSearchTerms, parseWebUrl, safeDecode, splitItemKey, stripRepoTitle
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
