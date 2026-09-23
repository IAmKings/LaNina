export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, new Set<object>(), "$?");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalJsonValue(value: unknown, parents: Set<object>, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(`${path} contains a non-canonical number`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`${path} contains ${typeof value}`);
  if (parents.has(value)) throw new TypeError(`${path} contains a cycle`);
  parents.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError(`${path}[${index}] is sparse`);
      }
      return `[${value.map((item, index) => canonicalJsonValue(item, parents, `${path}[${index}]`)).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(`${path} is not a plain object`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new TypeError(`${path} contains a symbol key`);
    }
    const record = value as Record<string, unknown>;
    return `{${(ownKeys as string[])
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key], parents, `${path}.${key}`)}`)
      .join(",")}}`;
  } finally {
    parents.delete(value);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
