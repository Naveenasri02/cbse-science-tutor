import { useEffect, useRef } from 'react'
import Message from './Message'
import { MatifyLogo } from './LandingPage'
import { palette } from '@cbse/shared'

export default function ChatArea({ messages, isBotResponding, mode, assistantConfig, onTryClick, workflow }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isBotResponding])

  // Phase 1: No workflow selected — show welcome + Try buttons
  const showWelcome = !workflow && messages.length === 0

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {showWelcome ? (
        <div className="flex flex-1 items-center justify-center px-4 py-6 md:px-6 md:py-8">
          <div className="text-center max-w-lg">
            <div
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-[16px] border p-1.5"
              style={{ borderColor: 'rgba(29,155,240,0.22)', background: 'rgba(29,155,240,0.08)' }}
            >
              <MatifyLogo className="h-full w-full rounded-[12px] object-cover" />
            </div>

            <h2 className="mt-5 text-2xl font-semibold tracking-tight md:text-3xl" style={{ color: palette.textPrimary }}>
              {assistantConfig?.label || 'AI Assistant'}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed" style={{ color: palette.textMuted }}>
              {assistantConfig?.welcomeMessage || 'Select a workflow to get started.'}
            </p>

            {/* Workflow cards */}
            {assistantConfig?.tryOptions && assistantConfig.tryOptions.length > 0 && (
              <div className="mt-10">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-4" style={{ color: palette.textMuted }}>
                  Try a workflow
                </p>
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mx-auto"
                  style={{ maxWidth: assistantConfig.tryOptions.length <= 3 ? '480px' : '640px' }}
                >
                  {assistantConfig.tryOptions.map((opt) => {
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.label}
                        onClick={() => onTryClick?.(opt.message, opt.label)}
                        className="group flex flex-col items-center gap-2.5 rounded-2xl border px-4 py-5 transition-all duration-200 hover:scale-[1.04] active:scale-[0.97]"
                        style={{
                          borderColor: palette.border,
                          background: palette.panel,
                          color: palette.textPrimary,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(29,155,240,0.5)'
                          e.currentTarget.style.boxShadow = '0 0 20px rgba(29,155,240,0.15)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = palette.border
                          e.currentTarget.style.boxShadow = 'none'
                        }}
                      >
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-xl"
                          style={{ background: 'rgba(29,155,240,0.1)' }}
                        >
                          {Icon && <Icon size={20} style={{ color: palette.primary }} />}
                        </div>
                        <span className="text-[13px] font-medium leading-snug">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-3 pb-24 pt-5 md:px-6 md:pb-32 lg:px-8 scrollbar-thin">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
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
                  className="max-w-[88%] md:max-w-[80%] rounded-[20px] px-4 py-2.5 text-base md:text-[15px] leading-[1.6] flex gap-1.5 items-center"
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
