# Chrome Dynamic Startpage

Extensão leve (Manifest V3) para Google Chrome / navegadores Chromium que substitui a **New Tab Page** por um painel analítico dos seus acessos no período escolhido (padrão: 30 dias).

## 🚀 Funcionalidades

- **Agregação Inteligente de Repositórios Git:**
  - Suporta GitHub, GitLab, Gitea, Forgejo e instâncias privadas/self-hosted.
  - Normaliza subpastas e rotas internas (ignora `/-/`, `/tree/`, `/pulls`, etc.).
  - Agrupa repositórios por Organização / Workspace / Subgrupo.
- **Domínios Mais Acessados:**
  - Extrai e consolida o host raiz dos seus sites mais frequentados no período, evitando poluição de URLs específicas.
- **Seletor de Período:**
  - Escolha a janela do histórico no topo do painel: 24 horas, 1 semana, 1 mês (padrão), 3 meses, 6 meses ou 1 ano. A escolha é lembrada e sincronizada via `chrome.storage.sync`.
  - O Chrome costuma guardar só os últimos ~90 dias de histórico; por isso 6 meses e 1 ano normalmente mostram o mesmo que 3 meses.
- **Busca Instantânea:**
  - Filtra repositórios, domínios e agrupamentos enquanto você digita, pela URL ou pelo título das páginas visitadas (sem diferenciar maiúsculas nem acentos; `Esc` limpa).
  - Como o Chrome dá o foco da nova aba à barra de endereço, use `Shift+F6` para ir à busca, `/` quando a página já tem o foco, ou `Alt+T` para abrir o painel com o cursor já na busca (o atalho pode ser trocado em `chrome://extensions/shortcuts`).
- **Favicons:**
  - Cada repositório, domínio e host Git mostra o ícone do site, lido do cache local de favicons do Chrome (permissão `favicon`), sem nenhuma requisição externa — funciona também com hosts internos. Sites sem ícone em cache aparecem com o globo padrão.
- **Configuração Dinâmica in-browser:**
  - Modal nativo para adicionar e remover instâncias Git personalizadas sem editar código.
  - Sincronização via `chrome.storage.sync`.
- **Privacidade Total:**
  - 100% client-side. Nenhum dado de navegação sai da sua máquina.

## 📂 Estrutura do Projeto

```text
├── manifest.json       # Configuração da extensão Manifest V3
├── index.html          # Layout visual e interface do modal
├── app.js              # Lógica de extração, agregação e storage
├── background.js       # Atalho Alt+T que abre o painel com foco na busca
├── theme.css           # Cores geradas pelo matugen (opcional, não versionado)
└── README.md           # Documentação
```

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
2. Clique no botão **⚙ Configurar Git** no canto superior direito.
3. Insira o host da sua instância (exemplo: `gitlab.empresa.local`, `git.meudominio.com`).
4. Pressione Enter ou clique em **Adicionar**.
5. O painel reprocessará seu histórico automaticamente com os novos agrupamentos.

## 🎨 Tema com matugen

As cores do painel podem acompanhar o papel de parede via [matugen](https://github.com/InioX/matugen). Como a extensão é carregada sem compactação, o Chrome lê os arquivos direto da pasta a cada nova aba: basta o matugen gerar um `theme.css` aqui dentro, sem recarregar a extensão. Sem esse arquivo, valem as cores padrão definidas em `index.html`.

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
| `Alt+T` | Abre o painel numa nova aba com o cursor já na busca. |

### O `Alt+T` não funciona

O `Alt+T` é apenas o atalho **sugerido** pela extensão, e o Chrome pode não atribuí-lo, sem nenhum aviso. Isso acontece quando outra extensão do mesmo perfil já usa a combinação e também foi observado ao recarregar uma versão anterior da extensão, que ainda não tinha o atalho. Como cada perfil do Chrome tem suas próprias extensões e atalhos, ele pode funcionar num perfil e não em outro.

Para corrigir:
1. Acesse `chrome://extensions/shortcuts` no perfil afetado.
2. Localize **Abrir o painel com o foco na busca**. Se o campo estiver vazio, clique no lápis e pressione `Alt+T` (ou outra combinação de sua preferência).
3. Se o Chrome informar que o atalho já está em uso, a extensão que o ocupa aparece na mesma página; escolha outra combinação para uma das duas.

## 📄 Licença

MIT
