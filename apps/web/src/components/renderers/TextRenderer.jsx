import { useState, useEffect, useCallback } from 'react'
import { marked } from 'marked'
import { palette } from '@cbse/shared'
import { ViewerToolbar } from './highlightUtils'

export default function TextRenderer({ fileUrl, filename, onClose }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const isMarkdown = /\.(md|markdown)$/i.test(filename || '')

  // Fetch the text file
  useEffect(() => {
    if (!fileUrl) return
    setLoading(true)
    fetch(fileUrl)
      .then(r => r.text())
      .then(text => { setContent(text); setLoading(false) })
      .catch(() => { setContent('Failed to load file.'); setLoading(false) })
  }, [fileUrl])

  const renderContent = useCallback(() => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-t-transparent" style={{ borderColor: palette.primary, borderTopColor: 'transparent' }} />
        </div>
      )
    }

    if (isMarkdown) {
      return (
        <div
          className="prose prose-invert max-w-none p-4 md:p-6 msg-md"
          dangerouslySetInnerHTML={{ __html: marked.parse(content || '') }}
          style={{ color: palette.textSecondary, fontSize: '13px', lineHeight: '1.7' }}
        />
      )
    }

    // Plain text with line numbers
    const lines = (content || '').split('\n')
    return (
      <div className="p-4 md:p-6 font-mono text-[12px] leading-relaxed" style={{ color: palette.textSecondary }}>
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-white/3">
                <td className="select-none pr-4 text-right align-top w-[1%] whitespace-nowrap" style={{ color: palette.textMuted, opacity: 0.5 }}>
                  {i + 1}
                </td>
                <td className="whitespace-pre-wrap break-all">{line || '\u00A0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }, [content, loading, isMarkdown])

  return (
    <div className={`h-full flex flex-col ${expanded ? 'fixed inset-0 z-50' : ''}`} style={{ background: palette.panel }}>
      <ViewerToolbar filename={filename} onClose={onClose} expanded={expanded} onToggleExpand={() => setExpanded(!expanded)}>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(29,155,240,0.1)', color: palette.primary }}>
          {isMarkdown ? 'Markdown' : 'Text'}
        </span>
      </ViewerToolbar>
      <div className="flex-1 overflow-auto" style={{ background: palette.bg }}>
        {renderContent()}
      </div>
    </div>
  )
}
