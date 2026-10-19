// Navegação por ←/→ entre colunas. A decisão é pela posição na tela, e não pelo DOM, para valer
// igual nas colunas de texto, na grade dos agrupamentos e na passagem entre as duas seções.
// Os retângulos têm o formato de getBoundingClientRect: { left, right, top, bottom }

// Folga para bordas que se tocam ou arredondamentos de subpixel
const EDGE_TOLERANCE = 1;

const overlapsHorizontally = (a, b) => a.left < b.right && b.left < a.right;
const centerY = rect => (rect.top + rect.bottom) / 2;

// Índice do item mais próximo na coluna vizinha, ou -1 se não houver nada daquele lado
export function findHorizontalNeighbor(current, candidates, direction) {
  const toRight = direction === 'right';
  const onSide = candidates
    .map((rect, index) => ({ rect, index }))
    .filter(({ rect }) => toRight
      ? rect.left >= current.right - EDGE_TOLERANCE
      : rect.right <= current.left + EDGE_TOLERANCE);
  if (onSide.length === 0) return -1;

  // A coluna é a do candidato de borda mais próxima; as páginas encontradas, recuadas sob o
  // card, se sobrepõem a ele e contam como da mesma coluna
  const nearest = onSide.reduce((best, item) => (toRight
    ? item.rect.left < best.rect.left
    : item.rect.right > best.rect.right) ? item : best);
  const column = onSide.filter(({ rect }) => overlapsHorizontally(rect, nearest.rect));

  // Na coluna, o de altura mais próxima; no empate, o de cima
  const y = centerY(current);
  return column.reduce((best, item) => {
    const diff = Math.abs(centerY(item.rect) - y) - Math.abs(centerY(best.rect) - y);
    return diff < 0 || (diff === 0 && item.rect.top < best.rect.top) ? item : best;
  }).index;
}

// O limite do "Mostrar mais" sobe até completar a última linha, usando itens que estavam escondidos
export function fillRows(limit, columns) {
  const perRow = Math.max(1, columns);
  return Math.ceil(limit / perRow) * perRow;
}

// Colunas de texto (`columns: <largura>`): o Chrome não expõe a quantidade, que segue a regra
// de `column-count: auto`
export function multicolCount(width, columnWidth, gap) {
  return Math.max(1, Math.floor((width + gap) / (columnWidth + gap)));
}
