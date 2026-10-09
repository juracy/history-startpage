# Chrome Dynamic Startpage

Extensão leve (Manifest V3) para Google Chrome / navegadores Chromium que substitui a **New Tab Page** por um painel analítico dos seus acessos nos últimos 30 dias.

## 🚀 Funcionalidades

- **Agregação Inteligente de Repositórios Git:**
  - Suporta GitHub, GitLab, Gitea, Forgejo e instâncias privadas/self-hosted.
  - Normaliza subpastas e rotas internas (ignora `/-/`, `/tree/`, `/pulls`, etc.).
  - Agrupa repositórios por Organização / Workspace / Subgrupo.
- **Domínios Mais Acessados:**
  - Extrai e consolida o host raiz dos seus sites mais frequentados no mês, evitando poluição de URLs específicas.
- **Busca Instantânea:**
  - Filtra repositórios, domínios e agrupamentos enquanto você digita, pela URL ou pelo título das páginas visitadas (sem diferenciar maiúsculas nem acentos; `Esc` limpa).
  - Como o Chrome dá o foco da nova aba à barra de endereço, use `Shift+F6` para ir à busca, `/` quando a página já tem o foco, ou `Alt+T` para abrir o painel com o cursor já na busca (o atalho pode ser trocado em `chrome://extensions/shortcuts`).
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

## 📄 Licença

MIT
