import { Plus, Trash2, X, ChevronLeft, Scale, GraduationCap, Briefcase, Headset, MessageSquareText } from 'lucide-react'
import { palette } from '../palette'

const assistantOptions = [
  { label: 'Smart Chat', icon: '🧠' },
  { label: 'Doc Chat', icon: '📁' },
]

export default function Sidebar({ chats, activeChatId, onNewChat, onSwitchChat, onDeleteChat, open, onClose, onBackToLanding }) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" onClick={onClose} />
      )}

      <aside
        className={`
          fixed lg:relative z-50 top-0 bottom-0 left-0 w-[310px]
          flex flex-col border-r
          transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{ borderColor: palette.border, background: palette.sidebar }}
      >
        {/* Back to landing */}
        <div className="px-5 pt-6">
          <button
            onClick={onBackToLanding}
            className="inline-flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] font-medium transition-colors hover:opacity-90"
            style={{ borderColor: palette.borderStrong, background: palette.panel, color: palette.textPrimary }}
          >
            <ChevronLeft className="h-4 w-4" style={{ color: palette.primary }} />
            Back to landing
          </button>
        </div>

        {/* New Chat + Close */}
        <div className="flex items-center justify-between px-5 pt-5">
          <button
            onClick={onNewChat}
            className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
            style={{ borderColor: palette.borderStrong, background: palette.panel, color: palette.textPrimary }}
          >
            <Plus className="h-4 w-4" style={{ color: palette.primary }} />
            New chat
          </button>
          <button
            onClick={onClose}
            className="lg:hidden p-2 rounded-lg transition-colors"
            style={{ color: palette.textMuted }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* AI Assistants */}
        <div className="px-5 pt-8">
          <div
            className="mb-3 text-xs font-semibold uppercase tracking-[0.16em]"
            style={{ color: palette.textMuted }}
          >
            AI Assistants
          </div>
          <div className="space-y-2">
            {assistantOptions.map((assistant, index) => (
              <div
                key={assistant.label}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px]"
                style={{
                  background: index === 0 ? palette.panelAlt : 'transparent',
                  color: palette.textPrimary,
                }}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-base"
                  style={{
                    background: index === 0 ? 'rgba(29,155,240,0.12)' : palette.panel,
                  }}
                >
                  {assistant.icon}
                </div>
                <span>{assistant.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Chats */}
        <div className="px-5 pt-8">
          <div
            className="mb-3 text-xs font-semibold uppercase tracking-[0.16em]"
            style={{ color: palette.textMuted }}
          >
            Chats
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 space-y-2 scrollbar-thin">
          {chats.map((chat, index) => (
            <div
              key={chat.id}
              onClick={() => onSwitchChat(chat.id)}
              className="group flex w-full items-start gap-3 rounded-2xl px-4 py-4 text-left transition-colors cursor-pointer"
              style={{
                background: chat.id === activeChatId ? palette.panelAlt : 'transparent',
                color: palette.textPrimary,
              }}
            >
              <div
                className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg text-base shrink-0"
                style={{
                  background: chat.id === activeChatId ? 'rgba(29,155,240,0.12)' : palette.panel,
                }}
              >
                {chat.mode === 'doc' ? '📁' : '🧠'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] truncate">{chat.title}</div>
                <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: palette.textMuted }}>
                  <MessageSquareText className="h-3.5 w-3.5" />
                  {chat.mode === 'doc' ? 'Doc Chat' : 'Smart Chat'}
                </div>
              </div>
              {chats.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id) }}
                  className="opacity-0 group-hover:opacity-100 transition p-1 rounded-lg hover:bg-white/5"
                  style={{ color: palette.textMuted }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-5" style={{ borderColor: palette.border }}>
          <div className="text-sm" style={{ color: palette.textMuted }}>
            Voice & Text · AI Assistant
          </div>
        </div>
      </aside>
    </>
  )
}
