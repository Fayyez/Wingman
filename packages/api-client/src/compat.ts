import type { SuggestRequestDraft } from '@wingman/core';
import type { SuggestRequest } from './index';

/**
 * Type-level contract check: the request the client builds (packages/core) must be a valid
 * API request per the generated OpenAPI types. Breaks the build on drift.
 */
export const _check = (d: SuggestRequestDraft): SuggestRequest => d;
