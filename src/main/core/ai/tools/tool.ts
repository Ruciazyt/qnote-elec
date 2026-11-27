import { z } from "zod";

export interface ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: TSchema;
  func: (input: any) => unknown | Promise<unknown>;
  invoke: (input: unknown) => Promise<unknown>;
}

export function tool<TSchema extends z.ZodTypeAny>(
  func: (input: z.infer<TSchema>) => unknown | Promise<unknown>,
  config: {
    name: string;
    description: string;
    schema: TSchema;
  }
): ToolDefinition<TSchema> {
  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    func: func as (input: any) => unknown | Promise<unknown>,
    invoke: async (input: unknown) => {
      const parsed = config.schema.parse(input ?? {});
      return func(parsed);
    },
  };
}