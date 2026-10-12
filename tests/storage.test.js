import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSaveQueue, readGitHosts, readHistoryPeriod, readUrlGroups, writeGitHosts
} from '../lib/storage.js';
import { installFakeChrome } from './fake-chrome.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('readGitHosts', () => {
  it('usa os hosts padrão quando não há nada salvo', async () => {
    installFakeChrome();
    expect(await readGitHosts()).toEqual([
      { host: 'github.com', forge: 'github' },
      { host: 'gitlab.com', forge: 'gitlab' }
    ]);
  });

  it('normaliza, deduplica e descarta tipos inválidos', async () => {
    installFakeChrome({
      storage: {
        gitHosts: ['https://Git.Empresa.com/', 'git.empresa.com', '', null, 'dev.azure.com'],
        gitHostForges: { 'git.empresa.com': 'gitea', 'dev.azure.com': 'inexistente' }
      }
    });

    expect(await readGitHosts()).toEqual([
      { host: 'git.empresa.com', forge: 'gitea' },
      { host: 'dev.azure.com', forge: 'azure' }
    ]);
  });

  it('volta ao padrão se o storage falhar', async () => {
    const chrome = installFakeChrome();
    chrome.storage.sync.get = () => Promise.reject(new Error('falhou'));
    expect(await readGitHosts()).toHaveLength(2);
  });

  it('lê de volta o que writeGitHosts gravou', async () => {
    const chrome = installFakeChrome();
    const hosts = [{ host: 'bb.empresa.com', forge: 'bitbucket' }];
    await writeGitHosts(hosts);

    expect(chrome.storage.sync.data).toEqual({ gitHosts: ['bb.empresa.com'], gitHostForges: { 'bb.empresa.com': 'bitbucket' } });
    expect(await readGitHosts()).toEqual(hosts);
  });
});

describe('readUrlGroups', () => {
  it('descarta itens inválidos e padrões repetidos', async () => {
    installFakeChrome({
      storage: {
        urlGroups: [
          { id: '1', title: ' Jira ', pattern: ' JIRA.empresa.com ' },
          { id: '2', title: 'Repetido', pattern: 'jira.empresa.com' },
          { id: '3', title: '', pattern: 'vazio' },
          { id: '4', title: 'Sem padrão' },
          null
        ]
      }
    });

    expect(await readUrlGroups()).toEqual([{ id: '1', title: 'Jira', pattern: 'jira.empresa.com' }]);
  });

  it('gera um novo id para ids ausentes ou repetidos', async () => {
    installFakeChrome({
      storage: {
        urlGroups: [
          { id: 'x', title: 'A', pattern: 'a' },
          { id: 'x', title: 'B', pattern: 'b' },
          { title: 'C', pattern: 'c' }
        ]
      }
    });

    const ids = (await readUrlGroups()).map(g => g.id);
    expect(ids[0]).toBe('x');
    expect(new Set(ids).size).toBe(3);
  });

  it('ignora valores que não são lista', async () => {
    installFakeChrome({ storage: { urlGroups: 'quebrado' } });
    expect(await readUrlGroups()).toEqual([]);
  });
});

describe('readHistoryPeriod', () => {
  it('lê o período salvo e cai no padrão se for desconhecido', async () => {
    installFakeChrome({ storage: { historyPeriod: '7d' } });
    expect((await readHistoryPeriod()).id).toBe('7d');

    installFakeChrome({ storage: { historyPeriod: '2d' } });
    expect((await readHistoryPeriod()).id).toBe('30d');
  });
});

describe('createSaveQueue', () => {
  it('executa as tarefas em ordem, uma de cada vez', async () => {
    const enqueueSave = createSaveQueue();
    const log = [];
    const slow = enqueueSave(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      log.push('lenta');
    });
    const fast = enqueueSave(async () => log.push('rápida'));

    await Promise.all([slow, fast]);
    expect(log).toEqual(['lenta', 'rápida']);
  });

  it('continua após uma tarefa rejeitada, que ainda rejeita para quem a chamou', async () => {
    const enqueueSave = createSaveQueue();
    const failed = enqueueSave(() => Promise.reject(new Error('falhou')));
    const next = enqueueSave(async () => 'ok');

    await expect(failed).rejects.toThrow('falhou');
    await expect(next).resolves.toBe('ok');
  });
});
