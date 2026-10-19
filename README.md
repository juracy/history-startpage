# Chrome Dynamic Startpage

Extensão leve (Manifest V3) para Google Chrome / navegadores Chromium que substitui a **New Tab Page** por um painel analítico dos seus acessos no período escolhido (padrão: 30 dias).

## 🚀 Funcionalidades

- **Agregação Inteligente de Repositórios Git:**
  - Suporta GitHub, GitLab (com subgrupos), Gitea, Forgejo, Bitbucket (Cloud e Server), Azure DevOps (`/org/projeto/_git/repo`) e instâncias privadas/self-hosted.
  - Cada host tem um tipo de forja, que define como o endereço é lido. Hosts conhecidos (`github.com`, `gitlab.com`, `bitbucket.org`, `dev.azure.com`, `*.visualstudio.com`, `gitea.com`, `codeberg.org`) são detectados; hosts próprios são tratados como GitLab, a menos que outro tipo seja escolhido ao adicioná-los.
  - Normaliza subpastas e rotas internas (`/-/`, `/tree/`, `/src/`, `/pulls`, etc.) para a raiz do repositório.
  - Páginas do próprio host (`/settings`, `/orgs`, `/dashboard`, `/explore`…) contam para o domínio, e não como repositórios.
  - Agrupa repositórios por Organização / Workspace / Subgrupo.
- **Domínios Mais Acessados:**
  - Extrai e consolida o host raiz dos seus sites mais frequentados no período, evitando poluição de URLs específicas.
- **Abertura Instantânea:**
  - O resultado processado fica guardado localmente (`chrome.storage.local`), e cada nova aba o mostra na hora; em seguida, o painel consulta só as páginas visitadas desde a abertura anterior e se atualiza, sem tirar o foco do card em que você está. O mesmo cache serve a todos os períodos até o maior já carregado. A carga completa só acontece na primeira vez, ao escolher um período maior, depois de apagar todo o histórico e uma vez por dia, em segundo plano; enquanto ela roda sem cache na tela, o painel mostra quantas páginas já foram lidas ("Carregando… 1.200 de 4.800 páginas"). Páginas apagadas do histórico saem do cache na hora.
- **Contador de Visitas:**
  - O número em cada card é o total de visitas no período; passe o mouse sobre o card para ver também o último acesso ("12 visitas no último mês · último acesso há 2 horas"). Leitores de tela anunciam o mesmo texto.
- **Layout Responsivo:**
  - Em janelas estreitas (como a tela dividida ao meio), as seções passam para uma coluna e o cabeçalho quebra linha.
  - Em telas largas, o painel ocupa a largura disponível (até 1920px) e os grupos de repositórios e os domínios se distribuem em várias colunas, lidas de cima para baixo; os cards de um agrupamento largo (por exemplo, o único da seção) também se espalham em colunas.
- **Listas Compactas:**
  - O painel mostra 5 itens por grupo, 8 grupos de repositórios e 15 domínios (nos agrupamentos e nos domínios, o limite sobe até completar a última linha quando estão em várias colunas); o botão **Mostrar mais N** abre o restante da lista (e **Mostrar menos** a recolhe). Durante a busca, o mesmo botão indica quantos resultados ficaram de fora.
- **Seletor de Período:**
  - Escolha a janela do histórico no topo do painel: 24 horas, 1 semana, 1 mês (padrão), 3 meses, 6 meses ou 1 ano. A escolha é lembrada e sincronizada via `chrome.storage.sync`.
  - O Chrome costuma guardar só os últimos ~90 dias de histórico; por isso 6 meses e 1 ano normalmente mostram o mesmo que 3 meses.
- **Ordenação:**
  - Ao lado do período, escolha a ordem dos cards e dos grupos de repositórios: **Mais visitados** (padrão, pelo total de visitas), **Frequentes e recentes** ("frecency": cada visita vale metade a cada quarto do período, até no máximo 3 meses, então no período de 1 mês uma visita de uma semana atrás vale metade de uma de hoje) ou **Recentes** (pelo último acesso). A troca é instantânea, sem reler o histórico, e também é lembrada e sincronizada. O número no card continua sendo o total de visitas.
