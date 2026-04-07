import { palette } from '@cbse/shared'

/**
 * Shared toolbar component for all renderers.
 */
export function ViewerToolbar({ filename, children, onClose, expanded, onToggleExpand }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
      style={{ borderColor: palette.border, background: palette.bg }}
    >
      <span className="text-[12px] font-medium truncate max-w-[140px]" style={{ color: palette.textPrimary }} title={filename}>
        {filename || 'Document'}
      </span>
      <div className="flex items-center gap-1">
        {children}
        {onToggleExpand && (
          <>
            <div className="w-px h-4 mx-1" style={{ background: palette.border }} />
            <button onClick={onToggleExpand} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}>
              {expanded ? '⊡' : '⊞'}
            </button>
          </>
        )}
        {onClose && (
          <>
            <div className="w-px h-4 mx-1" style={{ background: palette.border }} />
            <button onClick={onClose} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}>
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}
