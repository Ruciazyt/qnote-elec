import { z } from "zod";

export function jsonSchemaToZod(schema: unknown): z.ZodType {
  if (!schema || typeof schema !== "object") return z.any();
  const node = schema as Record<string, any>;
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  const hasEnum = Array.isArray(node.enum) && node.enum.length > 0;

  if (hasEnum && (type === "string" || type === undefined)) {
    const values = node.enum.map((v: unknown) => String(v));
    return z.enum(values as [string, ...string[]]);
  }

  const union = node.anyOf ?? node.oneOf;
  if (Array.isArray(union) && union.length > 0) {
    const members = union.map((item: unknown) => jsonSchemaToZod(item));
    if (members.length === 1) return members[0];
    return z.union(members as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }

  switch (type) {
    case "string":
      return describe(z.string(), node);
    case "number":
      return describe(z.number(), node);
    case "integer":
      return describe(z.number().int(), node);
    case "boolean":
      return describe(z.boolean(), node);
    case "null":
      return z.null();
    case "array": {
      const items = node.items ? jsonSchemaToZod(node.items) : z.any();
      return describe(z.array(items), node);
    }
    case "object": {
      const properties = (node.properties ?? {}) as Record<string, unknown>;
      const required = new Set(
        Array.isArray(node.required) ? (node.required as string[]) : []
      );
      const shape: Record<string, z.ZodType> = {};
      for (const [key, value] of Object.entries(properties)) {
        const field = jsonSchemaToZod(value);
        shape[key] = required.has(key) ? field : field.optional();
      }
      const base =
        node.additionalProperties === false
          ? z.strictObject(shape)
          : z.looseObject(shape);
      return describe(base, node);
    }
    default:
      return z.any();
  }
}

function describe<T extends z.ZodType>(schema: T, node: Record<string, any>): T {
  if (typeof node.description === "string" && node.description.trim()) {
    return schema.describe(node.description);
  }
  return schema;
}
