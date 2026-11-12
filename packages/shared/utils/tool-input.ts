// Keep this envelope large enough for 32 batch calls with 64 KiB calldata each.
// Hosts may impose smaller limits for assistant-generated arguments.
export const TOOL_INPUT_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  depth: 32,
  nodes: 16_384,
  collection: 1_024,
});

/** Bound work before schema validation, including nested values under z.any(). */
export function assertToolInput(value: unknown): void {
  let nodes = 0;
  let bytes = 0;
  const active = new Set<object>();
  const fail = (limit: string): never => { throw new Error(`Tool input exceeds ${limit} limit`); };
  const text = (value: string) => {
    // Check code units before encoding, so a huge string never gets copied.
    if (value.length > TOOL_INPUT_LIMITS.bytes - bytes) fail("byte");
    bytes += new TextEncoder().encode(value).byteLength;
    if (bytes > TOOL_INPUT_LIMITS.bytes) fail("byte");
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > TOOL_INPUT_LIMITS.nodes) fail("node");
    if (depth > TOOL_INPUT_LIMITS.depth) fail("depth");
    if (typeof item === "string") { text(item); return; }
    if (typeof item === "bigint") { text(item.toString()); return; }
    if (item === null || typeof item !== "object") return;
    if (active.has(item)) throw new Error("Tool input must not contain cycles");
    active.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > TOOL_INPUT_LIMITS.collection) fail("collection");
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, index);
          if (descriptor && !("value" in descriptor)) throw new Error("Tool input must not contain accessors");
          visit(descriptor?.value, depth + 1);
        }
      } else {
        if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
          throw new Error("Tool input must contain plain objects and arrays");
        }
        // Zod reads declared properties even when they are non-enumerable.
        const keys = Object.getOwnPropertyNames(item);
        if (keys.length > TOOL_INPUT_LIMITS.collection) fail("collection");
        for (const key of keys) {
          text(key);
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
          if (!("value" in descriptor)) throw new Error("Tool input must not contain accessors");
          visit(descriptor.value, depth + 1);
        }
      }
    } finally { active.delete(item); }
  };
  visit(value, 0);
}

/** Cap the encoded envelope before JSON.parse, then validate its structure. */
export function parseToolInputJSON(json: string): unknown {
  if (typeof json !== "string" || json.length > TOOL_INPUT_LIMITS.bytes ||
      new TextEncoder().encode(json).byteLength > TOOL_INPUT_LIMITS.bytes) {
    throw new Error("Tool input exceeds byte limit");
  }
  const value: unknown = JSON.parse(json);
  assertToolInput(value);
  return value;
}
