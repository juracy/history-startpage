import { describe, expect, it } from 'vitest';
import { fillRows, findHorizontalNeighbor, multicolCount } from '../lib/spatial.js';

const rect = (left, top, width = 100, height = 40) => ({ left, top, right: left + width, bottom: top + height });

// Três colunas de cards (x = 0, 110, 220), a do meio mais curta
const columns = [
  rect(0, 0), rect(0, 50), rect(0, 100),
  rect(110, 0), rect(110, 50),
  rect(220, 0), rect(220, 50), rect(220, 100)
];

describe('findHorizontalNeighbor', () => {
  it('vai para o item da mesma altura na coluna ao lado', () => {
    expect(findHorizontalNeighbor(columns[1], columns, 'right')).toBe(4);
    expect(findHorizontalNeighbor(columns[4], columns, 'right')).toBe(6);
    expect(findHorizontalNeighbor(columns[4], columns, 'left')).toBe(1);
  });

  it('numa coluna mais curta, vai para o item mais próximo dela', () => {
    expect(findHorizontalNeighbor(columns[2], columns, 'right')).toBe(4);
    expect(findHorizontalNeighbor(columns[7], columns, 'left')).toBe(4);
  });

  it('não pula a coluna vizinha mesmo que outra tenha um item mais alinhado', () => {
    const current = rect(0, 100);
    const candidates = [rect(110, 0), rect(220, 100)];
    expect(findHorizontalNeighbor(current, candidates, 'right')).toBe(0);
  });

  it('conta a página recuada sob um card como da mesma coluna', () => {
    const candidates = [rect(110, 0), rect(140, 42, 70, 20), rect(110, 70)];
    expect(findHorizontalNeighbor(rect(0, 40), candidates, 'right')).toBe(1);
  });

  it('não volta para a página recuada do próprio card', () => {
    const candidates = [rect(0, 0), rect(30, 42, 70, 20)];
    expect(findHorizontalNeighbor(candidates[0], candidates, 'right')).toBe(-1);
    expect(findHorizontalNeighbor(candidates[1], candidates, 'left')).toBe(-1);
  });

  it('devolve -1 na borda, sem dar a volta', () => {
    expect(findHorizontalNeighbor(columns[0], columns, 'left')).toBe(-1);
    expect(findHorizontalNeighbor(columns[5], columns, 'right')).toBe(-1);
  });

  it('no empate de altura, fica com o de cima', () => {
    const candidates = [rect(110, 50), rect(110, 0)];
    expect(findHorizontalNeighbor(rect(0, 25), candidates, 'right')).toBe(1);
  });
});

describe('fillRows', () => {
  it('sobe o limite até completar a última linha', () => {
    expect(fillRows(5, 2)).toBe(6);
    expect(fillRows(5, 3)).toBe(6);
    expect(fillRows(5, 4)).toBe(8);
    expect(fillRows(15, 2)).toBe(16);
    expect(fillRows(15, 3)).toBe(15);
  });

  it('mantém o limite com uma coluna ou sem medida', () => {
    expect(fillRows(5, 1)).toBe(5);
    expect(fillRows(5, 0)).toBe(5);
  });
});

describe('multicolCount', () => {
  it('conta as colunas que cabem, com o espaço entre elas', () => {
    expect(multicolCount(656, 320, 16)).toBe(2);
    expect(multicolCount(655, 320, 16)).toBe(1);
    expect(multicolCount(1000, 320, 16)).toBe(3);
  });

  it('tem pelo menos uma coluna', () => {
    expect(multicolCount(200, 320, 16)).toBe(1);
  });
});
