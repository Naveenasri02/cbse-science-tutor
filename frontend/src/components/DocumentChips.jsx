import { X } from 'lucide-react'
import { palette } from '../palette'

function getFileIcon(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return '📄'
  if (ext === 'docx' || ext === 'doc') return '📝'
  return '📎'
}

export default function DocumentChips({ documents, onDelete, uploading, uploadProgress }) {
  if (documents.length === 0 && !uploading) return null

  const handleOpen = (doc) => {
    if (doc.fileUrl) {
      window.open(doc.fileUrl, '_blank')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 animate-fade-in">
      {documents.map(doc => (
        <div
          key={doc.doc_id}
          className="group relative inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs border transition-all cursor-pointer"
          style={{ background: palette.panelAlt, borderColor: palette.borderStrong }}
          onClick={() => handleOpen(doc)}
          title={`Click to open ${doc.filename}`}
        >
          <span className="text-base">{getFileIcon(doc.filename)}</span>
          <div className="flex flex-col min-w-0">
            <span className="font-medium truncate max-w-[140px]" style={{ color: palette.textPrimary }}>{doc.filename}</span>
            <span className="text-[10px]" style={{ color: palette.textMuted }}>{doc.chunks} chunks</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(doc.doc_id) }}
            className="ml-1 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all"
            style={{ color: palette.textMuted }}
            title="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {uploading && (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs border"
             style={{ background: palette.panelAlt, borderColor: 'rgba(245,158,11,0.3)' }}>
          <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
          <span className="text-[#f59e0b]">{uploadProgress || 'Processing...'}</span>
        </div>
      )}
    </div>
  )
}
