import { useState, useRef, useEffect } from 'react'
import { palette } from '@cbse/shared'
import { clearHighlights, highlightWithRetry, ViewerToolbar } from './highlightUtils'

/**
 * Fallback renderer for formats without dedicated viewers (PPTX, DOC, etc.).
 * Displays the chunked text extracted by the backend with citation highlighting.
 */
export default function FallbackRenderer({ fileUrl, filename, targetSnippet, targetFallbackSnippet, targetRequestId, onClose, chunks }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef(null)
  const genRef = useRef(0)

  const ext = (filename || '').split('.').pop()?.toLowerCase() || '?'
  const typeLabel = { pptx: 'PowerPoint', doc: 'Word (Legacy)', ppt: 'PowerPoint' }[ext] || ext.toUpperCase()

  // Try to fetch as text; if binary, show message
  useEffect(() => {
    if (!fileUrl) { setLoading(false); return }
    setLoading(true)
    fetch(fileUrl)
      .then(r => {
        const ct = r.headers.get('content-type') || ''
        if (ct.includes('text') || ct.includes('json')) return r.text()
        return null
      })
      .then(text => { setContent(text); setLoading(false) })
      .catch(() => { setContent(null); setLoading(false) })
  }, [fileUrl])

  // Highlighting with retry mechanism (mirrors PdfRenderer)
  useEffect(() => {
    if (!targetSnippet || !targetRequestId || !contentRef.current) return
    clearHighlights(contentRef.current)
    const cleanup = highlightWithRetry(contentRef.current, targetSnippet, targetFallbackSnippet, targetRequestId, genRef)
    return cleanup
  }, [targetSnippet, targetFallbackSnippet, targetRequestId, content])

  return (
    <div className={`h-full flex flex-col ${expanded ? 'fixed inset-0 z-50' : ''}`} style={{ background: palette.panel }}>
      <ViewerToolbar filename={filename} onClose={onClose} expanded={expanded} onToggleExpand={() => setExpanded(!expanded)}>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(29,155,240,0.1)', color: palette.primary }}>
          {typeLabel}
        </span>
      </ViewerToolbar>

      <div className="flex-1 overflow-auto" style={{ background: palette.bg }}>
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-t-transparent" style={{ borderColor: palette.primary, borderTopColor: 'transparent' }} />
          </div>
        )}
        {!loading && (
          <div ref={contentRef} className="p-4 md:p-6">
            {/* Info banner */}
            <div className="rounded-xl border p-3 mb-4" style={{ borderColor: 'rgba(29,155,240,0.2)', background: 'rgba(29,155,240,0.04)' }}>
              <p className="text-[12px]" style={{ color: palette.textMuted }}>
                📄 <strong style={{ color: palette.textPrimary }}>{filename}</strong> has been analyzed.
                {content ? ' Showing file contents below.' : ' Rich preview is not available for this format, but you can ask questions about it.'}
              </p>
            </div>

            {/* Content — either raw text or "analyzed" message */}
            {content && (
              <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed font-mono" style={{ color: palette.textSecondary }}>
                {content}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
