import { describe, expect, it } from 'vitest';
import { moveGroup, updateGroup } from '../lib/groups.js';

const groups = [
  { id: 'a', title: 'A', pattern: 'a.com' },
  { id: 'b', title: 'B', pattern: 'b.com' },
  { id: 'c', title: 'C', pattern: 'c.com' }
];

const ids = list => list.map(g => g.id);

describe('moveGroup', () => {
  it('troca o agrupamento de lugar com o vizinho', () => {
    expect(ids(moveGroup(groups, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(ids(moveGroup(groups, 'b', 1))).toEqual(['a', 'c', 'b']);
  });

  it('não altera a lista original', () => {
    moveGroup(groups, 'a', 1);
    expect(ids(groups)).toEqual(['a', 'b', 'c']);
  });

  it('devolve a mesma referência nas pontas ou com id inexistente', () => {
    expect(moveGroup(groups, 'a', -1)).toBe(groups);
    expect(moveGroup(groups, 'c', 1)).toBe(groups);
    expect(moveGroup(groups, 'x', 1)).toBe(groups);
  });
});

describe('updateGroup', () => {
  it('troca título e trecho mantendo id e posição', () => {
    const result = updateGroup(groups, 'b', { title: 'Novo', pattern: 'novo.com' });
    expect(result).toEqual([
      groups[0],
      { id: 'b', title: 'Novo', pattern: 'novo.com' },
      groups[2]
    ]);
  });

  it('devolve a mesma referência quando nada muda ou o id não existe', () => {
    expect(updateGroup(groups, 'b', { title: 'B', pattern: 'b.com' })).toBe(groups);
    expect(updateGroup(groups, 'x', { title: 'X', pattern: 'x.com' })).toBe(groups);
  });

  it('recusa um trecho que já é de outro agrupamento', () => {
    expect(updateGroup(groups, 'b', { title: 'B', pattern: 'c.com' })).toBe(groups);
  });
});
