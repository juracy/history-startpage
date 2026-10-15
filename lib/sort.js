// Ordenação dos cards e dos grupos de repositórios, conforme o modo escolhido no painel.
// Os empates caem para as visitas e, depois, para o último acesso
const COMPARE = {
  visits: (a, b) => b.count - a.count || b.lastVisitTime - a.lastVisitTime,
  frecency: (a, b) => b.score - a.score || b.count - a.count || b.lastVisitTime - a.lastVisitTime,
  recent: (a, b) => b.lastVisitTime - a.lastVisitTime || b.count - a.count
};

export function sortItems(items, orderId) {
  return [...items].sort(COMPARE[orderId] || COMPARE.visits);
}

// Um grupo resume os itens: soma das visitas e da frecency e o acesso mais recente
export function summarizeGroup(items) {
  return items.reduce((acc, item) => ({
    count: acc.count + item.count,
    score: acc.score + item.score,
    lastVisitTime: Math.max(acc.lastVisitTime, item.lastVisitTime)
  }), { count: 0, score: 0, lastVisitTime: 0 });
}
