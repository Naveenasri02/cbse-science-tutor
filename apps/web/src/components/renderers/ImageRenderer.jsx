import { useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { palette } from '@cbse/shared'
import { ViewerToolbar } from './highlightUtils'

export default function ImageRenderer({ fileUrl, filename, onClose }) {
  const [scale, setScale] = useState(1.0)
  const [expanded, setExpanded] = useState(false)

  const zoomIn = () => setScale(s => Math.min(s + 0.25, 4.0))
  const zoomOut = () => setScale(s => Math.max(s - 0.25, 0.25))

  return (
    <div className={`h-full flex flex-col ${expanded ? 'fixed inset-0 z-50' : ''}`} style={{ background: palette.panel }}>
      <ViewerToolbar filename={filename} onClose={onClose} expanded={expanded} onToggleExpand={() => setExpanded(!expanded)}>
        <button onClick={zoomOut} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}><ZoomOut size={14} /></button>
        <span className="text-[10px] min-w-[36px] text-center" style={{ color: palette.textMuted }}>{Math.round(scale * 100)}%</span>
        <button onClick={zoomIn} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}><ZoomIn size={14} /></button>
        <div className="w-px h-4 mx-1" style={{ background: palette.border }} />
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(29,155,240,0.1)', color: palette.primary }}>
          Image
        </span>
      </ViewerToolbar>

      <div className="flex-1 overflow-auto flex items-start justify-center p-4" style={{ background: '#1a1a2e' }}>
        <img
          src={fileUrl}
          alt={filename}
          className="max-w-none transition-transform duration-200"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
          draggable={false}
        />
      </div>

      <div className="px-3 py-2 border-t text-center" style={{ borderColor: palette.border, background: palette.bg }}>
        <p className="text-[11px]" style={{ color: palette.textMuted }}>
          📷 Image analyzed — ask questions about its content
        </p>
      </div>
    </div>
  )
}
