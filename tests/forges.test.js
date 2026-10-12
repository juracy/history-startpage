import { describe, expect, it } from 'vitest';
import { DEFAULT_FORGE, findKnownForge, parseGitRepository, toGitHost } from '../lib/forges.js';

const parse = (url, forge) => parseGitRepository(new URL(url), forge);

describe('parseGitRepository', () => {
  describe('GitHub', () => {
    it('usa sempre dono/repositório', () => {
      expect(parse('https://github.com/dono/repo/pull/12/files', 'github')).toEqual({
        fullPath: 'dono/repo',
        projectGroup: 'dono',
        repoName: 'repo',
        repoUrl: 'https://github.com/dono/repo',
        uniqueKey: 'github.com/dono/repo',
        isRoot: false
      });
    });

    it('trata páginas do próprio host como domínio', () => {
      expect(parse('https://github.com/settings/profile', 'github')).toBeNull();
      expect(parse('https://github.com/orgs/empresa/repositories', 'github')).toBeNull();
    });

    it('ignora URLs com um único segmento', () => {
      expect(parse('https://github.com/dono', 'github')).toBeNull();
    });
  });

  describe('GitLab', () => {
    it('aceita subgrupos e corta na primeira rota interna', () => {
      const repo = parse('https://gitlab.com/grupo/sub/projeto/-/merge_requests/3', 'gitlab');
      expect(repo).toMatchObject({
        fullPath: 'grupo/sub/projeto',
        projectGroup: 'grupo/sub',
        repoName: 'projeto',
        repoUrl: 'https://gitlab.com/grupo/sub/projeto',
        isRoot: false
      });
    });

    it('corta nas rotas antigas, fora de "/-/"', () => {
      expect(parse('https://gitlab.com/grupo/projeto/issues/7', 'gitlab').fullPath).toBe('grupo/projeto');
    });

    it('nunca corta os dois primeiros segmentos', () => {
      expect(parse('https://gitlab.com/grupo/tree', 'gitlab').repoName).toBe('tree');
    });

    it('trata páginas do próprio host como domínio', () => {
      expect(parse('https://gitlab.com/dashboard/merge_requests', 'gitlab')).toBeNull();
    });

    it('decodifica o caminho', () => {
      expect(parse('https://gitlab.com/grupo/caf%C3%A9', 'gitlab').repoName).toBe('café');
    });
  });

  describe('Bitbucket', () => {
    it('lê /projects/CHAVE/repos/repo do Bitbucket Server', () => {
      expect(parse('https://bb.empresa.com/projects/CORE/repos/api/browse', 'bitbucket')).toMatchObject({
        fullPath: 'CORE/api',
        repoUrl: 'https://bb.empresa.com/projects/CORE/repos/api',
        isRoot: false
      });
    });

    it('lê /users/nome/repos/repo', () => {
      expect(parse('https://bb.empresa.com/users/ana/repos/notas', 'bitbucket').fullPath).toBe('ana/notas');
    });

    it('descarta projetos sem repositório', () => {
      expect(parse('https://bb.empresa.com/projects/CORE', 'bitbucket')).toBeNull();
    });

    it('usa dono/repositório no Bitbucket Cloud', () => {
      expect(parse('https://bitbucket.org/time/app/src/main', 'bitbucket').fullPath).toBe('time/app');
    });
  });

  describe('Azure DevOps', () => {
    it('usa o segmento seguinte a _git, sem mostrar o _git', () => {
      expect(parse('https://dev.azure.com/org/projeto/_git/repo/pullrequest/9', 'azure')).toMatchObject({
        fullPath: 'org/projeto/repo',
        projectGroup: 'org/projeto',
        repoName: 'repo',
        repoUrl: 'https://dev.azure.com/org/projeto/_git/repo',
        isRoot: false
      });
    });

    it('aceita /org/_git/repo', () => {
      expect(parse('https://dev.azure.com/org/_git/repo', 'azure')).toMatchObject({ fullPath: 'org/repo', isRoot: true });
    });

    it('trata as demais páginas como domínio', () => {
      expect(parse('https://dev.azure.com/org/projeto/_boards/board', 'azure')).toBeNull();
      expect(parse('https://dev.azure.com/org/projeto', 'azure')).toBeNull();
    });
  });

  describe('isRoot', () => {
    it('ignora a query', () => {
      expect(parse('https://github.com/dono/repo?tab=readme', 'github').isRoot).toBe(true);
    });

    it('trata rotas de SPA no hash como página interna', () => {
      expect(parse('https://github.com/dono/repo#/issues', 'github').isRoot).toBe(false);
      expect(parse('https://github.com/dono/repo#readme', 'github').isRoot).toBe(true);
    });
  });
});

describe('findKnownForge', () => {
  it('reconhece hosts públicos e *.visualstudio.com', () => {
    expect(findKnownForge('codeberg.org')).toBe('gitea');
    expect(findKnownForge('empresa.visualstudio.com')).toBe('azure');
    expect(findKnownForge('git.empresa.com')).toBeNull();
  });
});

describe('toGitHost', () => {
  it('mantém um tipo válido', () => {
    expect(toGitHost('git.empresa.com', 'gitea')).toEqual({ host: 'git.empresa.com', forge: 'gitea' });
  });

  it('detecta hosts conhecidos quando o tipo é inválido ou ausente', () => {
    expect(toGitHost('github.com', 'inexistente')).toEqual({ host: 'github.com', forge: 'github' });
  });

  it('cai no tipo padrão para hosts próprios', () => {
    expect(toGitHost('git.empresa.com')).toEqual({ host: 'git.empresa.com', forge: DEFAULT_FORGE });
  });

  it('não aceita propriedades herdadas como tipo', () => {
    expect(toGitHost('git.empresa.com', 'toString').forge).toBe(DEFAULT_FORGE);
  });
});
