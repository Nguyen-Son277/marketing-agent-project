/**
 * Namespace `companies` — the "My companies" screen.
 *
 * Kept separate from `company.*` (the first-run chooser): that one has a single job, create
 * the first company. This one manages the list afterwards. Merging them would mean reading
 * two different contexts every time the wording changes.
 */
export const en_companies = {
  /* ----------------------------------------------------------- title */
  'companies.title': 'My companies',
  'companies.subtitle':
    'One account can belong to several companies. Each company has its own knowledge base, agent team, budget, and work history — switching company switches the whole working context.',

  /* ------------------------------------------------------------ list */
  'companies.yours': 'Your companies',
  'companies.loading': 'Loading companies…',
  'companies.empty': 'This account does not belong to any company yet. Create the first one below.',
  'companies.current': 'In use',
  'companies.switch': 'Switch to this company',
  'companies.roleLabel': 'Role: {{role}}',
  'companies.pathLabel': 'Path',
  'companies.memberCount': '{{count}} members',

  /* ---------------------------------------------------------- create */
  'companies.createTitle': 'Create a company',
  'companies.createHint':
    'Every new company gets the full team of 10 agents and knowledge permissions for all six categories. You are switched to it right after creation.',
  'companies.name': 'Company name',
  'companies.namePlaceholder': 'Acme Retail Ltd',
  'companies.create': 'Create company',
  'companies.needName': 'Enter a company name.',
  'companies.creating': 'Creating company…',
  'companies.created': 'Company created and switched to it.',

  /* ---------------------------------------------------------- rename */
  'companies.rename': 'Rename',
  'companies.renameTitle': 'Rename company',
  'companies.renameSave': 'Save new name',
  'companies.renameCancel': 'Cancel',
  'companies.renamed': 'Company renamed.',
  'companies.renaming': 'Saving…',
  /**
   * Worth stating up front: it is easy to assume renaming changes the path too. The slug is
   * the knowledge base directory on disk and the lookup key for indexed documents, so it is
   * deliberately frozen. Without this note it becomes a guaranteed source of confusion.
   */
  'companies.renameSlugNote':
    'The display name changes; the path ({{slug}}) stays as it is — changing it would break the link to documents already indexed in the knowledge base.',
  'companies.renameNotAllowed': 'Only the company owner or an admin can rename it.',

  /* --------------------------------------------------------- errors */
  'companies.errorLoad': 'Could not load the company list.',
  'companies.errorCreate': 'Could not create the company.',
  'companies.errorRename': 'Could not rename the company.',

  /* ------------------------------------------------------ navigation */
  'nav.companies': 'My companies',
} as const
