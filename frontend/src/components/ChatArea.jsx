import { useEffect, useRef } from 'react'
import Message from './Message'

export default function ChatArea({ messages, isBotResponding, onSuggestion }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isBotResponding])

  const suggestions = [
    { icon: '⚡', text: 'What is Ohm\'s law?' },
    { icon: '🌿', text: 'Explain photosynthesis' },
    { icon: '🧪', text: 'Define acids and bases' },
    { icon: '❤️', text: 'How does the heart work?' },
  ]

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-[760px] mx-auto px-4 pb-40 pt-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[65vh] text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#10a37f] to-[#0d8c6c] flex items-center justify-center text-3xl mb-5 shadow-lg">
              ⚛
            </div>
            <h1 className="text-2xl font-semibold mb-1 text-[#ececf1]">CBSE Science Tutor</h1>
            <p className="text-[#8e8ea0] text-sm mb-8">
              Class 10 Physics, Chemistry & Biology — NCERT aligned
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
              {suggestions.map(s => (
                <button
                  key={s.text}
                  onClick={() => onSuggestion?.(s.text)}
                  className="flex items-start gap-3 px-4 py-3.5 rounded-2xl border border-[#383838]
                    bg-[#2a2a2a] hover:bg-[#333] hover:border-[#10a37f]/50
                    transition-all text-left group"
                >
                  <span className="text-lg mt-0.5 opacity-70 group-hover:opacity-100 transition">{s.icon}</span>
                  <span className="text-[.9rem] text-[#b4b4b4] group-hover:text-[#ececf1] transition">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <Message
            key={msg.id}
            role={msg.role}
            text={msg.text}
            streaming={isBotResponding && msg.role === 'bot' && idx === messages.length - 1}
          />
        ))}

        {isBotResponding && messages.length > 0 && messages[messages.length - 1]?.text === '' && (
          <div className="flex gap-3 py-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#10a37f] to-[#0d8c6c] flex items-center justify-center text-sm shrink-0 shadow-sm">
              ⚛
            </div>
            <div className="pt-2.5 flex gap-1">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
