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
  'settings.tabs.providers': 'Providers & API keys',
  'settings.tabs.models': 'Models',
  'settings.tabs.routes': 'Model assignments',
  'settings.tabs.knowledge': 'Knowledge classification',
  'settings.tabs.integrations': 'Integrations',
  'settings.tabs.limits': 'Spending limits',
  'settings.subtitle':
    'Declare providers (URL plus multiple API keys), fetch models, choose a primary and fallback model per agent, plus external integrations and cost limits.',
  'settings.needsConfigurationHint': 'Check the provider and the API key on this screen.',

  /* -------------------------------------------------------- providers */
  'settings.providers.title': 'Model providers',
  'settings.providers.subtitle':
    'Each URL is one provider and can have several API keys, used in failover or round-robin mode. Keys are write-only, encrypted by the server and never returned in their original form.',
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
  'settings.providers.keyUsageMode.label': 'Key usage mode',
  'settings.providers.keyUsageMode.failover': 'Failover',
  'settings.providers.keyUsageMode.roundRobin': 'Round robin',
  'settings.providers.keyUsageMode.hint':
    'Failover: prefer the first available key and switch on failure. Round robin: switch to the next key after every 3 model calls; this call count is fixed and cannot be changed.',
  'settings.providers.keyUsageMode.rateLimitNote':
    'The provider may share rate limits across an account or project. Rotating keys does not guarantee avoiding requests-per-minute (RPM) limits.',
  'settings.providers.test': 'Test',
  'settings.providers.testResult': '{{message}} · {{ms}} ms',
  'settings.providers.testModelsSeen': '· saw {{count}} models',
  'settings.providers.add': 'Add provider',
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
  'settings.providers.delete': 'Delete',
  'settings.providers.deleteConfirm':
    'Delete provider "{{name}}"? All of its keys and models will be removed; routes/presets pointing at those models go too.',
  'settings.providers.deleted': 'Provider deleted.',
  'settings.providers.deleteFailed': 'Could not delete the provider.',

  /* --------------------------------------------------------- api key */
  'settings.providers.keys.title': 'API keys ({{count}})',
  'settings.providers.keys.hint':
    'One URL can hold several keys. The provider key usage mode determines failover or round-robin selection; key order determines the selection order.',
  'settings.providers.keys.empty': 'No keys yet. An internal gateway may not need one.',
  'settings.providers.keys.label': 'Label',
  'settings.providers.keys.priority': 'Order',
  'settings.providers.keys.status': 'Status',
  'settings.providers.keys.enabled': 'Enabled',
  'settings.providers.keys.disabled': 'Disabled',
  'settings.providers.keys.addTitle': 'Add API key',
  'settings.providers.keys.labelPlaceholder': 'Label, e.g. Primary key',
  'settings.providers.keys.keyPlaceholder': 'Paste API key',
  'settings.providers.keys.editPlaceholder': 'New key (leave empty to keep the current one)',
  'settings.providers.keys.priorityPlaceholder': 'Use order (lower first)',
  'settings.providers.keys.submit': 'Add key',
  'settings.providers.keys.needLabelAndKey': 'Enter a label and a key value.',
  'settings.providers.keys.created': 'Key added.',
  'settings.providers.keys.updated': 'Key updated.',
  'settings.providers.keys.deleted': 'Key deleted.',
  'settings.providers.keys.saveFailed': 'Could not save the key.',
  'settings.providers.keys.deleteFailed': 'Could not delete the key.',
  'settings.providers.keys.test': 'Test key',
  'settings.providers.keys.cancelEdit': 'Cancel key edit',

  /* ----------------------------------------------------------- models */
  'settings.models.title': 'Models',
  'settings.models.subtitle':
    'Declare each model with its input/output price per million tokens. That price drives cost tracking and the daily cap.',
  'settings.models.emptyNoProvider':
    'No providers yet. Add a provider above before declaring models.',
  'settings.models.empty': 'No models yet. Use "Fetch models" in the provider section, or declare one manually below.',
  'settings.models.table.label': 'Label',
  'settings.models.table.modelId': 'Model ID',
  'settings.models.table.provider': 'Provider',
  'settings.models.table.context': 'Context',
  'settings.models.table.tools': 'Tools',
  'settings.models.table.usage': 'In use',
  'settings.models.table.costIn': 'Input (USD / 1M tokens)',
  'settings.models.table.costOut': 'Output (USD / 1M tokens)',
  'settings.models.pricing.title': 'Update pricing',
  'settings.models.pricing.input': 'Input price (USD / 1 million tokens)',
  'settings.models.pricing.output': 'Output price (USD / 1 million tokens)',
  'settings.models.pricing.save': 'Save prices',
  'settings.models.pricing.reset': 'Clear prices',
  'settings.models.pricing.invalid': 'Enter two finite non-negative prices using a decimal point, e.g. 0.025.',
  'settings.models.pricing.hint': 'Prices apply when new runs load model configuration; historical costs are unchanged. Use a decimal point. A zero price is treated as free.',
  'settings.models.pricing.resetConfirm': 'Set both prices for model "{{name}}" to 0? New runs using these prices will be charged 0 USD in tracking, potentially below actual costs. The model and historical costs will not be deleted.',
  'settings.models.usageCount': '{{count}} agents',
  'settings.models.delete': 'Delete',
  'settings.models.deleteConfirm': 'Delete model "{{label}}"?',
  'settings.models.deleted': 'Model deleted.',
  'settings.models.deleteFailed': 'Could not delete the model. Remove it from agents/routes first.',
  'settings.models.purge': 'Delete unused models',
  'settings.models.purgeConfirm': 'Delete every model of "{{name}}" that no agent uses?',
  'settings.models.purged': 'Deleted {{count}} unused models.',
  'settings.models.purgeFailed': 'Could not delete unused models.',
  // Label of the BUTTON that opens the dialog, kept apart from `form.title` (the dialog
  // heading) for the same reason `settings.providers.add` is apart from
  // `settings.providers.form.createTitle`: one is an action, the other is a heading.
  'settings.models.add': 'Add model',
  'settings.models.form.title': 'Add model',
  'settings.models.form.modelIdPlaceholder': 'Model ID, e.g. deepseek-v4-flash',
  'settings.models.form.labelPlaceholder': 'Display label',
  'settings.models.form.contextPlaceholder': 'Context window (tokens)',
  'settings.models.form.costInPlaceholder': 'Input price per million tokens (USD)',
  'settings.models.form.costOutPlaceholder': 'Output price per million tokens (USD)',
  'settings.models.form.supportsTools': 'Model supports tool calls',
  'settings.models.vision': 'Supports images',
  'settings.models.visionLabel': '{{model}} supports images',
  'settings.models.visionNote': 'Enable only when the model and provider support image input (vision). Choose this model or add it as a Leader fallback to analyze images in chat.',
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
    'No routes yet. Agents only run once you pick a model in the Team screen; tier routes are an optional extra.',
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
  'settings.integrations.add': 'Add integration',
  'settings.integrations.empty':
    'No integrations yet. Press "Add integration" to configure a service for your agents.',
  'settings.integrations.table.kind': 'Kind',
  'settings.integrations.table.name': 'Name',
  'settings.integrations.table.status': 'Status',
  'settings.integrations.table.config': 'Configuration',
  'settings.integrations.table.lastCheck': 'Last check',
  'settings.integrations.configured': 'Configured',
  'settings.integrations.missingConfig': 'Missing configuration',
  'settings.integrations.test': 'Check configuration',
  'settings.integrations.simpleHint': 'Connect an account in a few clicks. Credentials are encrypted and never shown here.',
  'settings.integrations.connect': 'Connect account',
  'settings.integrations.resources': 'Choose resources',
  'settings.integrations.deleteConfirm': 'Remove the connection “{{name}}”?',
  'settings.integrations.smtp.required': 'Enter SMTP host, username, password and sender address.',
  'settings.integrations.oauth.appName': 'App name (optional)',
  'settings.integrations.oauth.clientId': 'OAuth client ID',
  'settings.integrations.oauth.clientSecret': 'OAuth client secret',
  'settings.integrations.oauth.hint': 'Leave client ID and secret blank when the server already has a shared OAuth app configured.',
  'settings.integrations.testNote': 'Configuration checks only validate saved fields and decryption, not the API key with the provider.',
  'settings.integrations.firecrawl.apiKey': 'Firecrawl API key',
  'settings.integrations.firecrawl.nameOptional': 'Connection name (optional)',
  'settings.integrations.firecrawl.keyNote': 'Firecrawl cloud only needs an API key. The key is encrypted and never shown again after saving.',
  'settings.integrations.firecrawl.updateNote': 'Leave the name blank to use “Firecrawl”. To update an existing connection, enter its exact name and a new key.',
  'settings.integrations.firecrawl.advanced': 'Advanced',
  'settings.integrations.firecrawl.baseUrl': 'Custom Firecrawl URL (optional)',
  'settings.integrations.firecrawl.urlNote': 'Leave blank for Firecrawl cloud. Enter the root URL of your self-host/proxy, without /v1, credentials, query or fragment.',
  'settings.integrations.firecrawl.needKey': 'Enter a Firecrawl API key.',
  'settings.integrations.firecrawl.invalidUrl': 'The API key is too long or the custom URL is invalid. Use HTTP/HTTPS without credentials, query or fragment.',
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
  /** Naming the company matters: switching company is easy to miss, and the wrong cap
   *  silently blocks (or unblocks) spending for a different company. */
  'settings.limits.companyScope':
    'These limits apply only to "{{company}}". Switching to another company switches the limits as well.',
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

  /* -------------------------------- fetch-model dialog (Models section) */
  // One set of keys for fetching models. The older `settings.providers.fetch.*` set was
  // deleted together with the fetch block that used to live inside a provider key table.
  'settings.models.fetch.open': 'Fetch the model list',
  'settings.models.fetch.title': 'Fetch the model list from the provider',
  'settings.models.fetch.hint':
    'Calls /models with the chosen key to show which models the provider offers. Nothing is saved until you pick.',
  'settings.models.fetch.providerLabel': 'Provider',
  'settings.models.fetch.keyLabel': 'Use key',
  'settings.models.fetch.keyAuto': 'Use the first available key automatically',
  'settings.models.fetch.keyHint':
    'Leave this empty and the server uses the first available key of the provider.',
  'settings.models.fetch.action': 'Fetch list',
  'settings.models.fetch.result': '{{message}} · {{ms}} ms',
  'settings.models.fetch.failed': 'Could not fetch the model list.',
  'settings.models.fetch.searchPlaceholder': 'Search by model ID or name…',
  'settings.models.fetch.onlyNew': 'Only show models not added yet',
  'settings.models.fetch.selectVisible': 'Select all shown',
  'settings.models.fetch.clearVisible': 'Clear all shown',
  'settings.models.fetch.showing': 'Showing {{hien}}/{{tong}} models',
  'settings.models.fetch.alreadyAdded': 'Added',
  'settings.models.fetch.noMatch': 'No models match the current filter.',
  'settings.models.fetch.noProviders': 'No providers yet. Add a provider in the Providers section first.',
  'settings.models.fetch.selectedCount': '{{n}} models selected',
  'settings.models.fetch.import': 'Add {{n}} models',
  'settings.models.fetch.imported': 'Added {{created}} models, skipped {{skipped}} already present.',
  'settings.models.fetch.importFailed': 'Could not add the selected models.',
  'settings.models.deleteTitle': 'Delete model',
  'settings.models.purgeTitle': 'Delete unused models',

  /* ----------------------------------- knowledge classification */
  'settings.knowledgeModel.title': 'Knowledge classification model',
  'settings.knowledgeModel.subtitle': 'Choose the model used to classify company documents and its fallback models.',
  'settings.knowledgeModel.mode': 'Model selection',
  'settings.knowledgeModel.modeLeader': 'Follow team leader model',
  'settings.knowledgeModel.modeCustom': 'Choose models manually',
  'settings.knowledgeModel.primary': 'Primary model',
  'settings.knowledgeModel.fallback': 'Fallback model {{number}}',
  'settings.knowledgeModel.addFallback': 'Add fallback model',
  'settings.knowledgeModel.chooseModel': '— Choose a model —',
  'settings.knowledgeModel.costWarning': 'Testing sends a tiny synthetic request to the model and may incur a cost. No document content is sent.',
  'settings.knowledgeModel.save': 'Save settings',
  'settings.knowledgeModel.test': 'Test saved settings',
  'settings.knowledgeModel.saved': 'Classification model settings saved.',
  'settings.knowledgeModel.loadFailed': 'Could not load classification model settings.',
  'settings.knowledgeModel.saveFailed': 'Could not save classification model settings.',
  'settings.knowledgeModel.testFailed': 'Could not test classification model settings.',
} as const
