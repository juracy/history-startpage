# AGENTS.md

Orientações para agentes de código (Claude Code, Codex, Cursor, Copilot etc.) que trabalham neste repositório.

## Visão geral

Extensão Chrome Manifest V3 que substitui a New Tab Page por um painel com os repositórios Git e domínios mais acessados no período escolhido. JavaScript puro em módulos ES, sem build, sem dependências em runtime e sem linter; a lógica em `lib/` tem testes unitários com Vitest (única dependência, de desenvolvimento). Todo o código, comentários, textos da interface, README e mensagens de commit são em português.

## Desenvolvimento

- Não há build: carregue a pasta em `chrome://extensions` → Modo do desenvolvedor → **Carregar sem compactação**.
- Mudanças em `index.html`/`app.js` aparecem ao abrir uma nova aba; mudanças em `manifest.json` ou `background.js` exigem recarregar a extensão em `chrome://extensions`.
- Rode `npm install` uma vez e `npm test` antes de cada commit. Mudanças em `lib/` (forjas, categorização, histórico, storage) vêm acompanhadas de testes em `tests/`.
- Para validar a interface, abra uma nova aba e confira o console da página (DevTools da própria aba). O service worker tem console separado (link "service worker" no card da extensão).
- Ao adicionar funcionalidade visível ao usuário, atualize o `README.md` (funcionalidades, atalhos, estrutura do projeto).

## Arquitetura

- `manifest.json`: permissões `history`, `storage` e `favicon`; `chrome_url_overrides.newtab` aponta para `index.html`; comando `open-search` (Alt+T sugerido).
- `background.js`: só trata o comando `open-search`, abrindo `index.html` como página comum da extensão (assim o foco vai para a página e o `autofocus` coloca o cursor na busca, em vez da barra de endereço).
- `index.html`: layout, CSS inline e os dois `<dialog>` (hosts Git e agrupamentos). As cores são variáveis CSS em `:root`; `theme.css` (opcional, não versionado, gerado pelo matugen) é carregado depois e as sobrescreve.
- `app.js`: carregado com `<script type="module">`; guarda o estado (`currentGitHosts`, `currentUrlGroups`, `searchTerms`, `historyEntries`…) e cuida de renderização, modais, período e busca.
- `lib/`: lógica sem DOM, importável pelos testes. `constants.js`, `text.js`, `forges.js`, `categorize.js` e `groups.js` são puros (o estado chega por parâmetro); só `history.js` e `storage.js` usam `chrome.*`, que nos testes é o substituto de `tests/fake-chrome.js`. Não use DOM nem estado global em `lib/`.
- `tests/`: testes Vitest em ambiente Node, um arquivo por módulo de `lib/`.

### Fluxo de dados

1. **Carregamento** (`loadHistory` → `buildHistoryEntries`, em `lib/history.js`): pagina `chrome.history.search` por `endTime` (o limite é `HISTORY_PAGE_SIZE`) e, como `visitCount` é o total histórico, conta as visitas dentro da janela com `chrome.history.getVisits`, em lotes de `VISITS_CONCURRENCY`. O resultado vai para o cache `historyEntries` (mais recente primeiro), junto com `hostIconPages`.
2. **Cancelamento**: `historyLoadId` é incrementado em `startHistoryLoading`; cada carregamento recebe `isCurrent()` e descarta o resultado se outro começou depois (troca de período). Enquanto carrega, `historyEntries` fica `null` para que busca/configurações não redesenhem dados do período anterior.
3. **Categorização** (`categorizeHistory`, em `lib/categorize.js`, que recebe hosts, agrupamentos, termos e ícones por parâmetro), refeita a cada `renderDashboard()` a partir do cache, sem reler o histórico:
   - `currentGitHosts` é uma lista de `{ host, forge }`, e cada forja de `GIT_FORGES` tem seus `reservedRoots` (primeiros segmentos que são páginas do próprio host e contam para o domínio) e seu `parse`. GitHub, Gitea/Forgejo e Bitbucket Cloud usam sempre `dono/repo`; o GitLab aceita subgrupos e corta o caminho na primeira palavra de `GITLAB_STOP_KEYWORDS` (os dois primeiros segmentos nunca são cortados); o Bitbucket Server usa `/projects/CHAVE/repos/repo`; no Azure DevOps o repositório é o segmento seguinte a `_git`, e as demais páginas contam para o domínio. O resultado agrupa por `host › grupo/subgrupo`. Hosts sem tipo escolhido são detectados por `findKnownForge` ou caem em `DEFAULT_FORGE` (GitLab).
   - Demais URLs agregam por `host` (com porta, sem `www.`).
   - Agrupamentos do usuário (`currentUrlGroups`) casam o padrão por substring em host + caminho (sem query/hash). A decisão é por repositório/domínio inteiro: se qualquer URL casar, o item vai para o agrupamento de menor índice.
   - A busca não altera contagens nem títulos: só marca `matched` e `resolveBucket` descarta itens sem nenhuma URL encontrada.
   - `resolveAggregate` escolhe título e página do favicon: repositórios só usam o título da raiz; domínios caem para a página mais visitada. O favicon prefere a raiz do host, porque páginas de PR/pipeline trocam o ícone pelo status do CI.
4. **Renderização**: DOM construído com `createElement`/`textContent` (nunca `innerHTML` com dados do histórico). Favicons vêm de `chrome.runtime.getURL('/_favicon/?pageUrl=…')`, cache local do Chrome, sem requisições externas.

### Persistência

`chrome.storage.sync` com as chaves `gitHosts` (lista de hosts), `gitHostForges` (host → tipo de forja, separado para que versões anteriores continuem lendo `gitHosts`), `urlGroups` e `historyPeriod`. A leitura, a normalização e a gravação ficam em `lib/storage.js`; em `app.js`, as gravações passam por `enqueueSave` (criado por `createSaveQueue`), que serializa as operações; `saveGitHosts`/`saveUrlGroups` recebem uma função `update(atual) → nova lista` (retornar a mesma referência significa "nada a salvar") e, ao salvar, atualizam o estado e redesenham. Os leitores (`read*`) normalizam e deduplicam o que vem do storage, pois ele pode ter sido editado à mão ou mesclado entre dispositivos.

### Foco na busca

O Chrome dá o foco da nova aba à barra de endereço. `setupSearch` trata `Shift+F6`/`F6` (o evento `focus` da janela, ignorando foco vindo de clique), `/` em qualquer ponto da página e `Esc` para limpar. Não quebre essas interações ao mexer em foco, modais ou atalhos.

## Convenções

- Mensagens de commit em português, no presente do indicativo e na terceira pessoa ("Adiciona…", "Mostra…"), com corpo explicando o porquê quando não é óbvio.
- Comentários explicam o motivo de decisões não óbvias (limitações das APIs do Chrome, ordem de eventos), não o que o código faz.
