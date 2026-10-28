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
  'knowledge.classificationModel': 'Knowledge classification model',
  'knowledge.modelStatusError': 'Could not load classification model settings.',
  'knowledge.modelCustom': 'Dedicated classification model',
  'knowledge.modelLeader': 'Inherit Marketing Leader model',
  'knowledge.modelPrimary': 'Primary model',
  'knowledge.modelFallback': 'Fallback model',
  'knowledge.modelLastUsed': 'Last model called',
  'knowledge.modelMissing': 'No available classification model is selected.',
  'knowledge.configureModel': 'Open classification model settings',
  'knowledge.loading': 'Loading the knowledge base…',
  'knowledge.subtitle':
    'Upload company knowledge files for AI retrieval with source citations. Manually written Markdown is also supported.',
  'knowledge.finishSetup': 'Open “Settings” to finish configuration before using this screen.',

  'knowledge.documents': 'Documents',
  'knowledge.chunks': 'Chunks',
  'knowledge.chunksHint': 'The smallest retrieval unit',
  'knowledge.embedded': 'Embedded',
  'knowledge.keywordOnly': 'Keyword only',
  'knowledge.processingCount': 'Classifying',
  'knowledge.failedCount': 'Classification failed',
  'knowledge.readyNoVectors': 'Ready, no vectors',
  'knowledge.noSearchableData': 'No searchable data yet',
  'knowledge.noVectorsYet': 'No vectors yet',
  'knowledge.processingNoSearch': 'Classification is in progress; no data is searchable yet.',
  'knowledge.retryBackoff': 'Next retry after {{time}}.',
  'knowledge.retryFailed': 'Retry failed documents',
  'knowledge.retryResult': 'Queued {{queued}}, processing {{processing}}, still failed {{failed}}.',
  'knowledge.reindexClassificationResult': 'Classification: queued {{queued}}, processing {{processing}}, failed {{failed}}.',
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
  'knowledge.empty': 'The knowledge base is empty. Upload company files to begin; no server folder is required.',
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
    'Document saved and processed. AI can retrieve it by keyword; semantic search is available when embeddings exist.',
  'knowledge.saveError': 'Could not save the document.',
  'knowledge.deleteConfirm': 'Delete the document “{{title}}”? This cannot be undone.',
  'knowledge.deleteSuccess': 'Deleted the document “{{title}}”.',
  'knowledge.deleteError': 'Could not delete the document.',
  'knowledge.reindexError': 'Could not run the index.',
  'knowledge.uploadReadonly': 'AI searches and reads extracted file content. The source is read-only; title, category, and tags can be edited.',
  'knowledge.autoClassifyHint': 'AI classifies each knowledge section; no document category selection is needed.',
  'knowledge.processing': 'Processing document…',
  'knowledge.classificationError': 'Could not classify the document.',
  'knowledge.sectionSaveError': 'Could not save section classification.',
  'knowledge.retryClassification': 'Retry classification',
  'knowledge.sections': 'Content sections',
  'knowledge.sectionTags': 'Section tags, separated by commas',
  'knowledge.uploadTags': 'Tags for uploaded files, separated by commas',
  'knowledge.uploadTitle': 'Upload company knowledge files',
  'knowledge.uploadHint': 'PDF, DOCX, TXT, Markdown, or product images (PNG/JPEG/WEBP) · documents up to 10 MiB, images up to 5 MiB, 10 files/batch.',
  'knowledge.imageProductPlaceholder': 'Product name (for image matching)',
  'knowledge.imageBrandPlaceholder': 'Brand (optional)',
  'knowledge.imageDescriptionPlaceholder': 'Image description (optional)',
  'knowledge.imageAnalysisPending': 'Analyzing image…',
  'knowledge.imageAnalysisReady': 'Image analyzed',
  'knowledge.imageAnalysisFailed': 'Image analysis failed',
  'knowledge.imageAnalysisUnavailable': 'Image not analyzed',
  'knowledge.imagesOnly': 'Product images only',
  'knowledge.chooseFiles': 'Choose files',
  'knowledge.dropFiles': 'Drag and drop files here',
  'knowledge.uploadButton': 'Upload',
  'knowledge.clearQueue': 'Clear queue',
  'knowledge.queued': 'Queued',
  'knowledge.uploading': 'Uploading…',
  'knowledge.uploaded': 'Uploaded',
  'knowledge.uploadFailed': 'Upload failed',
  'knowledge.uploadError': 'Could not upload the file.',
  'knowledge.invalidFileType': 'Unsupported file type: {{name}}.',
  'knowledge.fileTooLarge': 'File exceeds 10 MB: {{name}}.',
  'knowledge.queueLimit': 'The queue can contain at most 10 files.',
  'knowledge.loadingContent': 'Loading extracted content…',
  'knowledge.downloadOriginal': 'Download original file',
  'knowledge.detailError': 'Could not load document content.',
  'knowledge.tabDocuments': 'Documents & Articles',
  'knowledge.tabProductImages': 'Product Images ({{n}})',
  'knowledge.activeCompany': 'Current company:',
  'knowledge.switchCompany': 'Switch company',
  'knowledge.productImageUploadTitle': 'Upload Product Images',
  'knowledge.productImageUploadHint':
    'Upload product images for the company so AI can recognize and attach them to marketing content (PNG, JPG, WEBP up to 5 MB/image).',
  'knowledge.imageProductName': 'Product name',
  'knowledge.imageBrandName': 'Brand',
  'knowledge.imageTags': 'Tags',
  'knowledge.imageTagsPlaceholder': 'banner, lookbook, new-arrival...',
  'knowledge.imageDescription': 'Image / product description',
  'knowledge.chooseProductImages': 'Choose product images',
  'knowledge.dropProductImages': 'Drag and drop product images here (PNG, JPG, WEBP up to 5 MB)',
  'knowledge.productImageGalleryTitle': 'Company Product Image Gallery',
  'knowledge.productImageGalleryHint': 'All uploaded product images for the current company.',
  'knowledge.productImagesCount': '{{n}} product images',
  'knowledge.searchProductImagesPlaceholder': 'Search by product name, brand, tag...',
  'knowledge.noProductImages': 'No product images for this company yet. Upload your first product image above!',
  'knowledge.needProductName': 'Please enter a product name before uploading images.',
  'knowledge.uploadNow': 'Upload now',
  'knowledge.previewThumbnails': 'Selected images ready to upload',
  'knowledge.switchToProductImages': 'Need to upload product images? Open Product Images',
} as const
