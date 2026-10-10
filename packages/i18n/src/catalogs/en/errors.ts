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
  'errors.generic.methodNotAllowed': 'Method not allowed.',
  'errors.generic.methodNotAllowedWith': 'Method not allowed. Accepted: {{allowed}}.',
  'errors.generic.invalidLanguage': 'Unsupported language. Supported: {{supported}}.',
  /* ----------------------------------------------------------- auth */
  'errors.auth.invalidCredentials': 'Incorrect email or password.',
  'errors.auth.sessionExpired': 'Your session has expired. Please sign in again.',
  'errors.auth.emailTaken': 'That email is already registered.',
  'errors.auth.weakPassword': 'Password must be at least 10 characters.',
  'errors.auth.emailInvalid': 'That email address is not valid.',

  /* ---------------------------------------------------------- access */
  'errors.access.notMember': 'You are not a member of this company.',
  'errors.access.roleRequired': 'Your role is not allowed to perform this action.',

  /* ---------------------------------------------------------- budget */
  'errors.budget.dailyExceeded': 'Daily cost limit exceeded: used {{used}} of {{limit}} USD.',
  'errors.budget.monthlyExceeded': 'Monthly cost limit exceeded: used {{used}} of {{limit}} USD.',

  /* -------------------------------------------------------- provider */
  'errors.provider.modelMissing': 'No model is configured in the system.',
  'errors.provider.modelDisabled': 'Model {{label}} is disabled.',
  'errors.provider.noModelForAgent': 'This company has no usable LLM model for agent {{role}}.',
  'errors.provider.apiKeyMissing': 'Provider {{name}} has no API key. Add one in Settings.',
  'errors.provider.baseUrlInvalid': 'The base URL for provider {{name}} is not valid.',
  'errors.provider.noToolSupport': 'Model {{label}} does not support tool calling.',

  /* ------------------------------------------------------------ tool */
  'errors.tool.notConfigured': 'Tool {{tool}} is not configured for this company.',
  'errors.tool.notGranted': 'Agent {{role}} has not been granted tool {{tool}}.',
  'errors.tool.hostBlocked': 'Address {{host}} is blocked because it is in a private range.',

  /* -------------------------------------------------- knowledge base */
  'errors.kb.readDenied': 'You do not have permission to read the "{{category}}" knowledge category.',
  'errors.kb.writeDenied': 'You do not have permission to write to "{{category}}". Writable: {{allowed}}.',
} as const
