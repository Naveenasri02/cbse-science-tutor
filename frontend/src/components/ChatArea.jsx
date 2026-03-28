import { useEffect, useRef } from 'react'
import Message from './Message'

export default function ChatArea({ messages, isBotResponding }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isBotResponding])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[720px] mx-auto px-4 pb-36 pt-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center">
            <div className="text-5xl mb-4">🔬</div>
            <h2 className="text-xl font-semibold mb-2">CBSE Class 10 Science Tutor</h2>
            <p className="text-[#9b9b9b] text-sm max-w-sm">
              Ask me anything about Physics, Chemistry, or Biology from the NCERT Class 10 syllabus.
              Type or use voice mode!
            </p>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {['What is Ohm\'s law?', 'Explain photosynthesis', 'Define acids and bases', 'How does the heart work?'].map(q => (
                <button key={q} className="px-4 py-2 rounded-xl border border-[#424242] text-[#9b9b9b]
                  hover:bg-[#2f2f2f] hover:text-white hover:border-[#10a37f] transition text-left">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <Message key={msg.id} role={msg.role} text={msg.text} />
        ))}

        {isBotResponding && messages.length > 0 && messages[messages.length - 1]?.text === '' && (
          <div className="flex gap-3 py-4">
            <div className="w-7 h-7 rounded-full bg-[#2f2f2f] flex items-center justify-center text-xs shrink-0">✦</div>
            <div className="pt-1">
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
