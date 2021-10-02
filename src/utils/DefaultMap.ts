export class DefaultMap<K, V> extends Map<K, V> {
  getOrAdd(k: K, def: V): V {
    if (!this.has(k)) {
      this.set(k, def);
      return def;
    }

    return this.get(k)!;
  }
}
