import { useEffect, useRef } from 'react'
import Message from './Message'

export default function ChatArea({ messages, isBotResponding, mode }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isBotResponding])

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-[760px] mx-auto px-4 pb-40 pt-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[65vh] text-center">
            {mode === 'doc' ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-[#10a37f]/10 border border-[#10a37f]/20 flex items-center justify-center text-3xl mb-5 shadow-lg">
                  📁
                </div>
                <h1 className="text-2xl font-semibold mb-1 text-[#ececf1]">Chat with Docs</h1>
                <p className="text-[#8e8ea0] text-sm">
                  Upload a file and ask questions about it
                </p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 flex items-center justify-center text-3xl mb-5 shadow-lg">
                  🧠
                </div>
                <h1 className="text-2xl font-semibold mb-1 text-[#ececf1]">Chat with AI</h1>
                <p className="text-[#8e8ea0] text-sm">
                  Ask me anything — type or tap the mic to talk
                </p>
              </>
            )}
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
