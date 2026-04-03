import { X } from 'lucide-react'
import { palette } from '../palette'

function getFileIcon(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return '📄'
  if (ext === 'docx' || ext === 'doc') return '📝'
  return '📎'
}

function ProgressRing({ progress, size = 28, stroke = 2.5 }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (progress / 100) * circ
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1D9BF0" strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.3s ease' }} />
    </svg>
  )
}

export default function DocumentChips({ documents, onDelete, uploading, uploadProgress }) {
  if (documents.length === 0 && !uploading) return null

  const handleOpen = (doc) => {
    if (doc.fileUrl) {
      window.open(doc.fileUrl, '_blank')
    }
  }

  const pct = typeof uploadProgress === 'number' ? uploadProgress : 0

  return (
    <div className="flex flex-wrap items-center gap-2 mb-2 animate-fade-in">
      {documents.map(doc => (
        <div
          key={doc.doc_id}
          className="group relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border transition-all cursor-pointer"
          style={{ background: palette.panelAlt, borderColor: palette.borderStrong }}
          onClick={() => handleOpen(doc)}
          title={`Click to open ${doc.filename}`}
        >
          <span className="text-sm">{getFileIcon(doc.filename)}</span>
          <div className="flex flex-col min-w-0">
            <span className="font-medium truncate max-w-[120px]" style={{ color: palette.textPrimary }}>{doc.filename}</span>
            <span className="text-[9px]" style={{ color: palette.textMuted }}>{doc.chunks} chunks</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(doc.doc_id) }}
            className="ml-0.5 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all"
            style={{ color: palette.textMuted }}
            title="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {uploading && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] border"
             style={{ background: palette.panelAlt, borderColor: 'rgba(29,155,240,0.3)' }}>
          <div className="relative flex items-center justify-center">
            <ProgressRing progress={pct} />
            <span className="absolute text-[8px] font-bold" style={{ color: '#1D9BF0' }}>
              {pct}%
            </span>
          </div>
          <span style={{ color: palette.textSecondary }}>
            {pct < 85 ? 'Uploading...' : pct < 100 ? 'Processing...' : 'Done!'}
          </span>
        </div>
      )}
    </div>
  )
}
