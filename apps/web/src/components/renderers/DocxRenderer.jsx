import { useState, useRef, useEffect } from 'react'
import mammoth from 'mammoth'
import { palette } from '@cbse/shared'
import { highlightTextInDOM, clearHighlights, ViewerToolbar } from './highlightUtils'

export default function DocxRenderer({ fileUrl, filename, targetSnippet, targetRequestId, onClose }) {
  const [html, setHtml] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef(null)

  // Fetch and convert DOCX to HTML
  useEffect(() => {
    if (!fileUrl) return
    setLoading(true)
    setError(null)

    fetch(fileUrl)
      .then(r => r.arrayBuffer())
      .then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer }))
      .then(result => {
        setHtml(result.value)
        setLoading(false)
      })
      .catch(err => {
        console.error('DOCX render error:', err)
        setError('Failed to render document.')
        setLoading(false)
      })
  }, [fileUrl])

  // Apply highlighting when snippet changes
  useEffect(() => {
    if (!targetSnippet || !targetRequestId || !contentRef.current) return
    clearHighlights(contentRef.current)
    const timer = setTimeout(() => {
      highlightTextInDOM(contentRef.current, targetSnippet)
    }, 200)
    return () => clearTimeout(timer)
  }, [targetSnippet, targetRequestId, html])

  return (
    <div className={`h-full flex flex-col ${expanded ? 'fixed inset-0 z-50' : ''}`} style={{ background: palette.panel }}>
      <ViewerToolbar filename={filename} onClose={onClose} expanded={expanded} onToggleExpand={() => setExpanded(!expanded)}>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(29,155,240,0.1)', color: palette.primary }}>
          Word
        </span>
      </ViewerToolbar>

      <div className="flex-1 overflow-auto" style={{ background: palette.bg }}>
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-t-transparent" style={{ borderColor: palette.primary, borderTopColor: 'transparent' }} />
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32">
            <p className="text-[13px]" style={{ color: palette.textMuted }}>{error}</p>
          </div>
        )}
        {html && (
          <div
            ref={contentRef}
            className="p-4 md:p-6 max-w-none docx-content"
            dangerouslySetInnerHTML={{ __html: html }}
            style={{
              color: palette.textSecondary,
              fontSize: '13px',
              lineHeight: '1.7',
            }}
          />
        )}
      </div>

      <style>{`
        .docx-content h1, .docx-content h2, .docx-content h3,
        .docx-content h4, .docx-content h5, .docx-content h6 {
          color: ${palette.textPrimary};
          margin: 1em 0 0.5em;
          font-weight: 600;
        }
        .docx-content h1 { font-size: 1.5em; }
        .docx-content h2 { font-size: 1.3em; }
        .docx-content h3 { font-size: 1.15em; }
        .docx-content p { margin: 0.5em 0; }
        .docx-content ul, .docx-content ol { padding-left: 1.5em; margin: 0.5em 0; }
        .docx-content li { margin: 0.25em 0; }
        .docx-content table {
          border-collapse: collapse;
          width: 100%;
          margin: 1em 0;
        }
        .docx-content td, .docx-content th {
          border: 1px solid ${palette.border};
          padding: 6px 10px;
          text-align: left;
          font-size: 12px;
        }
        .docx-content th {
          background: rgba(29,155,240,0.06);
          color: ${palette.textPrimary};
          font-weight: 600;
        }
        .docx-content strong { color: ${palette.textPrimary}; }
        .docx-content a { color: ${palette.primary}; text-decoration: underline; }
        .docx-content img { max-width: 100%; border-radius: 8px; margin: 1em 0; }
      `}</style>
    </div>
  )
}
