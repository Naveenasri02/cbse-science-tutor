import { HiXMark, HiDocumentText } from 'react-icons/hi2'

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
    <div className="flex flex-wrap items-center gap-2 mb-2 animate-fade-in">
      {documents.map(doc => (
        <div
          key={doc.doc_id}
          className="group relative inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs
                     bg-[#2a2a2a] border border-[#424242] hover:border-[#565656] hover:bg-[#333]
                     transition-all cursor-pointer"
          onClick={() => handleOpen(doc)}
          title={`Click to open ${doc.filename}`}
        >
          <span className="text-base">{getFileIcon(doc.filename)}</span>
          <div className="flex flex-col min-w-0">
            <span className="text-[#ececf1] font-medium truncate max-w-[140px]">{doc.filename}</span>
            <span className="text-[10px] text-[#8e8ea0]">{doc.chunks} chunks</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(doc.doc_id) }}
            className="ml-1 p-0.5 rounded-full text-[#6b6b6b] hover:text-[#ececf1] hover:bg-[#424242]
                       opacity-0 group-hover:opacity-100 transition-all"
            title="Remove"
          >
            <HiXMark className="text-sm" />
          </button>
        </div>
      ))}

      {uploading && (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs
                        bg-[#2a2a2a] border border-[#f59e0b]/30">
          <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
          <span className="text-[#f59e0b]">{uploadProgress || 'Processing...'}</span>
        </div>
      )}
    </div>
  )
}
