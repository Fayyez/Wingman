import { describe, expect, it } from 'vitest';
import { InsertQueue, splitParts } from './cards';

describe('insert-next logic', () => {
  it('single-line card inserts whole, once', () => {
    const q = new InsertQueue('hahaha acha phir?');
    expect(q.remaining).toBe(1);
    expect(q.next()).toBe('hahaha acha phir?');
    expect(q.remaining).toBe(0);
    expect(q.next()).toBeNull();
  });

  it('multi-line card yields first part then the rest', () => {
    const q = new InsertQueue('pehle yeh\n\nphir yeh\n  aur yeh  ');
    expect(q.remaining).toBe(3);
    expect(q.started).toBe(false);
    expect(q.next()).toBe('pehle yeh');
    expect(q.remaining).toBe(2);
    expect(q.next()).toBe('phir yeh');
    expect(q.next()).toBe('aur yeh');
    expect(q.next()).toBeNull();
  });

  it('splitParts drops empties; blank text falls back to itself', () => {
    expect(splitParts('a\n\n\nb\n')).toEqual(['a', 'b']);
    expect(new InsertQueue('   ').next()).toBe('   ');
  });
});
