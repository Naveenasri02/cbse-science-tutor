import { useEffect, useRef } from 'react'
import Message from './Message'
import { MatifyLogo } from './LandingPage'
import { palette } from '../palette'

export default function ChatArea({ messages, isBotResponding, mode }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isBotResponding])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="text-center">
            <div
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] border p-2"
              style={{ borderColor: 'rgba(29,155,240,0.22)', background: 'rgba(29,155,240,0.08)' }}
            >
              <MatifyLogo className="h-full w-full rounded-[18px] object-cover" />
            </div>

            <h2 className="mt-7 text-4xl font-semibold tracking-tight md:text-5xl" style={{ color: palette.textPrimary }}>
              {mode === 'doc' ? 'Chat with Docs' : 'Chat with AI'}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 md:text-lg" style={{ color: palette.textMuted }}>
              {mode === 'doc'
                ? 'Upload a file and ask questions about it'
                : 'This is our SLM running in our own premise. We build the same with your data and deploy it to your premise.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-5 pb-44 pt-8 md:px-8 lg:px-10 scrollbar-thin">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            {messages.map((msg, idx) => (
              <Message
                key={msg.id}
                role={msg.role}
                text={msg.text}
                streaming={isBotResponding && msg.role === 'bot' && idx === messages.length - 1}
              />
            ))}

            {isBotResponding && messages.length > 0 && messages[messages.length - 1]?.text === '' && (
              <div className="flex justify-start">
                <div
                  className="max-w-[85%] rounded-[26px] px-5 py-4 text-sm leading-7 flex gap-2 items-center"
                  style={{ background: palette.panelAlt, border: `1px solid ${palette.border}` }}
                >
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  )
}