- **Busca Instantânea:**
  - Filtra repositórios, domínios e agrupamentos enquanto você digita, pela URL ou pelo título das páginas visitadas (sem diferenciar maiúsculas nem acentos; `Esc` limpa). Os termos encontrados aparecem destacados no nome e no título dos cards.
  - Opcionalmente (em **Configurações** → **Busca**, desativado por padrão), quando a busca casa com uma página interna (um PR, uma issue, um artigo) e não com o próprio repositório ou domínio, até 3 dessas páginas aparecem logo abaixo do card, as mais visitadas primeiro, com link direto.
  - Como o Chrome dá o foco da nova aba à barra de endereço, use `Shift+F6` para ir à busca, `/` quando a página já tem o foco, ou `Alt+T` para abrir o painel com o cursor já na busca (o atalho pode ser trocado em `chrome://extensions/shortcuts`).
  - Funciona como lançador: `Enter` abre o primeiro resultado (a primeira página encontrada, se o card mostrar alguma), `Ctrl+Enter` o abre em segundo plano e `↑`/`↓` percorrem os cards e as páginas.
- **Ocultar Itens:**
  - O `×` que aparece no canto de cada card (ao passar o mouse ou chegar nele com `Tab`) tira o repositório ou domínio do painel, inclusive da busca — útil para buscadores, webmail e páginas de login.
  - O botão **⊘ Ocultos**, que só aparece quando há itens ocultos, abre as configurações (ou a aba delas já aberta) direto na lista do que foi escondido, onde é possível mostrar de novo. A lista é sincronizada via `chrome.storage.sync`.
- **Favicons:**
  - Cada repositório, domínio e host Git mostra o ícone do site, lido do cache local de favicons do Chrome (permissão `favicon`), sem nenhuma requisição externa — funciona também com hosts internos. Sites sem ícone em cache aparecem com o globo padrão.
- **Ícone Próprio:**
  - O painel e as configurações mostram o ícone da extensão na aba, fácil de achar quando ficam abertos entre outras abas. No painel, ele aparece também antes do título.
- **Configurações:**
  - Uma página única, aberta pelo botão **⚙ Configurações** do painel ou em `chrome://extensions` → **Detalhes** → **Opções da extensão**, com quatro seções: hosts Git, agrupamentos, itens ocultos e busca.
  - **Hosts Git:** adicione e remova instâncias personalizadas, escolhendo o tipo de forja, sem editar código.
  - **Agrupamentos:** junte domínios e repositórios sob um título pelo trecho do endereço. Os agrupamentos podem ser editados (✎, `Esc` cancela) e reordenados (↑/↓); a ordem importa, porque quem casa com mais de um agrupamento fica no primeiro da lista.
  - Sincronização via `chrome.storage.sync`; os painéis abertos se atualizam na hora, sem recarregar o histórico.
- **Privacidade Total:**
  - 100% client-side. Nenhum dado de navegação sai da sua máquina.

## 📂 Estrutura do Projeto

```text
├── manifest.json       # Configuração da extensão Manifest V3
├── index.html          # Layout visual do painel
├── app.js              # Estado, renderização, período, ordenação e busca do painel
├── options.html        # Página de configurações (hosts Git, agrupamentos, ocultos)
├── options.js          # Formulários e listas da página de configurações
├── common.css          # Cores e estilos comuns às duas páginas
├── dom.js              # Pedaços de interface comuns às duas páginas (favicons, mensagens)
├── lib/                # Lógica testável, em módulos ES
│   ├── constants.js    # Períodos, limites e hosts padrão
│   ├── text.js         # Normalização de hosts, títulos, busca e URLs
│   ├── forges.js       # Regras de cada forja Git (GitHub, GitLab, Bitbucket…)
│   ├── history.js      # Leitura do histórico e contagem de visitas no período
│   ├── history-cache.js # Cache do histórico processado e atualização incremental
│   ├── categorize.js   # Agregação em repositórios, domínios e agrupamentos
│   ├── sort.js         # Ordenação por visitas, frecency ou último acesso
│   ├── groups.js       # Edição e reordenação dos agrupamentos
│   ├── spatial.js      # Card vizinho na coluna ao lado, para a navegação por ←/→
│   └── storage.js      # Leitura e gravação das configurações
├── tests/              # Testes unitários (Vitest)
├── background.js       # Atalho Alt+T e remoção do cache das páginas apagadas do histórico
├── icons/              # Ícone da extensão: icon.svg (favicon das abas) e PNGs gerados dele
├── theme.css           # Cores geradas pelo matugen (opcional, não versionado)
└── README.md           # Documentação
```

## 🧪 Testes

A extensão não tem build nem dependências; o Node só é usado para os testes da lógica em `lib/`, com um substituto mínimo das APIs `chrome.storage` e `chrome.history`:

```bash
npm install
npm test            # uma execução
npm run test:watch  # reexecuta a cada alteração
```

Ao empacotar a extensão, deixe de fora `node_modules/`, `tests/` e `package*.json`.

## 🛠️ Como Instalar no Google Chrome

