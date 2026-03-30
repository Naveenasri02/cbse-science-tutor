import { useState, useRef, useEffect } from 'react'
import { HiMicrophone, HiArrowUp } from 'react-icons/hi2'

export default function InputBar({ onSend, onToggleVoice, voiceActive, disabled }) {
  const [text, setText] = useState('')
  const textareaRef = useRef(null)

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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '52px'
      const scrollH = textareaRef.current.scrollHeight
      textareaRef.current.style.height = Math.min(scrollH, 200) + 'px'
    }
  }, [text])

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#212121] from-85% to-transparent px-4 pb-4 pt-6">
      <div className="max-w-[760px] mx-auto">
        <div className={`relative flex items-end gap-1 rounded-3xl border bg-[#303030] px-3 py-2 transition-colors
          ${voiceActive ? 'border-[#10a37f] shadow-[0_0_0_1px_rgba(16,163,127,0.3)]' : 'border-[#424242] focus-within:border-[#565656]'}`}>
          <textarea
            ref={textareaRef}
            value={voiceActive ? '' : text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            disabled={disabled || voiceActive}
            placeholder={voiceActive ? 'Voice mode active — tap mic to stop' : 'Message CBSE Tutor...'}
            rows={1}
            className="flex-1 bg-transparent text-[#ececf1] text-[.95rem] outline-none resize-none
                       py-2 px-2 placeholder:text-[#6b6b6b] disabled:opacity-40
                       min-h-[36px] max-h-[200px] leading-relaxed"
          />

          <div className="flex items-center gap-1.5 pb-1">
            {/* Voice button */}
            <button
              onClick={onToggleVoice}
              disabled={disabled}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0
                ${voiceActive
                  ? 'bg-[#10a37f] text-white shadow-[0_0_12px_rgba(16,163,127,0.5)] animate-pulse-mic'
                  : 'text-[#8e8ea0] hover:text-[#ececf1] hover:bg-[#424242]'}
                disabled:opacity-40`}
            >
              <HiMicrophone className="text-[1.1rem]" />
            </button>

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={disabled || voiceActive || !text.trim()}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0
                ${text.trim()
                  ? 'bg-white text-[#212121] hover:bg-[#e0e0e0]'
                  : 'bg-[#424242] text-[#6b6b6b] cursor-default'}
                disabled:bg-[#424242] disabled:text-[#6b6b6b] disabled:cursor-default`}
            >
              <HiArrowUp className="text-[1.1rem] font-bold" />
            </button>
          </div>
        </div>
        <p className="text-center text-[10px] text-[#6b6b6b] mt-2.5 select-none">
          CBSE Class 10 Science · NCERT aligned answers
        </p>
      </div>
    </div>
  )
}
