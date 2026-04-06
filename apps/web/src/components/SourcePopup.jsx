import { useEffect, useRef } from 'react'
import { palette } from '@cbse/shared'

export default function SourcePopup({ source, onClose }) {
  const popupRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Click-outside to dismiss + forward clicks to citation chips hidden beneath popup
  useEffect(() => {
    const handler = (e) => {
      if (!popupRef.current) return

      if (popupRef.current.contains(e.target)) {
        // Click landed on the popup — check if a citation chip is underneath
        popupRef.current.style.visibility = 'hidden'
        const underneath = document.elementFromPoint(e.clientX, e.clientY)
        popupRef.current.style.visibility = ''

        const chip = underneath?.closest('.citation-chip[data-ref]')
        if (chip) {
          e.preventDefault()
          e.stopImmediatePropagation()
          chip.click() // forward to the citation handler
        }
        return
      }

      // Click outside popup — dismiss unless it's a citation chip
      if (!e.target.closest('.citation-chip')) {
        onCloseRef.current()
      }
    }
    document.addEventListener('mousedown', handler, true) // capture phase
    return () => document.removeEventListener('mousedown', handler, true)
  }, [])

  if (!source) return null

  const fullText = source.text || source.snippet || ''
  const snippet = fullText.slice(0, 400)
  const contextText = source.contextText || ''

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

      {/* Referenced text from bot response */}
      {contextText && (
        <div className="px-3 pt-2 pb-1">
          <p
            className="text-[11px] leading-[1.5] rounded-md px-2.5 py-1.5"
            style={{
              color: palette.textPrimary,
              background: 'rgba(29,155,240,0.15)',
              borderLeft: `2px solid ${palette.primary}`,
              fontStyle: 'italic',
              wordBreak: 'break-word',
            }}
          >
            {contextText.length > 200 ? contextText.slice(0, 200) + '…' : contextText}
          </p>
        </div>
      )}

      {/* Source chunk text */}
      <div className="px-3 py-2" style={{ maxHeight: 120, overflowY: 'auto' }}>
        <p className="text-[10px] font-medium mb-1" style={{ color: palette.textMuted }}>Source chunk:</p>
        <p
          className="text-[12px] leading-[1.55] rounded-md px-2.5 py-1.5"
          style={{
            color: palette.textPrimary,
            background: 'rgba(29,155,240,0.08)',
            borderLeft: `2px solid ${palette.border}`,
            wordBreak: 'break-word',
          }}
        >
          {snippet}{fullText.length > 400 ? '…' : ''}
        </p>
      </div>
    </div>
  )
}
