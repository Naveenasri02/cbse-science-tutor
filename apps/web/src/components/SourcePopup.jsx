import { useEffect, useRef } from 'react'
import { palette } from '@cbse/shared'

export default function SourcePopup({ source, onClose }) {
  const popupRef = useRef(null)

  // Click-outside to dismiss
  useEffect(() => {
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target) && !e.target.closest('.citation-chip')) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (!source) return null

  const fullText = source.text || source.snippet || ''
  const snippet = fullText.slice(0, 400)

  return (
    <div
      ref={popupRef}
      className="rounded-xl overflow-hidden animate-slide-up"
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        width: 340,
        maxWidth: 'calc(100% - 16px)',
        background: palette.panel,
        border: `1px solid ${palette.border}`,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
        zIndex: 20,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center px-3 py-1.5"
        style={{ borderBottom: `1px solid ${palette.border}` }}
      >
        <span className="text-[11px] font-semibold truncate" style={{ color: palette.textSecondary }}>
          <span style={{ color: palette.primary, fontWeight: 700 }}>[{source.ref}]</span>
          {' '}
          {source.filename || 'Source'}{source.page ? ` · p.${source.page}` : ''}
        </span>
      </div>

      {/* Snippet */}
      <div className="px-3 py-2" style={{ maxHeight: 120, overflowY: 'auto' }}>
        <p
          className="text-[12px] leading-[1.55] rounded-md px-2.5 py-1.5"
          style={{
            color: palette.textPrimary,
            background: 'rgba(29,155,240,0.08)',
            borderLeft: `2px solid ${palette.primary}`,
            wordBreak: 'break-word',
          }}
        >
          {snippet}{fullText.length > 400 ? '…' : ''}
        </p>
      </div>
    </div>
  )
}
