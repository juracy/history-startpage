// Pedaços de interface comuns ao painel e à página de configurações

export function renderMessage(container, text) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = text;
  container.replaceChildren(div);
  return div;
}

// Lê o cache local de favicons do Chrome (permissão "favicon"), sem nenhuma requisição externa;
// sem ícone em cache, o Chrome devolve o globo padrão. O dobro do tamanho exibido (32px nos
// cards), para ficar nítido em telas HiDPI quando o site oferece um ícone maior
function faviconUrl(pageUrl) {
  const params = new URLSearchParams({ pageUrl, size: '64' });
  return chrome.runtime.getURL(`/_favicon/?${params}`);
}

export function createFavicon(pageUrl) {
  const img = document.createElement('img');
  img.className = 'item-icon';
  img.src = faviconUrl(pageUrl);
  img.alt = '';
  img.loading = 'lazy';
  return img;
}

// Página usada para o ícone de um host nas listas de configuração: a raiz visitada, de
// hostIconPages (chaves sem "www."); sem ela, o Chrome procura um ícone qualquer do host
export function hostIconPage(hostIconPages, host) {
  return hostIconPages.get(host.replace(/^www\./, '')) || `https://${host}/`;
}

export function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}
