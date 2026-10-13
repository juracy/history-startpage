import { removeFromHistoryCache } from './lib/history-cache.js';
import { createSaveQueue } from './lib/storage.js';

// Remoções seguidas leem e regravam o cache; a fila evita que uma desfaça a outra
const enqueueRemoval = createSaveQueue();

// Aberto como página comum da extensão (e não como nova aba), o painel recebe o foco
// em vez da barra de endereço, e o autofocus coloca o cursor na busca
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-search') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }
});

chrome.history.onVisitRemoved.addListener((removed) => {
  enqueueRemoval(() => removeFromHistoryCache(removed))
    .catch(e => console.error('Falha ao tirar páginas apagadas do cache do histórico:', e));
});
