import { Brand } from 'ts-brand';

// Branded types for time-related concepts
export type Timestamp = Brand<number, 'Timestamp'>;
export type TimeoutMs = Brand<number, 'TimeoutMs'>;

// Helper functions for time types
export function createTimestamp(): Timestamp {
  return Date.now() as Timestamp;
}

export function minutesToMs(minutes: number): TimeoutMs {
  return (minutes * 60 * 1000) as TimeoutMs;
}

export function msToMinutes(ms: number): number {
  return Math.round(ms / (60 * 1000));
}
