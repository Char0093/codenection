import { z } from "zod";

type JsonSchemaObject = Record<string, unknown>;

/**
 * Gemini's `responseJsonSchema` does not accept plain JSON Schema as-is. Confirmed against the
 * live API: schemas carrying `$schema`, `anyOf`-encoded nullability, or value-constraint keywords
 * (`pattern`, `minLength`/`maxLength`, `minimum`/`maximum`, `minItems`/`maxItems`,
 * `additionalProperties`) intermittently return a 400 INVALID_ARGUMENT. Gemini's schema support is
 * effectively the OpenAPI 3.0 subset: type/format/description/nullable/enum/items/properties/
 * required. Value-level constraints stay enforced where they always were -- Zod validation on the
 * parsed response in lib/domain/gemini-proposal-validation.ts -- this only shapes what Gemini
 * is asked to produce.
 */
const UNSUPPORTED_KEYS = new Set([
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "additionalProperties",
  "$schema",
]);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== "object") return node;
  const obj = node as JsonSchemaObject;

  const result: JsonSchemaObject = {};
  for (const [key, value] of Object.entries(obj)) {
    if (UNSUPPORTED_KEYS.has(key)) continue;
    result[key] = sanitize(value);
  }

  // Zod encodes `.nullable()` two ways depending on whether the base type carries other
  // keywords: a bare `type: [X, "null"]`, or `anyOf: [{...}, {type: "null"}]`. Gemini
  // recognizes neither -- it wants the base schema plus a sibling `nullable: true` flag.
  if (Array.isArray(result.anyOf) && result.anyOf.length === 2) {
    const [first, second] = result.anyOf as JsonSchemaObject[];
    const nullBranch = second?.type === "null" ? first : first?.type === "null" ? second : null;
    if (nullBranch) {
      const { anyOf: _anyOf, ...rest } = result;
      return { ...rest, ...nullBranch, nullable: true };
    }
  }
  if (Array.isArray(result.type) && result.type.length === 2 && result.type.includes("null")) {
    const baseType = result.type.find((entry) => entry !== "null");
    return { ...result, type: baseType, nullable: true };
  }

  return result;
}

/** Converts a Zod schema into a Gemini-safe response JSON schema. */
export function toGeminiResponseSchema(schema: z.ZodType): object {
  return sanitize(z.toJSONSchema(schema, { target: "draft-07" })) as object;
}
