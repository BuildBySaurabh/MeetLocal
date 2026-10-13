// Runtime validation lives in @meetlocal/shared so the client and server agree on the
// protocol. This module re-exports it as the server's single validation entry point.
export { parseClientMessage } from '@meetlocal/shared';
export type { ParseResult } from '@meetlocal/shared';
