// Operações sobre a lista de agrupamentos. Devolver a mesma referência significa
// "nada a salvar", como espera o update de saveUrlGroups

// A ordem importa: quando uma URL casa com mais de um agrupamento, vale o de menor índice
export function moveGroup(groups, id, delta) {
  const from = groups.findIndex(g => g.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= groups.length) return groups;

  const result = [...groups];
  [result[from], result[to]] = [result[to], result[from]];
  return result;
}

// Recusa um trecho já usado por outro agrupamento, pois o storage não guarda trechos repetidos
export function updateGroup(groups, id, { title, pattern }) {
  const current = groups.find(g => g.id === id);
  if (!current) return groups;
  if (current.title === title && current.pattern === pattern) return groups;
  if (groups.some(g => g.id !== id && g.pattern === pattern)) return groups;

  return groups.map(g => g === current ? { id, title, pattern } : g);
}
