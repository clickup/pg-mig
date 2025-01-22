export async function promiseAllMap<T, V>(
  arr: T[],
  func: (item: T) => Promise<V>,
): Promise<V[]> {
  return Promise["all"](arr.map(func));
}
