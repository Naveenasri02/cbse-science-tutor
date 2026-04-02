import { HiXMark, HiDocumentText } from 'react-icons/hi2'

export default function DocumentChips({ documents, onDelete, uploading, uploadProgress }) {
  if (documents.length === 0 && !uploading) return null

  return (
    <div className="flex flex-wrap items-center gap-2 mb-2 animate-fade-in">
      {documents.map(doc => (
        <span
          key={doc.doc_id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                     bg-[#10a37f]/15 border border-[#10a37f]/30 text-[#10a37f]"
        >
          <HiDocumentText className="text-sm" />
          <span className="max-w-[120px] truncate">{doc.filename}</span>
          <span className="text-[10px] text-[#10a37f]/60">{doc.chunks}ch</span>
          <button
            onClick={() => onDelete(doc.doc_id)}
            className="ml-0.5 p-0.5 rounded hover:bg-[#10a37f]/20 transition"
          >
            <HiXMark className="text-xs" />
          </button>
        </span>
      ))}

      {uploading && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                         bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b]">
          <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
          {uploadProgress || 'Processing...'}
        </span>
      )}
    </div>
  )
}