1. Clone este repositório ou extraia o arquivo `.zip` em um diretório local.
2. Abra o Chrome no perfil desejado e acesse:
   ```text
   chrome://extensions
   ```
3. No canto superior direito, ative a opção **Modo do desenvolvedor** (*Developer mode*).
4. Clique em **Carregar sem compactação** (*Load unpacked*).
5. Selecione a pasta onde os arquivos foram extraídos.
6. Abra uma nova aba (`Ctrl + T` no Linux/Windows ou `Cmd + T` no macOS). O Chrome exibirá uma caixa de diálogo perguntando se deseja manter a alteração; clique em **Manter**.

## ⚙️ Configurando Domínios Git

Por padrão, a extensão monitora `github.com` e `gitlab.com`.

Para adicionar instâncias corporativas ou self-hosted:
1. Abra uma nova aba.
2. Clique no botão **⚙ Configurações** no canto superior direito (ou abra as opções da extensão em `chrome://extensions`).
3. Insira o host da sua instância (exemplo: `gitlab.empresa.local`, `git.meudominio.com`).
4. Pressione Enter ou clique em **Adicionar**.
5. Os painéis abertos reagrupam o histórico automaticamente com os novos hosts.

## 🎨 Tema com matugen

As cores do painel podem acompanhar o papel de parede via [matugen](https://github.com/InioX/matugen). Como a extensão é carregada sem compactação, o Chrome lê os arquivos direto da pasta a cada nova aba: basta o matugen gerar um `theme.css` aqui dentro, sem recarregar a extensão. Sem esse arquivo, valem as cores padrão definidas em `common.css`. O mesmo `theme.css` vale para o painel e para a página de configurações.

1. Crie o template `~/.config/matugen/templates/chrome-startpage.css`:
   ```css
   :root {
       --bg: {{colors.surface.default.hex}};
       --card-bg: {{colors.surface_container.default.hex}};
       --card-hover: {{colors.surface_container_high.default.hex}};
       --text: {{colors.on_surface.default.hex}};
       --text-muted: {{colors.on_surface_variant.default.hex}};
       --accent: {{colors.primary.default.hex}};
       --on-accent: {{colors.on_primary.default.hex}};
       --accent-hover: color-mix(in srgb, {{colors.primary.default.hex}} 80%, {{colors.on_surface.default.hex}});
       --border: {{colors.outline_variant.default.hex}};
       --danger: {{colors.error.default.hex}};
   }
   ```
2. Registre-o no `~/.config/matugen/config.toml`, apontando a saída para a pasta da extensão:
   ```toml
   [templates.chrome-startpage]
   input_path = '~/.config/matugen/templates/chrome-startpage.css'
   output_path = '~/workspace/chrome-dynamic-startpage/theme.css'
   ```
3. Na próxima troca de papel de parede (`matugen image …`), basta abrir uma nova aba.

## ⌨️ Atalhos de Teclado

| Atalho | Ação |
| --- | --- |
| `Shift+F6` | Leva o foco da barra de endereço para a busca do painel (o `F6` também funciona, mas passa antes pela faixa de abas). |
| `/` | Foca a busca de qualquer ponto da página. |
| `Esc` | Limpa a busca. |
| `Enter` (na busca) | Abre o primeiro resultado, se houver algo digitado; se o primeiro card mostrar páginas encontradas, abre a primeira delas. |
| `Ctrl+Enter` | Abre o primeiro resultado (ou o card focado) numa aba em segundo plano. |
| `↑` / `↓` | Percorrem os cards, as páginas encontradas abaixo deles e os botões "Mostrar mais" a partir da busca; `↑` no primeiro card volta para a busca. |
| `←` / `→` | Vão para o card mais próximo na coluna ao lado, inclusive entre repositórios e domínios. |
| `Alt+T` | Abre o painel numa nova aba com o cursor já na busca. |

### O `Alt+T` não funciona

O `Alt+T` é apenas o atalho **sugerido** pela extensão, e o Chrome pode não atribuí-lo, sem nenhum aviso. Isso acontece quando outra extensão do mesmo perfil já usa a combinação e também foi observado ao recarregar uma versão anterior da extensão, que ainda não tinha o atalho. Como cada perfil do Chrome tem suas próprias extensões e atalhos, ele pode funcionar num perfil e não em outro.

Para corrigir:
1. Acesse `chrome://extensions/shortcuts` no perfil afetado.
2. Localize **Abrir o painel com o foco na busca**. Se o campo estiver vazio, clique no lápis e pressione `Alt+T` (ou outra combinação de sua preferência).
3. Se o Chrome informar que o atalho já está em uso, a extensão que o ocupa aparece na mesma página; escolha outra combinação para uma das duas.

## 📄 Licença

MIT
