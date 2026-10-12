import { describe, expect, it } from 'vitest';
import { InMemoryHistoryStore, MementoHistoryStore } from '../../src/core/history';
import type { HistoryEntry, KeyValueStore } from '../../src/types';

const e = (id: string): HistoryEntry => ({
  id, createdAt: 1, status: 'pending', offered: true, symbol: 's', language: 'python', concepts: [], difficulty: 2,
});

function fakeStore(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: <T>(k: string) => data.get(k) as T | undefined,
    update: async (k, v) => void data.set(k, v),
  };
}

describe('MementoHistoryStore', () => {
  it('starts empty, adds and persists', async () => {
    const kv = fakeStore();
    const h = new MementoHistoryStore(kv, 'k');
    expect(h.all()).toEqual([]);
    await h.add(e('a'));
    expect(new MementoHistoryStore(kv, 'k').all().map((x) => x.id)).toEqual(['a']);
  });
  it('trims to newest maxEntries', async () => {
    const h = new MementoHistoryStore(fakeStore(), 'k', 2);
    for (const id of ['a', 'b', 'c']) await h.add(e(id));
    expect(h.all().map((x) => x.id)).toEqual(['b', 'c']);
  });
  it('updates by id and ignores unknown ids', async () => {
    const h = new MementoHistoryStore(fakeStore(), 'k');
    await h.add(e('a'));
    await h.update('a', { status: 'passed', attempts: 2 });
    await h.update('zzz', { status: 'passed' });
    expect(h.all()).toHaveLength(1);
    expect(h.all()[0]).toMatchObject({ id: 'a', status: 'passed', attempts: 2 });
  });
  it('tolerates corrupt stored values', () => {
    const kv = fakeStore();
    kv.data.set('k', 'garbage');
    expect(new MementoHistoryStore(kv, 'k').all()).toEqual([]);
  });
});

describe('InMemoryHistoryStore', () => {
  it('adds and updates', async () => {
    const h = new InMemoryHistoryStore([e('a')]);
    await h.add(e('b'));
    await h.update('b', { status: 'declined' });
    expect(h.all().map((x) => `${x.id}:${x.status}`)).toEqual(['a:pending', 'b:declined']);
  });
});
