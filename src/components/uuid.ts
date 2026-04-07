import { Brand } from 'ts-brand';
import { v4 as uuidv4 } from 'uuid';

// Branded type for UUID
export type UUID = Brand<string, 'UUID'>;

// Function to generate a new UUID
export function generateUUID(): UUID {
  return uuidv4() as UUID;
}

// Function to validate if a string is a valid UUID
export function isValidUUID(value: string): value is UUID {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}
