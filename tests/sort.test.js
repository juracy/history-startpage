import { describe, expect, it } from 'vitest';
import { sortItems, summarizeGroup } from '../lib/sort.js';

const items = [
  { key: 'antigo-frequente', count: 10, score: 1, lastVisitTime: 100 },
  { key: 'recente-raro', count: 2, score: 1.8, lastVisitTime: 300 },
  { key: 'meio', count: 5, score: 2.5, lastVisitTime: 200 }
];
const keys = list => list.map(item => item.key);

describe('sortItems', () => {
  it('ordena pelas visitas, pela frecency ou pelo último acesso', () => {
    expect(keys(sortItems(items, 'visits'))).toEqual(['antigo-frequente', 'meio', 'recente-raro']);
    expect(keys(sortItems(items, 'frecency'))).toEqual(['meio', 'recente-raro', 'antigo-frequente']);
    expect(keys(sortItems(items, 'recent'))).toEqual(['recente-raro', 'meio', 'antigo-frequente']);
  });

  it('desempata pelas visitas e depois pelo último acesso', () => {
    const tied = [
      { key: 'a', count: 1, score: 1, lastVisitTime: 100 },
      { key: 'b', count: 3, score: 1, lastVisitTime: 100 },
      { key: 'c', count: 3, score: 1, lastVisitTime: 200 }
    ];
    expect(keys(sortItems(tied, 'frecency'))).toEqual(['c', 'b', 'a']);
    expect(keys(sortItems(tied, 'recent'))).toEqual(['c', 'b', 'a']);
  });

  it('usa as visitas para um modo desconhecido, sem alterar a lista recebida', () => {
    const copy = [...items];
    expect(keys(sortItems(items, 'outro'))).toEqual(['antigo-frequente', 'meio', 'recente-raro']);
    expect(items).toEqual(copy);
  });
});

describe('summarizeGroup', () => {
  it('soma visitas e frecency e fica com o acesso mais recente', () => {
    expect(summarizeGroup(items)).toEqual({ count: 17, score: 5.3, lastVisitTime: 300 });
  });
});
