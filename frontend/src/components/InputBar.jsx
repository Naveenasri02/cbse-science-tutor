import { useState, useRef, useEffect } from 'react'
import { Mic, SendHorizontal, Square, Paperclip } from 'lucide-react'
import DocumentChips from './DocumentChips'
import { palette } from '../palette'

const VOICE_COLORS = {
  listening: '#1D9BF0',
  thinking: '#f59e0b',
  processing: '#f59e0b',
  speaking: '#8b5cf6',
  error: '#ef4444',
}

export default function InputBar({ onSend, onToggleVoice, voiceActive, voiceStatus, disabled, onUpload, documents, onDeleteDoc, uploading, uploadProgress, mode }) {
  const showUpload = mode === 'doc'
  const showVoice = mode !== 'doc'
  const [text, setText] = useState('')
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  const handleSend = () => {
    if (!text.trim()) return
    onSend(text)
    setText('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      await onUpload(file)
    } catch (err) {
      alert(err.message || 'Upload failed')
    }
  }

  const statusColor = voiceActive ? (VOICE_COLORS[voiceStatus?.cls] || VOICE_COLORS.listening) : null

  return (
    <div className="absolute inset-x-0 bottom-0 px-4 pb-6 md:px-8 md:pb-8">
      <div className="mx-auto max-w-4xl">
        {/* Inline voice status pill */}
        {voiceActive && voiceStatus?.text && (
          <div className="flex items-center justify-center mb-3 animate-fade-in">
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

        <div
          className="flex items-center gap-3 rounded-[30px] border px-5 py-4"
          style={{
            borderColor: voiceActive ? palette.primary : palette.borderStrong,
            background: 'rgba(43,43,43,0.92)',
            boxShadow: voiceActive
              ? `0 0 0 1px rgba(29,155,240,0.3), 0 16px 50px rgba(0,0,0,0.28)`
              : '0 16px 50px rgba(0,0,0,0.28)',
          }}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md,.csv,.pptx,.xlsx"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Upload button (doc mode) */}
          {showUpload && !voiceActive && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-40"
              style={{ background: 'transparent', color: palette.textMuted }}
              title="Upload file"
            >
              <Paperclip className="h-5 w-5" />
            </button>
          )}

          <input
            ref={inputRef}
            value={voiceActive ? '' : text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            disabled={disabled || voiceActive}
            placeholder={voiceActive ? 'Listening — speak or tap mic to stop' : 'Send a message...'}
            className="min-w-0 flex-1 bg-transparent px-1 py-3 text-base outline-none placeholder:opacity-60 md:text-lg"
            style={{ color: palette.textPrimary }}
          />

          {/* Voice button */}
          {showVoice && (
            <button
              onClick={onToggleVoice}
              disabled={disabled}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-all shrink-0 disabled:opacity-40
                ${voiceActive ? 'animate-pulse-mic' : ''}`}
              style={{
                background: voiceActive ? palette.primary : 'transparent',
                color: voiceActive ? 'white' : palette.textMuted,
                boxShadow: voiceActive ? '0 0 16px rgba(29,155,240,0.5)' : 'none',
              }}
              title={voiceActive ? 'Stop voice' : 'Start voice'}
            >
              {voiceActive ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
            </button>
          )}

          {/* Send button */}
          {!voiceActive && (
            <button
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-all shrink-0 disabled:opacity-40"
              style={{
                background: text.trim() ? palette.primary : 'rgba(255,255,255,0.08)',
                color: text.trim() ? 'white' : palette.textMuted,
              }}
            >
              <SendHorizontal className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="mt-4 text-center text-sm" style={{ color: palette.textMuted }}>
          AI-powered answers · Voice & Text
        </div>
      </div>
    </div>
  )
}
