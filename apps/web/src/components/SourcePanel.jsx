import { useRef, useEffect } from 'react'
import { palette } from '@cbse/shared'
import { FileText, X } from 'lucide-react'

export default function SourcePanel({ sources, activeRef, onTabClick, onClose }) {
  const textRef = useRef(null)

  const active = sources?.find(s => s.ref === activeRef) || sources?.[0]

  useEffect(() => {
    if (textRef.current) textRef.current.scrollTop = 0
  }, [activeRef])

  if (!sources || sources.length === 0) return null

  return (
    <div
      className="flex flex-col h-full animate-slide-in-right"
      style={{ background: palette.bg, borderLeft: `1px solid ${palette.border}` }}
    >
      {/* Header: filename */}
      <div
        className="flex items-center justify-between gap-2 px-3.5 py-2.5 shrink-0"
        style={{ borderBottom: `1px solid ${palette.border}` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} style={{ color: palette.primary }} className="shrink-0" />
          <span className="text-[13px] font-medium truncate" style={{ color: palette.textPrimary }}>
            {active?.filename || 'Document'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:bg-white/5"
          style={{ color: palette.textMuted }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Source guide label */}
      <div
        className="flex items-center justify-between mx-3 my-2 px-3 py-2 rounded-lg text-[12px] cursor-default"
        style={{ background: palette.panel, border: `1px solid ${palette.border}`, color: palette.textMuted }}
      >
        <span>⚙ Source guide</span>
      </div>

      {/* Tabs [1] [2] [3] */}
      <div
        className="flex gap-1.5 px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${palette.border}` }}
      >
        {sources.map(s => (
          <button
            key={s.ref}
            onClick={() => onTabClick(s.ref)}
            className="w-9 h-8 flex items-center justify-center rounded-lg text-[12px] font-bold transition-all"
            style={{
              background: s.ref === activeRef ? 'rgba(29,155,240,0.15)' : palette.panel,
              border: `1px solid ${s.ref === activeRef ? 'rgba(29,155,240,0.4)' : palette.border}`,
              color: s.ref === activeRef ? palette.primary : palette.textMuted,
            }}
          >
            {s.ref}
          </button>
        ))}
      </div>

      {/* Active source header */}
      {active && (
        <>
          <div className="px-3.5 pt-3 pb-1">
            <div className="text-[22px] font-bold" style={{ color: palette.textPrimary }}>
              {active.ref}
            </div>
            <div className="text-[11px] mt-1" style={{ color: palette.textMuted }}>
              p.{active.page || '?'}{active.section ? ` — Section: ${active.section}` : ''}
            </div>
          </div>
          <div className="mx-3.5 my-2" style={{ height: 1, background: palette.border }} />
        </>
      )}

      {/* Full chunk text (scrollable) */}
      <div
        ref={textRef}
        className="flex-1 overflow-y-auto px-3.5 pb-4 scrollbar-thin"
        style={{ fontSize: 13, lineHeight: 1.7, color: palette.textSecondary }}
      >
        {active?.text || active?.snippet || 'No source text available.'}
      </div>
    </div>
  )
}
