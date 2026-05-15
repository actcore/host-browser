// Internal helpers + WIT-mapped TS types not exported from jco's gen-types.
// jco-generated types live in src/generated/interfaces/wasi-http-{types,client}.d.ts
// and govern the public shim surface; this file holds private types and
// validation helpers used inside the shim.

import type {
  ErrorCode as GenErrorCode,
} from '../generated/interfaces/wasi-http-types.js';

export type ErrorCode = GenErrorCode;

export function internalError(msg: string): ErrorCode {
  return { tag: 'internal-error', val: msg };
}

// RFC 9110 token: 1*tchar
export const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// RFC 9110 field-value: any VCHAR / OWS / obs-text. We allow tab, printable
// ASCII, and obs-text (0x80-0xFF). No CR/LF.
export const FIELD_VALUE_RE = /^[\t\x20-\x7E\x80-\xFF]*$/;
// Hop-by-hop / connection-management headers a guest cannot set.
export const FORBIDDEN = new Set([
  'connection',
  'keep-alive',
  'host',
]);
