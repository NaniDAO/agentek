import type { z } from "zod";

export type JsonSchema = Record<string, any>;

/** Model-facing input schemas only. Zod remains the execution validator.
 * Schemas are inlined; unsupported or recursive shapes fail explicitly.
 */
export function toolInputSchema(schema: z.ZodTypeAny): JsonSchema {
  const active = new Set<z.ZodTypeAny>();
  const convert = (value: z.ZodTypeAny, depth = 0): JsonSchema => {
    if (depth > 64 || active.has(value)) throw new Error("Recursive tool schemas are unsupported");
    active.add(value);
    try {
      const def = value._def as any;
      const child = (s: z.ZodTypeAny) => convert(s, depth + 1);
      let out: JsonSchema;
      switch (def.typeName) {
        case "ZodString":
          out = {type: "string"};
          for (const check of def.checks) {
            if (check.kind === "min") out.minLength = Math.max(out.minLength ?? 0, check.value);
            else if (check.kind === "max") out.maxLength = Math.min(out.maxLength ?? Infinity, check.value);
            else if (check.kind === "length") out.minLength = out.maxLength = check.value;
            else if (check.kind === "regex") {
              if (out.pattern) out = {type: "string", allOf: [out, {pattern: check.regex.source}]};
              else out.pattern = check.regex.source;
            } else if (["email", "uuid", "url", "datetime"].includes(check.kind)) {
              out.format = ({url: "uri", datetime: "date-time"} as Record<string, string>)[check.kind] ?? check.kind;
            }
          }
          break;
        case "ZodNumber":
          out = {type: def.checks.some((c: any) => c.kind === "int") ? "integer" : "number"};
          for (const check of def.checks) {
            if (check.kind === "min") { const key = check.inclusive ? "minimum" : "exclusiveMinimum"; out[key] = Math.max(out[key] ?? -Infinity, check.value); }
            if (check.kind === "max") { const key = check.inclusive ? "maximum" : "exclusiveMaximum"; out[key] = Math.min(out[key] ?? Infinity, check.value); }
            if (check.kind === "multipleOf") out.multipleOf = check.value;
          }
          break;
        case "ZodBoolean": out = {type: "boolean"}; break;
        case "ZodNull": out = {type: "null"}; break;
        case "ZodLiteral": out = {type: def.value === null ? "null" : typeof def.value, const: def.value}; break;
        case "ZodEnum": out = {type: "string", enum: [...def.values]}; break;
        case "ZodObject": {
          const shape = def.shape() as Record<string, z.ZodTypeAny>;
          const required = Object.entries(shape).filter(([, v]) => !v.isOptional()).map(([key]) => key);
          out = {type: "object", properties: Object.fromEntries(Object.entries(shape).map(([key, v]) => [key, child(v)])),
            ...(required.length ? {required} : {}),
            additionalProperties: def.catchall?._def.typeName !== "ZodNever" ? child(def.catchall) : def.unknownKeys === "passthrough"};
          break;
        }
        case "ZodArray":
          out = {type: "array", items: child(def.type)};
          if (def.minLength) out.minItems = def.minLength.value;
          if (def.maxLength) out.maxItems = def.maxLength.value;
          if (def.exactLength) out.minItems = out.maxItems = def.exactLength.value;
          break;
        case "ZodUnion": out = {anyOf: def.options.map(child)}; break;
        case "ZodDiscriminatedUnion": out = {anyOf: [...def.options.values()].map(child)}; break;
        case "ZodIntersection": out = {allOf: [child(def.left), child(def.right)]}; break;
        case "ZodRecord": {
          const keys = child(def.keyType);
          out = {type: "object", additionalProperties: child(def.valueType)};
          if (keys.pattern) out.propertyNames = {pattern: keys.pattern};
          if (keys.enum) out.propertyNames = {enum: keys.enum};
          break;
        }
        case "ZodOptional": out = child(def.innerType); break;
        case "ZodNullable": out = {anyOf: [child(def.innerType), {type: "null"}]}; break;
        case "ZodDefault": out = {...child(def.innerType), default: def.defaultValue()}; break;
        case "ZodEffects": out = child(def.schema); break;
        case "ZodPipeline": out = child(def.in); break;
        case "ZodBranded": out = child(def.type); break;
        case "ZodReadonly": out = child(def.innerType); break;
        case "ZodAny": case "ZodUnknown": out = {}; break;
        case "ZodNever": out = {not: {}}; break;
        default: throw new Error(`Unsupported tool schema: ${def.typeName}`);
      }
      return value.description ? {...out, description: value.description} : out;
    } finally { active.delete(value); }
  };
  return convert(schema);
}
