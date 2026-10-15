import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSaveQueue, createSyncedSetting, readGitHosts, readHiddenItems, readHistoryPeriod, readShowMatchedPages,
  readSortOrder, readUrlGroups, watchSyncedSettings, writeGitHosts, writeHiddenItems, writeShowMatchedPages
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

describe('readHiddenItems', () => {
  it('descarta chaves inválidas e repetidas', async () => {
    installFakeChrome({
      storage: { hiddenItems: [' domain:example.com ', 'domain:example.com', 'repo:github.com/dono/repo', 'lixo', 42, null] }
    });
    expect(await readHiddenItems()).toEqual(['domain:example.com', 'repo:github.com/dono/repo']);
  });

  it('ignora valores que não são lista', async () => {
    installFakeChrome({ storage: { hiddenItems: 'quebrado' } });
    expect(await readHiddenItems()).toEqual([]);
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

describe('readSortOrder', () => {
  it('lê a ordenação salva e cai no padrão se for desconhecida', async () => {
    installFakeChrome({ storage: { sortOrder: 'frecency' } });
    expect((await readSortOrder()).id).toBe('frecency');

    installFakeChrome({ storage: { sortOrder: 'alfabetica' } });
    expect((await readSortOrder()).id).toBe('visits');
  });
});

describe('readShowMatchedPages', () => {
  it('fica desativado por padrão e só aceita true', async () => {
    installFakeChrome();
    expect(await readShowMatchedPages()).toBe(false);

    installFakeChrome({ storage: { showMatchedPages: 'sim' } });
    expect(await readShowMatchedPages()).toBe(false);
  });

  it('lê o que foi gravado', async () => {
    const chrome = installFakeChrome();
    await writeShowMatchedPages(true);
    expect(chrome.storage.sync.data).toEqual({ showMatchedPages: true });
    expect(await readShowMatchedPages()).toBe(true);
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

describe('createSyncedSetting', () => {
  const createHidden = (onChange = () => {}) => createSyncedSetting({
    keys: ['hiddenItems'], read: readHiddenItems, write: writeHiddenItems, enqueue: createSaveQueue(), onChange
  });

  it('carrega o valor e avisa só quando ele muda', async () => {
    const chrome = installFakeChrome({ storage: { hiddenItems: ['domain:a.com'] } });
    const onChange = vi.fn();
    const hidden = createHidden(onChange);

    await hidden.refresh();
    await hidden.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(['domain:a.com']);

    chrome.storage.sync.data.hiddenItems = ['domain:a.com', 'domain:b.com'];
    await hidden.refresh();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('aplica a gravação sobre o que está no storage, não sobre a cópia em memória', async () => {
    const chrome = installFakeChrome({ storage: { hiddenItems: ['domain:a.com'] } });
    const hidden = createHidden();
    await hidden.refresh();

    // Outra aba ocultou b.com depois da última leitura desta
    chrome.storage.sync.data.hiddenItems = ['domain:a.com', 'domain:b.com'];
    await hidden.save(keys => keys.filter(k => k !== 'domain:a.com'));

    expect(chrome.storage.sync.data.hiddenItems).toEqual(['domain:b.com']);
  });

  it('não grava quando update devolve o mesmo valor', async () => {
    const chrome = installFakeChrome({ storage: { hiddenItems: ['domain:a.com'] } });
    const set = vi.spyOn(chrome.storage.sync, 'set');
    await createHidden().save(keys => keys);
    expect(set).not.toHaveBeenCalled();
  });

  it('rejeita e mantém o valor quando a gravação falha', async () => {
    const chrome = installFakeChrome();
    const onChange = vi.fn();
    const hidden = createHidden(onChange);
    await hidden.refresh();

    chrome.storage.sync.failNextSet = new Error('cota excedida');
    await expect(hidden.save(keys => [...keys, 'domain:a.com'])).rejects.toThrow('cota excedida');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('watchSyncedSettings', () => {
  it('relê só as configurações cujas chaves mudaram no storage.sync', async () => {
    const chrome = installFakeChrome();
    const hosts = { keys: ['gitHosts', 'gitHostForges'], refresh: vi.fn() };
    const hidden = { keys: ['hiddenItems'], refresh: vi.fn() };
    watchSyncedSettings([hosts, hidden]);

    chrome.storage.onChanged.emit({ gitHostForges: {} });
    chrome.storage.onChanged.emit({ hiddenItems: [] }, 'session');

    expect(hosts.refresh).toHaveBeenCalledTimes(1);
    expect(hidden.refresh).not.toHaveBeenCalled();
  });
});
