/**
 * Namespace `settings` cho catalog tiếng Anh.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `settings.` để không đụng namespace khác.
 *
 * Vài câu dùng chung với màn Bảng điều khiển (`dashboard.*`) nằm ở `en.ts` vì đó là
 * nguồn sự thật của catalog; file này chỉ chứa khoá riêng của màn Cài đặt.
 */
export const en_settings = {
  /* ----------------------------------------------------------- page */
  'settings.title': 'Settings',
  'settings.subtitle':
    'Declare the providers, models, tier routes, external integrations and cost limits the team runs on.',
  'settings.needsConfigurationHint': 'Check the provider and the API key on this screen.',

  /* -------------------------------------------------------- providers */
  'settings.providers.title': 'Model providers',
  'settings.providers.subtitle':
    'Where agents send requests. The API key is write-only: sent once, encrypted by the server, and never returned in its original form.',
  'settings.providers.empty':
    'No providers yet. Add an OpenAI-compatible provider so agents can call models.',
  'settings.providers.table.name': 'Name',
  'settings.providers.table.kind': 'Kind',
  'settings.providers.table.baseUrl': 'Base URL',
  'settings.providers.table.apiKey': 'API key',
  'settings.providers.table.models': 'Models',
  'settings.providers.table.status': 'Status',
  'settings.providers.global': 'Shared system-wide',
  'settings.providers.keyConfigured': 'Configured',
  'settings.providers.keyHint': 'Hint: {{hint}}',
  'settings.providers.keyMissing': 'No key',
  'settings.providers.enabled': 'Enabled',
  'settings.providers.disabled': 'Disabled',
  'settings.providers.test': 'Test',
  'settings.providers.testResult': '{{message}} · {{ms}} ms',
  'settings.providers.testModelsSeen': '· saw {{count}} models',
  'settings.providers.form.editTitle': 'Edit provider',
  'settings.providers.form.createTitle': 'Add provider',
  'settings.providers.form.namePlaceholder': 'Name, e.g. Internal gateway',
  'settings.providers.form.baseUrlPlaceholder': 'http://localhost:20128/v1',
  'settings.providers.form.apiKeyPlaceholderKeep': 'Leave empty to keep the old key',
  'settings.providers.form.apiKeyPlaceholder': 'Paste API key',
  'settings.providers.form.enable': 'Enable this provider',
  'settings.providers.form.keyNote':
    'A stored key is never shown again in any form. To change it, paste a new key; leaving the field empty keeps the old one.',
  'settings.providers.form.submitEdit': 'Save changes',
  'settings.providers.form.submitCreate': 'Add provider',
  'settings.providers.form.cancelEdit': 'Cancel edit',
  'settings.providers.needNameAndBaseUrl': 'Enter a provider name and a base URL.',
  'settings.providers.updated': 'Provider updated.',
  'settings.providers.created': 'Provider added.',
  'settings.providers.saveFailed': 'Could not save the provider.',
  'settings.providers.testFailed': 'Could not test the connection.',

  /* ----------------------------------------------------------- models */
  'settings.models.title': 'Models',
  'settings.models.subtitle':
    'Declare each model with its input/output price per million tokens. That price drives cost tracking and the daily cap.',
  'settings.models.emptyNoProvider':
    'No providers yet. Add a provider above before declaring models.',
  'settings.models.empty': 'No models yet. Declare the first one with the form below.',
  'settings.models.table.label': 'Label',
  'settings.models.table.modelId': 'Model ID',
  'settings.models.table.provider': 'Provider',
  'settings.models.table.context': 'Context',
  'settings.models.table.tools': 'Tools',
  'settings.models.table.costIn': 'Input / 1M',
  'settings.models.table.costOut': 'Output / 1M',
  'settings.models.form.title': 'Add model',
  'settings.models.form.modelIdPlaceholder': 'Model ID, e.g. deepseek-v4-flash',
  'settings.models.form.labelPlaceholder': 'Display label',
  'settings.models.form.contextPlaceholder': 'Context window (tokens)',
  'settings.models.form.costInPlaceholder': 'Input price per million tokens (USD)',
  'settings.models.form.costOutPlaceholder': 'Output price per million tokens (USD)',
  'settings.models.form.supportsTools': 'Model supports tool calls',
  'settings.models.form.toolsNote':
    'A model without tool support is routed to another model of the same tier, so mark this accurately.',
  'settings.models.form.submit': 'Add model',
  'settings.models.needFields': 'Choose a provider and enter the model ID and display label.',
  'settings.models.created': 'Model added.',
  'settings.models.saveFailed': 'Could not save the model.',

  /* --------------------------------------------------- tier routing */
  'settings.routes.title': 'Routes by tier',
  'settings.routes.subtitle':
    'When an agent has no pinned model, the router picks one per (agent, tier) pair. This is the fallback when the chosen model lacks capability.',
  'settings.routes.empty':
    'No routes yet. Agents use the cheapest enabled model when neither a route nor a pinned model exists.',
  'settings.routes.table.agent': 'Agent',
  'settings.routes.table.role': 'Role',
  'settings.routes.table.tier': 'Tier',
  'settings.routes.table.model': 'Model',
  'settings.routes.table.priority': 'Priority',
  'settings.routes.modelOption': '{{label}} · {{provider}}',
  'settings.routes.form.title': 'Assign route',
  'settings.routes.form.submit': 'Save route',
  'settings.routes.needAgentAndModel': 'Choose an agent and a model.',
  'settings.routes.assigned': 'Model assigned to the {{tier}} tier.',
  'settings.routes.saveFailed': 'Could not save the route.',

  /* ---------------------------------------------------- integrations */
  'settings.integrations.title': 'External integrations',
  'settings.integrations.subtitle':
    'Configure how agents read channel data and create drafts. Configuration is write-only and never displayed again after saving.',
  'settings.integrations.empty':
    'No integrations yet. Add one below when agents need to reach outside.',
  'settings.integrations.table.kind': 'Kind',
  'settings.integrations.table.name': 'Name',
  'settings.integrations.table.status': 'Status',
  'settings.integrations.table.config': 'Configuration',
  'settings.integrations.table.lastCheck': 'Last check',
  'settings.integrations.configured': 'Configured',
  'settings.integrations.missingConfig': 'Missing configuration',
  'settings.integrations.test': 'Test',
  'settings.integrations.testResult': '{{message}} · {{status}} · {{ms}} ms',
  'settings.integrations.form.title': 'Add / update integration',
  'settings.integrations.form.namePlaceholder': 'A name you recognise, e.g. Main Firecrawl',
  'settings.integrations.form.configLabel': 'Configuration (JSON)',
  'settings.integrations.form.configPlaceholder': '{\n  "apiKey": "…"\n}',
  'settings.integrations.form.configNote':
    'Secret values inside this JSON are encrypted before saving and never returned to the interface.',
  'settings.integrations.form.submit': 'Save integration',
  'settings.integrations.needName': 'Enter an integration name.',
  'settings.integrations.configMustBeObject':
    'The configuration must be a JSON object, e.g. {"apiKey": "..."}.',
  'settings.integrations.configInvalidJson': 'The configuration is not valid JSON.',
  'settings.integrations.saved':
    'Integration saved. Secrets in the configuration are encrypted and not shown again.',
  'settings.integrations.saveFailed': 'Could not save the integration.',
  'settings.integrations.testFailed': 'Could not test the connection.',

  'settings.integrationKind.firecrawl': 'Firecrawl (web crawl)',
  'settings.integrationKind.googleSearchConsole': 'Google Search Console',
  'settings.integrationKind.googleAnalytics': 'Google Analytics',
  'settings.integrationKind.googleSheets': 'Google Sheets',
  'settings.integrationKind.meta': 'Meta (Facebook / Instagram)',
  'settings.integrationKind.linkedin': 'LinkedIn',
  'settings.integrationKind.googleAds': 'Google Ads',
  'settings.integrationKind.emailSmtp': 'Email SMTP',

  /* ----------------------------------------------------------- limits */
  'settings.limits.title': 'Limits',
  'settings.limits.subtitle':
    'Cost caps and loop counts. Exceeding a cap stops the run instead of continuing to spend.',
  'settings.limits.used24hPrefix': 'Used in the last 24 hours:',
  'settings.limits.limitPrefix': '/ cap',
  'settings.limits.noCap': 'No cap set',
  'settings.limits.dailyCost': 'Daily cost cap (USD)',
  'settings.limits.taskCost': 'Cost cap per task (USD)',
  'settings.limits.maxSteps': 'Maximum steps per run',
  'settings.limits.maxPeerRounds': 'Agent-to-agent exchange rounds',
  'settings.limits.maxRevisions': 'Maximum revisions per task',
  'settings.limits.maxParallel': 'Tasks running in parallel',
  'settings.limits.submit': 'Save limits',
  'settings.limits.saved': 'Limits saved.',
  'settings.limits.saveFailed': 'Could not save the limits.',
} as const
