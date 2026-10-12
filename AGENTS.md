# AGENTS.md

Orientações para agentes de código (Claude Code, Codex, Cursor, Copilot etc.) que trabalham neste repositório.

## Visão geral

Extensão Chrome Manifest V3 que substitui a New Tab Page por um painel com os repositórios Git e domínios mais acessados no período escolhido. JavaScript puro em módulos ES, sem build, sem dependências em runtime e sem linter; a lógica em `lib/` tem testes unitários com Vitest (única dependência, de desenvolvimento). Todo o código, comentários, textos da interface, README e mensagens de commit são em português.

## Desenvolvimento

- Não há build: carregue a pasta em `chrome://extensions` → Modo do desenvolvedor → **Carregar sem compactação**.
- Mudanças em `index.html`/`app.js` aparecem ao abrir uma nova aba, e em `options.html`/`options.js` ao recarregar a página de configurações; mudanças em `manifest.json` ou `background.js` exigem recarregar a extensão em `chrome://extensions`.
- Rode `npm install` uma vez e `npm test` antes de cada commit. Mudanças em `lib/` (forjas, categorização, histórico, storage) vêm acompanhadas de testes em `tests/`.
- Para validar a interface, abra uma nova aba e confira o console da página (DevTools da própria aba). O service worker tem console separado (link "service worker" no card da extensão).
- Ao adicionar funcionalidade visível ao usuário, atualize o `README.md` (funcionalidades, atalhos, estrutura do projeto).

## Arquitetura

- `manifest.json`: permissões `history`, `storage` e `favicon`; `chrome_url_overrides.newtab` aponta para `index.html` e `options_ui` (aberto em aba) para `options.html`; comando `open-search` (Alt+T sugerido).
- `background.js`: só trata o comando `open-search`, abrindo `index.html` como página comum da extensão (assim o foco vai para a página e o `autofocus` coloca o cursor na busca, em vez da barra de endereço).
- `common.css`: cores (variáveis CSS em `:root`), botões e os estilos de formulários e listas, comuns às duas páginas. Cada página carrega `common.css`, depois o próprio CSS inline e por fim `theme.css` (opcional, não versionado, gerado pelo matugen), que sobrescreve as cores.
- `index.html`/`app.js` (painel): `app.js` é carregado com `<script type="module">`; guarda o estado (`currentGitHosts`, `currentUrlGroups`, `searchTerms`, `historyEntries`…) e cuida de renderização, período e busca. Só grava `hiddenItems` (o `×` dos cards) e `historyPeriod`; o botão ⚙ chama `chrome.runtime.openOptionsPage()`, que reaproveita a aba já aberta; o ⊘ Ocultos faz o mesmo depois de gravar `optionsSection` no `chrome.storage.session`, já que essa função não aceita âncora.
- `options.html`/`options.js` (configurações): uma página com três seções empilhadas (hosts Git, agrupamentos e itens ocultos), que é onde `gitHosts`/`gitHostForges` e `urlGroups` são editados. A seção pedida (âncora da URL, `hashchange` ou `optionsSection` do `storage.session`) recebe o foco; no carregamento, isso espera o `load`, porque o Chrome aplica a âncora nesse momento e tira o foco dado antes. Os ícones das listas vêm de `fetchHostIconPages`, que procura no histórico a raiz visitada de cada host.
- `dom.js`: pedaços de interface comuns às duas páginas (`renderMessage`, `createFavicon`, `hostIconPage`, `showError`). Fica fora de `lib/` porque usa DOM.
- Sincronização entre as páginas: veja *Persistência*. O painel recategoriza o cache, sem reler o histórico, e não acompanha `historyPeriod`.
- `lib/`: lógica sem DOM, importável pelos testes. `constants.js`, `text.js`, `forges.js`, `categorize.js` e `groups.js` são puros (o estado chega por parâmetro); só `history.js` e `storage.js` usam `chrome.*`, que nos testes é o substituto de `tests/fake-chrome.js`. Não use DOM nem estado global em `lib/`.
- `tests/`: testes Vitest em ambiente Node, um arquivo por módulo de `lib/`.

### Fluxo de dados

