import { useState, useRef, useEffect } from 'react'
import { HiMicrophone, HiArrowUp, HiStop, HiPaperClip } from 'react-icons/hi2'
import DocumentChips from './DocumentChips'

const VOICE_COLORS = {
  listening: '#10a37f',
  thinking: '#f59e0b',
  processing: '#f59e0b',
  speaking: '#8b5cf6',
  error: '#ef4444',
}

export default function InputBar({ onSend, onToggleVoice, voiceActive, voiceStatus, disabled, onUpload, documents, onDeleteDoc, uploading, uploadProgress, mode }) {
  const showUpload = mode === 'doc'
  const showVoice = mode !== 'doc'
  const [text, setText] = useState('')
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)

  const handleSend = () => {
    if (!text.trim()) return
    onSend(text)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = '52px'
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '52px'
      const scrollH = textareaRef.current.scrollHeight
      textareaRef.current.style.height = Math.min(scrollH, 200) + 'px'
    }
  }, [text])

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so same file can be re-selected
    try {
      await onUpload(file)
    } catch (err) {
      alert(err.message || 'Upload failed')
    }
  }

  const statusColor = voiceActive ? (VOICE_COLORS[voiceStatus?.cls] || VOICE_COLORS.listening) : null

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#212121] from-85% to-transparent px-4 pb-4 pt-6">
      <div className="max-w-[760px] mx-auto">
        {/* Inline voice status pill */}
        {voiceActive && voiceStatus?.text && (
          <div className="flex items-center justify-center mb-2 animate-fade-in">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{ backgroundColor: statusColor + '18', color: statusColor, border: `1px solid ${statusColor}30` }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusColor }} />
              {voiceStatus.text}
            </span>
          </div>
        )}

        {/* Document chips (doc mode only) */}
        {showUpload && (
          <DocumentChips
            documents={documents || []}
            onDelete={onDeleteDoc}
            uploading={uploading}
            uploadProgress={uploadProgress}
          />
        )}

        <div className={`relative flex items-end gap-1 rounded-3xl border bg-[#303030] px-3 py-2 transition-colors
          ${voiceActive ? 'border-[#10a37f] shadow-[0_0_0_1px_rgba(16,163,127,0.3)]' : 'border-[#424242] focus-within:border-[#565656]'}`}>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md,.csv,.pptx,.xlsx"
            onChange={handleFileSelect}
            className="hidden"
          />

          <textarea
            ref={textareaRef}
            value={voiceActive ? '' : text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            disabled={disabled || voiceActive}
            placeholder={voiceActive ? 'Listening — speak or tap mic to stop' : 'Send a message...'}
            rows={1}
            className="flex-1 bg-transparent text-[#ececf1] text-[.95rem] outline-none resize-none
                       py-2 px-2 placeholder:text-[#6b6b6b] disabled:opacity-40
                       min-h-[36px] max-h-[200px] leading-relaxed"
          />

          <div className="flex items-center gap-1.5 pb-1">
            {/* Upload button (doc mode only) */}
            {showUpload && !voiceActive && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploading}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0
                  text-[#8e8ea0] hover:text-[#ececf1] hover:bg-[#424242]
                  disabled:opacity-40"
                title="Upload file"
              >
                <HiPaperClip className="text-[1.1rem]" />
              </button>
            )}

            {/* Voice button (hidden in doc mode) */}
            {showVoice && (
              <button
                onClick={onToggleVoice}
                disabled={disabled}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0
                  ${voiceActive
                    ? 'bg-[#10a37f] text-white shadow-[0_0_12px_rgba(16,163,127,0.5)] animate-pulse-mic'
                    : 'text-[#8e8ea0] hover:text-[#ececf1] hover:bg-[#424242]'}
                  disabled:opacity-40`}
                title={voiceActive ? 'Stop voice' : 'Start voice'}
              >
                {voiceActive ? <HiStop className="text-[1.1rem]" /> : <HiMicrophone className="text-[1.1rem]" />}
              </button>
            )}

            {/* Send button */}
            {!voiceActive && (
              <button
                onClick={handleSend}
                disabled={disabled || !text.trim()}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0
                  ${text.trim()
                    ? 'bg-white text-[#212121] hover:bg-[#e0e0e0]'
                    : 'bg-[#424242] text-[#6b6b6b] cursor-default'}
                  disabled:bg-[#424242] disabled:text-[#6b6b6b] disabled:cursor-default`}
              >
                <HiArrowUp className="text-[1.1rem] font-bold" />
              </button>
            )}
          </div>
        </div>
        <p className="text-center text-[10px] text-[#6b6b6b] mt-2.5 select-none">
          AI-powered answers · Voice & Text
        </p>
      </div>
    </div>
  )
}
