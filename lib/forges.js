import { isRootUrl, safeDecode } from './text.js';

// No GitLab os grupos têm subgrupos, então o repositório termina na primeira rota interna.
// As rotas novas ficam sob "/-/"; as demais são as antigas, que ainda aparecem no histórico
// e que o GitLab reserva, para que não sejam nomes de subgrupo
export const GITLAB_STOP_KEYWORDS = new Set([
  '-', 'tree', 'blob', 'raw', 'blame', 'edit', 'commits', 'commit', 'branches', 'tags',
  'compare', 'merge_requests', 'issues', 'pipelines', 'jobs', 'builds', 'wikis', 'files',
  'find_file', 'refs', 'badges', 'preview', 'create', 'update', 'new'
]);

// Regras de cada forja. reservedRoots são primeiros segmentos que são páginas do próprio host
// (configurações, painéis, cadastro), e não donos de repositório
export const GIT_FORGES = {
  gitlab: {
    label: 'GitLab',
    reservedRoots: new Set([
      '-', 'admin', 'api', 'dashboard', 'explore', 'groups', 'help', 'import', 'oauth',
      'profile', 'projects', 'search', 'snippets', 'uploads', 'users'
    ]),
    parse: parseGitLabPath
  },
  github: {
    label: 'GitHub',
    reservedRoots: new Set([
      'settings', 'orgs', 'organizations', 'users', 'account', 'dashboard', 'explore',
      'marketplace', 'notifications', 'new', 'login', 'logout', 'signup', 'join', 'sessions',
      'search', 'topics', 'trending', 'collections', 'codespaces', 'sponsors', 'apps',
      'enterprises', 'features', 'issues', 'pulls', 'stars', 'watching', 'events', 'about',
      'pricing', 'security', 'advisories', 'copilot', 'site', 'contact', 'readme'
    ]),
    parse: parseOwnerRepoPath
  },
  gitea: {
    label: 'Gitea / Forgejo',
    reservedRoots: new Set([
      '-', 'admin', 'api', 'assets', 'attachments', 'avatars', 'captcha', 'commits', 'explore',
      'issues', 'login', 'milestones', 'new', 'notifications', 'org', 'pulls', 'repo', 'search',
      'user', 'v2'
    ]),
    parse: parseOwnerRepoPath
  },
  bitbucket: {
    label: 'Bitbucket',
    reservedRoots: new Set(['account', 'dashboard', 'repo', 'snippets', 'site', 'product', 'socialauth']),
    parse: parseBitbucketPath
  },
  azure: {
    label: 'Azure DevOps',
    reservedRoots: new Set(),
    parse: parseAzurePath
  }
};
export const DEFAULT_FORGE = 'gitlab';

export const KNOWN_FORGE_HOSTS = new Map([
  ['github.com', 'github'], ['gitlab.com', 'gitlab'], ['bitbucket.org', 'bitbucket'],
  ['dev.azure.com', 'azure'], ['gitea.com', 'gitea'], ['codeberg.org', 'gitea']
]);

export function findKnownForge(host) {
  if (KNOWN_FORGE_HOSTS.has(host)) return KNOWN_FORGE_HOSTS.get(host);
  return host.endsWith('.visualstudio.com') ? 'azure' : null;
}

export function isValidForge(forge) {
  return typeof forge === 'string' && Object.hasOwn(GIT_FORGES, forge);
}

// Hosts próprios sem tipo escolhido são tratados como GitLab, o caso mais comum de instância interna
export function toGitHost(host, forge) {
  return { host, forge: isValidForge(forge) ? forge : findKnownForge(host) || DEFAULT_FORGE };
}

export function parseGitRepository(url, forge) {
  const rules = GIT_FORGES[forge];
  const segments = url.pathname.split('/').filter(Boolean);
  // Páginas do próprio host contam para o domínio, como as URLs de um único segmento
  if (segments.length < 2 || rules.reservedRoots.has(segments[0])) return null;

  const repo = rules.parse(segments);
  if (!repo) return null;

  const { groupSegments, repoName, rootSegmentCount } = repo;
  const fullRepoPath = [...groupSegments, repoName].join('/');
  const rootPath = segments.slice(0, rootSegmentCount).join('/');

  return {
    fullPath: safeDecode(fullRepoPath),
    projectGroup: safeDecode(groupSegments.join('/')),
    repoName: safeDecode(repoName),
    repoUrl: `${url.origin}/${rootPath}`,
    uniqueKey: `${url.host}/${rootPath}`,
    isRoot: isRootUrl(url, rootSegmentCount, segments.length)
  };
}

// GitHub, Gitea/Forgejo e Bitbucket Cloud: sempre /dono/repositório, sem subgrupos
export function parseOwnerRepoPath(segments) {
  return { groupSegments: [segments[0]], repoName: segments[1], rootSegmentCount: 2 };
}

export function parseGitLabPath(segments) {
  // Os dois primeiros segmentos (grupo/repositório) nunca são tratados como palavras de parada
  const cleanSegments = segments.slice(0, 2);
  for (const seg of segments.slice(2)) {
    if (GITLAB_STOP_KEYWORDS.has(seg)) break;
    cleanSegments.push(seg);
  }
  return {
    groupSegments: cleanSegments.slice(0, -1),
    repoName: cleanSegments[cleanSegments.length - 1],
    rootSegmentCount: cleanSegments.length
  };
}

// Bitbucket Server/Data Center usa /projects/CHAVE/repos/repo e /users/nome/repos/repo
export function parseBitbucketPath(segments) {
  if (segments[0] !== 'projects' && segments[0] !== 'users') return parseOwnerRepoPath(segments);
  if (segments[2] !== 'repos' || !segments[3]) return null;
  return { groupSegments: [segments[1]], repoName: segments[3], rootSegmentCount: 4 };
}

// Azure DevOps: /org/projeto/_git/repo (ou /org/_git/repo). O "_git" fica na URL, mas não no nome
// mostrado; as demais páginas (_boards, _build…) e a home do projeto são do projeto, não de um repositório
export function parseAzurePath(segments) {
  const gitIndex = segments.indexOf('_git');
  if (gitIndex < 1 || !segments[gitIndex + 1]) return null;
  return { groupSegments: segments.slice(0, gitIndex), repoName: segments[gitIndex + 1], rootSegmentCount: gitIndex + 2 };
}