1. **Carregamento** (`loadHistory` → `buildHistoryEntries`, em `lib/history.js`): pagina `chrome.history.search` por `endTime` (o limite é `HISTORY_PAGE_SIZE`) e, como `visitCount` é o total histórico, conta as visitas dentro da janela com `chrome.history.getVisits`, em lotes de `VISITS_CONCURRENCY`. O resultado vai para o cache `historyEntries` (mais recente primeiro), junto com `hostIconPages`.
2. **Cancelamento**: `historyLoadId` é incrementado em `startHistoryLoading`; cada carregamento recebe `isCurrent()` e descarta o resultado se outro começou depois (troca de período). Enquanto carrega, `historyEntries` fica `null` para que busca/configurações não redesenhem dados do período anterior.
3. **Categorização** (`categorizeHistory`, em `lib/categorize.js`, que recebe hosts, agrupamentos, termos e ícones por parâmetro), refeita a cada `renderDashboard()` a partir do cache, sem reler o histórico:
   - `currentGitHosts` é uma lista de `{ host, forge }`, e cada forja de `GIT_FORGES` tem seus `reservedRoots` (primeiros segmentos que são páginas do próprio host e contam para o domínio) e seu `parse`. GitHub, Gitea/Forgejo e Bitbucket Cloud usam sempre `dono/repo`; o GitLab aceita subgrupos e corta o caminho na primeira palavra de `GITLAB_STOP_KEYWORDS` (os dois primeiros segmentos nunca são cortados); o Bitbucket Server usa `/projects/CHAVE/repos/repo`; no Azure DevOps o repositório é o segmento seguinte a `_git`, e as demais páginas contam para o domínio. O resultado agrupa por `host › grupo/subgrupo`. Hosts sem tipo escolhido são detectados por `findKnownForge` ou caem em `DEFAULT_FORGE` (GitLab).
   - Demais URLs agregam por `host` (com porta, sem `www.`).
   - Cada item tem uma chave (`repo:host/caminho` ou `domain:host`); as entradas cujas chaves estão em `hiddenItems` são descartadas antes de tudo, inclusive da decisão de agrupamento.
   - Agrupamentos do usuário (`currentUrlGroups`) casam o padrão por substring em host + caminho (sem query/hash). A decisão é por repositório/domínio inteiro: se qualquer URL casar, o item vai para o agrupamento de menor índice.
   - A busca não altera contagens nem títulos: só marca `matched` e `resolveBucket` descarta itens sem nenhuma URL encontrada.
   - `resolveAggregate` escolhe título e página do favicon: repositórios só usam o título da raiz; domínios caem para a página mais visitada. O favicon prefere a raiz do host, porque páginas de PR/pipeline trocam o ícone pelo status do CI.
4. **Renderização**: DOM construído com `createElement`/`textContent` (nunca `innerHTML` com dados do histórico). Favicons vêm de `chrome.runtime.getURL('/_favicon/?pageUrl=…')`, cache local do Chrome, sem requisições externas.

### Persistência

`chrome.storage.sync` com as chaves `gitHosts` (lista de hosts), `gitHostForges` (host → tipo de forja, separado para que versões anteriores continuem lendo `gitHosts`), `urlGroups`, `hiddenItems` (chaves dos itens ocultos) e `historyPeriod`. A leitura, a normalização e a gravação ficam em `lib/storage.js`; cada página espelha as listas com `createSyncedSetting` e as mantém atualizadas com `watchSyncedSettings`, que escuta `chrome.storage.onChanged` (área `sync`). Tudo passa por `enqueueSave` (criado por `createSaveQueue`), que serializa leituras e gravações da página. `save(update)` relê o storage dentro da fila e aplica `update(atual) → nova lista` sobre o que está gravado, não sobre a cópia em memória: outra aba ou outro dispositivo pode ter gravado no meio, e partir da cópia desfaria essa gravação. Retornar a mesma referência significa "nada a salvar". O `onChange` só é chamado quando o valor muda, porque a gravação da própria página dispara o mesmo evento e redesenhar à toa tira o foco do controle usado. Os leitores (`read*`) normalizam e deduplicam o que vem do storage, pois ele pode ter sido editado à mão ou mesclado entre dispositivos.

### Foco na busca

O Chrome dá o foco da nova aba à barra de endereço. `setupSearch` trata `Shift+F6`/`F6` (o evento `focus` da janela, ignorando foco vindo de clique), `/` em qualquer ponto da página e `Esc` para limpar. Não quebre essas interações ao mexer em foco ou atalhos.

## Convenções

- Mensagens de commit em português, no presente do indicativo e na terceira pessoa ("Adiciona…", "Mostra…"), com corpo explicando o porquê quando não é óbvio.
- Comentários explicam o motivo de decisões não óbvias (limitações das APIs do Chrome, ordem de eventos), não o que o código faz.
