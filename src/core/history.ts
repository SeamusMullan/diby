/**
 * MODULE core-ui — persisted challenge history. No vscode import (KeyValueStore is structural).
 */
import { HISTORY_STATE_KEY, MAX_HISTORY_ENTRIES } from '../constants';
import type { HistoryEntry, HistoryStore, KeyValueStore } from '../types';

/** History persisted in a Memento-like store (pass `context.globalState`). */
export class MementoHistoryStore implements HistoryStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly key: string = HISTORY_STATE_KEY,
    private readonly maxEntries: number = MAX_HISTORY_ENTRIES,
  ) {}

  all(): readonly HistoryEntry[] {
    const value = this.store.get<HistoryEntry[]>(this.key);
    return Array.isArray(value) ? value : [];
  }

  async add(entry: HistoryEntry): Promise<void> {
    const next = [...this.all(), entry];
    await this.store.update(this.key, next.slice(Math.max(0, next.length - this.maxEntries)));
  }

  async update(id: string, patch: Partial<Omit<HistoryEntry, 'id'>>): Promise<void> {
    const current = this.all();
    if (!current.some((e) => e.id === id)) return;
    await this.store.update(
      this.key,
      current.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  }
}

/** In-memory history for tests. */
export class InMemoryHistoryStore implements HistoryStore {
  private entries: HistoryEntry[];

  constructor(entries: HistoryEntry[] = []) {
    this.entries = [...entries];
  }

  all(): readonly HistoryEntry[] {
    return this.entries;
  }

  async add(entry: HistoryEntry): Promise<void> {
    this.entries = [...this.entries, entry];
  }

  async update(id: string, patch: Partial<Omit<HistoryEntry, 'id'>>): Promise<void> {
    this.entries = this.entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  }
}
