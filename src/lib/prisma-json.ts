import { Argument, Speaker, Topic, Quote, ReferenceLink } from '@/types/analysis';

// Validated, typed helpers for Prisma Json fields
// Use these AFTER Zod validation to avoid `as unknown as never`

export function toPrismaJson<T>(validated: T): unknown {
  return validated as unknown;
}

export function fromPrismaJsonArguments(value: unknown): Argument[] {
  if (!value || typeof value !== 'object') return [];
  return (value as unknown as { arguments?: Argument[] }).arguments ?? (value as Argument[]);
}

export function fromPrismaJsonSpeakers(value: unknown): Speaker[] {
  if (!value || typeof value !== 'object') return [];
  return (value as unknown as { speakers?: Speaker[] }).speakers ?? (value as Speaker[]);
}

export function fromPrismaJsonTopics(value: unknown): Topic[] {
  if (!value || typeof value !== 'object') return [];
  return (value as unknown as { topics?: Topic[] }).topics ?? (value as Topic[]);
}

export function fromPrismaJsonQuotes(value: unknown): Quote[] {
  if (!value || typeof value !== 'object') return [];
  return (value as unknown as { quotes?: Quote[] }).quotes ?? (value as Quote[]);
}

export function fromPrismaJsonTranscript(value: unknown): Array<{ start: number; end: number; text: string; speakerId?: string }> | null {
  if (!value) return null;
  if (Array.isArray(value)) return value as Array<{ start: number; end: number; text: string; speakerId?: string }>;
  return null;
}
