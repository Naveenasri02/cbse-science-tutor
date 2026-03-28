import { useState, useRef } from 'react'
import { HiMicrophone, HiPaperAirplane } from 'react-icons/hi2'

export default function InputBar({ onSend, onToggleVoice, voiceActive, disabled }) {
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  const handleSend = () => {
    if (!text.trim()) return
    onSend(text)
    setText('')
    inputRef.current?.focus()
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 px-4 pb-5 pt-3 bg-gradient-to-t from-[#212121] via-[#212121] to-transparent">
      <div className="max-w-[720px] mx-auto flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={voiceActive ? '' : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          disabled={disabled || voiceActive}
          placeholder={voiceActive ? 'Voice mode active — tap 🎤 to stop' : 'Message CBSE Tutor...'}
          className="flex-1 px-5 py-3 rounded-full border border-[#424242] bg-[#2f2f2f] text-[#ececf1]
                     text-[.95rem] outline-none focus:border-[#10a37f] transition
                     placeholder:text-[#6b6b6b] disabled:opacity-50"
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={disabled || voiceActive || !text.trim()}
          className="w-11 h-11 rounded-full bg-[#10a37f] text-white flex items-center justify-center
                     hover:bg-[#0d8c6c] transition disabled:bg-[#424242] disabled:cursor-default shrink-0"
        >
          <HiPaperAirplane className="text-lg" />
        </button>

        {/* Voice button */}
        <button
          onClick={onToggleVoice}
          disabled={disabled}
          className={`w-11 h-11 rounded-full flex items-center justify-center border transition shrink-0
            ${voiceActive
              ? 'bg-[#10a37f] text-white border-[#10a37f] animate-pulse-mic'
              : 'bg-transparent text-[#ececf1] border-[#424242] hover:border-[#10a37f] hover:text-[#10a37f]'}
            disabled:opacity-50`}
        >
          <HiMicrophone className="text-lg" />
        </button>
      </div>
      <p className="text-center text-[10px] text-[#6b6b6b] mt-2">
        CBSE Class 10 Science only · Answers from NCERT textbook
      </p>
    </div>
  )
}
