import PdfRenderer from './renderers/PdfRenderer'
import TextRenderer from './renderers/TextRenderer'
import DocxRenderer from './renderers/DocxRenderer'
import SpreadsheetRenderer from './renderers/SpreadsheetRenderer'
import ImageRenderer from './renderers/ImageRenderer'
import FallbackRenderer from './renderers/FallbackRenderer'

/**
 * Unified document viewer — detects file type and delegates to the appropriate renderer.
 * All renderers support citation highlighting where applicable.
 */

const PDF_TYPES = new Set(['application/pdf'])
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'])

function getRendererType(filename, fileType) {
  const ext = (filename || '').split('.').pop()?.toLowerCase() || ''

  // PDF
  if (PDF_TYPES.has(fileType) || ext === 'pdf') return 'pdf'

  // Images
  if (IMAGE_TYPES.has(fileType) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif'].includes(ext)) return 'image'

  // DOCX (mammoth supports .docx only, not .doc)
  if (ext === 'docx') return 'docx'

  // Spreadsheets
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet'

  // Text / Markdown
  if (['txt', 'md', 'markdown', 'log', 'json', 'xml', 'yaml', 'yml'].includes(ext)) return 'text'
  if (fileType?.startsWith('text/')) return 'text'

  // Everything else — fallback (pptx, doc, etc.)
  return 'fallback'
}

// File extensions that support preview
export const PREVIEWABLE_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv',
  'txt', 'md', 'markdown', 'log', 'json', 'xml', 'yaml', 'yml',
  'pptx', 'ppt',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif',
])

export function isPreviewable(filename, fileType) {
  if (PDF_TYPES.has(fileType) || IMAGE_TYPES.has(fileType)) return true
  const ext = (filename || '').split('.').pop()?.toLowerCase() || ''
  return PREVIEWABLE_EXTENSIONS.has(ext)
}

export default function DocViewer({
  fileUrl, fileType, filename,
  targetPage, targetPageEnd, targetSnippet, targetFallbackSnippet, targetRequestId,
  onClose
}) {
  if (!fileUrl) return null

  const rendererType = getRendererType(filename, fileType)

  switch (rendererType) {
    case 'pdf':
      return (
        <PdfRenderer
          fileUrl={fileUrl}
          filename={filename}
          targetPage={targetPage}
          targetPageEnd={targetPageEnd}
          targetSnippet={targetSnippet}
          targetFallbackSnippet={targetFallbackSnippet}
          targetRequestId={targetRequestId}
          onClose={onClose}
        />
      )
    case 'docx':
      return (
        <DocxRenderer
          fileUrl={fileUrl}
          filename={filename}
          onClose={onClose}
        />
      )
    case 'spreadsheet':
      return (
        <SpreadsheetRenderer
          fileUrl={fileUrl}
          filename={filename}
          onClose={onClose}
        />
      )
    case 'text':
      return (
        <TextRenderer
          fileUrl={fileUrl}
          filename={filename}
          onClose={onClose}
        />
      )
    case 'image':
      return (
        <ImageRenderer
          fileUrl={fileUrl}
          filename={filename}
          onClose={onClose}
        />
      )
    default:
      return (
        <FallbackRenderer
          fileUrl={fileUrl}
          filename={filename}
          onClose={onClose}
        />
      )
  }
}
