import { zodResolver as createZodResolver } from '@hookform/resolvers/zod';
import type { FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/**
 * Preserves the resolver contract used before @hookform/resolvers v5.
 *
 * Zod's defaults make the schema input wider than its parsed output. Existing
 * forms intentionally expose the parsed output to react-hook-form, so the
 * v5 input/output split would otherwise require a noisy migration in every
 * form without changing runtime validation.
 */
export function zodResolver<TFieldValues extends FieldValues>(
  schema: z.ZodType<TFieldValues, z.ZodTypeDef, unknown>,
): Resolver<TFieldValues> {
  return createZodResolver(schema as never) as Resolver<TFieldValues>;
}
