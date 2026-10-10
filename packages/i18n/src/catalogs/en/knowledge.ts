/**
 * Namespace `knowledge` cho catalog tiếng Anh.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `knowledge.` để không đụng namespace khác.
 *
 * "Agent" và "Leader" giữ nguyên vì là tên vai trò của sản phẩm.
 *
 * Tham số đếm đặt tên `n` chứ không phải `count`: i18next coi `count` là tín hiệu số
 * ít/số nhiều nên sẽ đi tìm khoá `_one`/`_other` không tồn tại trong catalog phẳng.
 */
export const en_knowledge = {
  'knowledge.loading': 'Loading the knowledge base…',
  'knowledge.subtitle':
    'Write and search source documents for agents. Only embedded documents are found semantically.',
  'knowledge.finishSetup': 'Open “Settings” to finish configuration before using this screen.',

  'knowledge.documents': 'Documents',
  'knowledge.chunks': 'Chunks',
  'knowledge.chunksHint': 'The smallest retrieval unit',
  'knowledge.embedded': 'Embedded',
  'knowledge.keywordOnly': 'Keyword only',
  'knowledge.versionLine': 'v{{version}} · {{time}}',
  'knowledge.embeddedHint': '{{percent}}% of documents are semantically searchable',
  'knowledge.missingEmbeddings':
    '{{n}} documents have NO embedding yet. They are only keyword-searchable and are not semantically ranked — an agent may miss their content. Press “Reindex” to fix this.',

  'knowledge.indexStatus': 'Index status',
  'knowledge.indexStatusHint':
    'Reindexing only reads changed documents. Choose “force” when you suspect old embeddings have drifted.',
  'knowledge.reindex': 'Reindex',
  'knowledge.reindexForce': 'Force reindex',
  'knowledge.reindexResult': 'Indexed {{indexed}} documents, skipped {{skipped}}, created {{chunks}} chunks.',
  'knowledge.reindexErrors': 'Errors: {{errors}}',
  'knowledge.vectorNote':
    'Documents without embeddings are still readable, but search only matches keywords in the title, path, and content.',

  'knowledge.documentsByCategory': 'Document categories',
  'knowledge.matchCount': '{{n}} documents match the filter',
  'knowledge.newDocument': 'New document',
  'knowledge.searchPlaceholder': 'Search by title, path, tag…',
  'knowledge.allCategories': 'All categories',
  'knowledge.empty': 'The knowledge base is empty. Press “New document” to add the first one.',
  'knowledge.noMatch':
    'No documents match the current filter. Try clearing the keyword or choosing “All categories”.',

  'knowledge.editDocument': 'Edit document',
  'knowledge.composeDocument': 'Compose a document',
  'knowledge.pathHint':
    'The path identifies a document; changing it creates a new document instead of renaming.',
  'knowledge.selectOrCreate':
    'Select a document on the left to edit, or press “New document” to write a new one.',
  'knowledge.titlePlaceholder': 'Document title',
  'knowledge.markdownContent': 'Markdown content',
  'knowledge.preview': 'Preview',
  'knowledge.createDocument': 'Create document',
  'knowledge.saveChanges': 'Save changes',
  'knowledge.discardDraft': 'Discard draft',
  'knowledge.sampleContent': '# Title\n\nContent…\n',

  'knowledge.needPathAndTitle': 'Enter the document path and title.',
  'knowledge.saveSuccess':
    'Document saved. New documents have no embedding until you press “Reindex” — until then they are only keyword-searchable.',
  'knowledge.saveError': 'Could not save the document.',
  'knowledge.deleteConfirm': 'Delete the document “{{title}}”? This cannot be undone.',
  'knowledge.deleteSuccess': 'Deleted the document “{{title}}”.',
  'knowledge.deleteError': 'Could not delete the document.',
  'knowledge.reindexError': 'Could not run the index.',
} as const
