# AGENTS.md

Orientações para agentes de código (Claude Code, Codex, Cursor, Copilot etc.) que trabalham neste repositório.

## Visão geral

Extensão Chrome Manifest V3 que substitui a New Tab Page por um painel com os repositórios Git e domínios mais acessados no período escolhido. JavaScript puro, sem build, sem dependências, sem testes automatizados e sem linter. Todo o código, comentários, textos da interface, README e mensagens de commit são em português.

## Desenvolvimento

- Não há build: carregue a pasta em `chrome://extensions` → Modo do desenvolvedor → **Carregar sem compactação**.
- Mudanças em `index.html`/`app.js` aparecem ao abrir uma nova aba; mudanças em `manifest.json` ou `background.js` exigem recarregar a extensão em `chrome://extensions`.
- Para validar, abra uma nova aba e confira o console da página (DevTools da própria aba). O service worker tem console separado (link "service worker" no card da extensão).
- Ao adicionar funcionalidade visível ao usuário, atualize o `README.md` (funcionalidades, atalhos, estrutura do projeto).

## Arquitetura

- `manifest.json`: permissões `history`, `storage` e `favicon`; `chrome_url_overrides.newtab` aponta para `index.html`; comando `open-search` (Alt+T sugerido).
- `background.js`: só trata o comando `open-search`, abrindo `index.html` como página comum da extensão (assim o foco vai para a página e o `autofocus` coloca o cursor na busca, em vez da barra de endereço).
- `index.html`: layout, CSS inline e os dois `<dialog>` (hosts Git e agrupamentos). As cores são variáveis CSS em `:root`; `theme.css` (opcional, não versionado, gerado pelo matugen) é carregado depois e as sobrescreve.
- `app.js`: toda a lógica, em um único script global (sem módulos).

### Fluxo de dados em `app.js`

1. **Carregamento** (`loadHistory` → `buildHistoryEntries`): pagina `chrome.history.search` por `endTime` (o limite é `HISTORY_PAGE_SIZE`) e, como `visitCount` é o total histórico, conta as visitas dentro da janela com `chrome.history.getVisits`, em lotes de `VISITS_CONCURRENCY`. O resultado vai para o cache `historyEntries` (mais recente primeiro), junto com `hostIconPages`.
2. **Cancelamento**: `historyLoadId` é incrementado em `startHistoryLoading`; cada carregamento recebe `isCurrent()` e descarta o resultado se outro começou depois (troca de período). Enquanto carrega, `historyEntries` fica `null` para que busca/configurações não redesenhem dados do período anterior.
3. **Categorização** (`categorizeHistory`), refeita a cada `renderDashboard()` a partir do cache, sem reler o histórico:
   - Hosts em `currentGitHosts` passam por `parseGitRepository`, que corta o caminho na primeira palavra de `GIT_STOP_KEYWORDS` (os dois primeiros segmentos nunca são cortados) e agrupa por `host › grupo/subgrupo`.
   - Demais URLs agregam por `host` (com porta, sem `www.`).
   - Agrupamentos do usuário (`currentUrlGroups`) casam o padrão por substring em host + caminho (sem query/hash). A decisão é por repositório/domínio inteiro: se qualquer URL casar, o item vai para o agrupamento de menor índice.
   - A busca não altera contagens nem títulos: só marca `matched` e `resolveBucket` descarta itens sem nenhuma URL encontrada.
   - `resolveAggregate` escolhe título e página do favicon: repositórios só usam o título da raiz; domínios caem para a página mais visitada. O favicon prefere a raiz do host, porque páginas de PR/pipeline trocam o ícone pelo status do CI.
4. **Renderização**: DOM construído com `createElement`/`textContent` (nunca `innerHTML` com dados do histórico). Favicons vêm de `chrome.runtime.getURL('/_favicon/?pageUrl=…')`, cache local do Chrome, sem requisições externas.

### Persistência

`chrome.storage.sync` com as chaves `gitHosts`, `urlGroups` e `historyPeriod`. As gravações passam por `enqueueSave`, que serializa as operações; `saveGitHosts`/`saveUrlGroups` recebem uma função `update(atual) → nova lista` (retornar a mesma referência significa "nada a salvar") e, ao salvar, atualizam o estado e redesenham. Os loaders normalizam e deduplicam o que vem do storage, pois ele pode ter sido editado à mão ou mesclado entre dispositivos.

### Foco na busca

O Chrome dá o foco da nova aba à barra de endereço. `setupSearch` trata `Shift+F6`/`F6` (o evento `focus` da janela, ignorando foco vindo de clique), `/` em qualquer ponto da página e `Esc` para limpar. Não quebre essas interações ao mexer em foco, modais ou atalhos.

## Convenções

- Mensagens de commit em português, no presente do indicativo e na terceira pessoa ("Adiciona…", "Mostra…"), com corpo explicando o porquê quando não é óbvio.
- Comentários explicam o motivo de decisões não óbvias (limitações das APIs do Chrome, ordem de eventos), não o que o código faz.
