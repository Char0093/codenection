import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toGeminiResponseSchema } from "@/lib/gemini/json-schema";
import { geminiTripProposalSchema } from "@/lib/gemini/schemas";

describe("toGeminiResponseSchema", () => {
  it("strips the JSON Schema meta-key Gemini does not accept", () => {
    const schema = toGeminiResponseSchema(z.object({ name: z.string() })) as Record<string, unknown>;
    expect(schema.$schema).toBeUndefined();
  });

  it("rewrites a nullable field's anyOf-with-null into a nullable flag", () => {
    const schema = toGeminiResponseSchema(z.object({ note: z.string().nullable() })) as {
      properties: { note: Record<string, unknown> };
    };
    expect(schema.properties.note.anyOf).toBeUndefined();
    expect(schema.properties.note).toMatchObject({ type: "string", nullable: true });
  });

  it("leaves fields with no unsupported keywords untouched", () => {
    const schema = toGeminiResponseSchema(z.object({ active: z.boolean(), note: z.string() })) as {
      properties: { active: Record<string, unknown>; note: Record<string, unknown> };
    };
    expect(schema.properties.active).toEqual({ type: "boolean" });
    expect(schema.properties.note).toEqual({ type: "string" });
  });

  it("strips value-constraint keywords Gemini's structured output does not support", () => {
    const schema = toGeminiResponseSchema(
      z.object({ code: z.string().regex(/^[A-Z]+$/).min(1).max(10), tags: z.array(z.string()).max(5) }),
    ) as { properties: Record<string, Record<string, unknown>> };
    expect(schema.properties.code).toEqual({ type: "string" });
    expect(schema.properties.tags).toMatchObject({ type: "array" });
    expect(schema.properties.tags.maxItems).toBeUndefined();
  });

  it("keeps the structural keywords Gemini does support", () => {
    const schema = toGeminiResponseSchema(z.object({ kind: z.enum(["a", "b"]) })) as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(schema.properties.kind).toEqual({ type: "string", enum: ["a", "b"] });
    expect(schema.required).toContain("kind");
  });

  it("sanitizes the real trip-proposal schema with no leftover meta-keys or value constraints", () => {
    const schema = toGeminiResponseSchema(geminiTripProposalSchema);
    const serialized = JSON.stringify(schema);
    for (const forbidden of ["$schema", "anyOf", "pattern", "minLength", "maxLength", "minItems", "maxItems", "additionalProperties"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain('"nullable":true');
  });
});
