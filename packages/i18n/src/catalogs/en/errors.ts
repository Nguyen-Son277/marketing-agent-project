/**
 * Namespace `errors` — API error messages.
 *
 * Kept apart from the interface strings because these are produced in the backend
 * (which knows nothing about React) and rendered in the interface, so both sides must
 * resolve the same keys. Splitting it out makes that contract visible.
 */
export const en_errors = {
  /* -------------------------------------------------------- generic */
  'errors.generic.internal': 'System error. Please try again.',
  'errors.generic.validation': 'The submitted data is not valid.',
  'errors.generic.notFound': 'The requested resource was not found.',
  'errors.generic.forbidden': 'You do not have permission to do this.',
  'errors.generic.unauthorized': 'Your session has expired. Please sign in again.',
  'errors.generic.conflict': 'The action conflicts with the current state.',
  'errors.generic.rateLimited': 'Too many requests. Please try again later.',
  'errors.generic.badJson': 'The request body is not valid JSON.',
  'errors.generic.bodyTooLarge': 'The request body is too large.',
  'errors.generic.endpointNotFound': 'This endpoint does not exist.',
  'errors.generic.cannotConnectServer': 'Could not reach the server.',
} as const
