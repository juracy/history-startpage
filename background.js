// Aberto como página comum da extensão (e não como nova aba), o painel recebe o foco
// em vez da barra de endereço, e o autofocus coloca o cursor na busca
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-search') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }
});
