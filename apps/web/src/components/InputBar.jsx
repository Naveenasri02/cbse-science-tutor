import { useState, useRef, useEffect } from 'react'
import { Mic, SendHorizontal, Square, Paperclip } from 'lucide-react'
import { palette } from '@cbse/shared'

const VOICE_COLORS = {
  listening: '#1D9BF0',
  recording: '#10b981',
  thinking: '#f59e0b',
  processing: '#f59e0b',
  speaking: '#8b5cf6',
  error: '#ef4444',
}

export default function InputBar({ onSend, onToggleVoice, voiceActive, voiceStatus, disabled, mode, voiceEnabled = true, hasWorkflow = true, onUpload, uploading }) {
  const showVoice = voiceEnabled
  const [text, setText] = useState('')
  const inputRef = useRef(null)
  const fileRef = useRef(null)

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

  const statusColor = voiceActive ? (VOICE_COLORS[voiceStatus?.cls] || VOICE_COLORS.listening) : null

  return (
    <div className="z-10 shrink-0 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 md:px-6 md:pb-4 md:pt-2" style={{ background: palette.bg }}>
      <div className="mx-auto max-w-3xl">
        {/* Inline voice status pill */}
        {voiceActive && voiceStatus?.text && (
          <div className="flex items-center justify-center mb-2 animate-fade-in">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[13px] font-medium"
              style={{ backgroundColor: statusColor + '18', color: statusColor, border: `1px solid ${statusColor}30` }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusColor }} />
              {voiceStatus.text}
            </span>
          </div>
        )}

        {/* Document chips and upload removed — upload handled by workflow upload zone */}

        <div
          className="flex items-center gap-1.5 rounded-[20px] border px-2.5 py-1.5 sm:gap-2 sm:rounded-[24px] sm:px-3 sm:py-2"
          style={{
            borderColor: voiceActive ? palette.primary : palette.borderStrong,
            background: 'rgba(43,43,43,0.92)',
            boxShadow: voiceActive
              ? `0 0 0 1px rgba(29,155,240,0.3), 0 8px 30px rgba(0,0,0,0.28)`
              : '0 8px 30px rgba(0,0,0,0.28)',
          }}
        >
          {/* Attach file button */}
          {onUpload && !voiceActive && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  e.target.value = ''
                  try { await onUpload(file) } catch (err) { alert(err.message || 'Upload failed') }
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={disabled || uploading}
                className="flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-full transition-all shrink-0 disabled:opacity-40 hover:bg-white/10"
                style={{ color: uploading ? palette.primary : palette.textMuted }}
                title="Attach file"
              >
                <Paperclip className={`h-4 w-4 ${uploading ? 'animate-pulse' : ''}`} />
              </button>
            </>
          )}
          <input
            ref={inputRef}
            value={voiceActive ? '' : text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            disabled={disabled || voiceActive}
            placeholder={voiceActive ? 'Listening — speak or tap mic to stop' : hasWorkflow ? 'Send a message...' : 'Pick a topic above or just type here...'}
            className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-base md:text-[15px] outline-none placeholder:opacity-50"
            style={{ color: palette.textPrimary }}
          />

          {/* Voice button */}
          {showVoice && (
            <button
              onClick={onToggleVoice}
              disabled={disabled}
              className={`flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-full transition-all shrink-0 disabled:opacity-40
                ${voiceActive ? 'animate-pulse-mic' : ''}`}
              style={{
                background: voiceActive ? palette.primary : 'transparent',
                color: voiceActive ? 'white' : palette.textMuted,
                boxShadow: voiceActive ? '0 0 12px rgba(29,155,240,0.5)' : 'none',
              }}
              title={voiceActive ? 'Stop voice' : 'Start voice'}
            >
              {voiceActive ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
            </button>
          )}

          {/* Send button */}
          {!voiceActive && (
            <button
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              className="flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-full transition-all shrink-0 disabled:opacity-40"
              style={{
                background: text.trim() ? palette.primary : 'rgba(255,255,255,0.08)',
                color: text.trim() ? 'white' : palette.textMuted,
              }}
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="hidden sm:block mt-1.5 text-center text-[11px] md:text-[12px] md:mt-2" style={{ color: palette.textMuted }}>
          AI-powered answers · Voice & Text
        </div>
      </div>
    </div>
  )
}
