/**
 * 领域层共享纯工具（`internal/` 一律无 IO、无运行时依赖）。
 *
 * deepFreeze 与各评估模块原先内联的实现行为一致：已冻结子树短路、只遍历可枚举自有属性
 * （Object.values）、返回原引用。WeakSet 仅用于终止循环引用（原实现遇环会栈溢出；
 * 对无环输入的冻结结果逐字节一致）。已冻结子树不深入——后代保持原样，这与原实现相同。
 */
export function deepFreeze<T>(value: T): T {
  return freezeNode(value, new WeakSet<object>());
}

function freezeNode<T>(value: T, seen: WeakSet<object>): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeNode(child, seen);
  return Object.freeze(value);
}
