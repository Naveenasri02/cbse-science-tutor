import { Trash2, X, ChevronLeft, Scale, GraduationCap, Briefcase, Headset, Landmark, MessageSquareText } from 'lucide-react'
import { palette } from '../palette'

export const ASSISTANTS = [
  {
    key: 'legal',
    label: 'Legal Assistant',
    icon: Scale,
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Legal Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Due diligence', message: 'I want help with due diligence' },
      { label: 'Contract analysis', message: 'I want help with contract analysis' },
      { label: 'Compliance lookup', message: 'I want help with compliance lookup' },
    ],
  },
  {
    key: 'teaching',
    label: 'Teaching Assistant',
    icon: GraduationCap,
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Teaching Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Curriculum doubt solving', message: 'I want help with curriculum doubt solving' },
      { label: 'Lesson plan creation', message: 'I want help with lesson plan creation' },
      { label: 'Exam preparation', message: 'I want help with exam preparation' },
    ],
  },
  {
    key: 'employee',
    label: 'Employee Assistant',
    icon: Briefcase,
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Employee Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'HR policy support', message: 'I want help with HR policy support' },
      { label: 'Employee onboarding', message: 'I want help with employee onboarding' },
      { label: 'IT helpdesk guidance', message: 'I want help with IT helpdesk guidance' },
    ],
  },
  {
    key: 'customer',
    label: 'Customer Assistant',
    icon: Headset,
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Customer Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Product discovery', message: 'I want help with product discovery' },
      { label: 'Issue troubleshooting', message: 'I want help with issue troubleshooting' },
      { label: 'Policy clarification', message: 'I want help with policy clarification' },
    ],
  },
  {
    key: 'banking',
    label: 'Banking & Insurance',
    icon: Landmark,
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Banking & Insurance Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Policy lookup', message: 'I want help with policy and product lookup' },
      { label: 'Claims guidance', message: 'I want help with claims and service guidance' },
      { label: 'Compliance support', message: 'I want help with compliance and regulatory support' },
    ],
  },
]

export default function Sidebar({ chats, activeChatId, activeAssistant, onSelectAssistant, onSwitchChat, onDeleteChat, open, onClose, onBackToLanding }) {
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
        <div className="px-4 pt-4">
          <button
            onClick={onBackToLanding}
            className="inline-flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition-colors hover:opacity-90"
            style={{ borderColor: palette.borderStrong, background: palette.panel, color: palette.textPrimary }}
          >
            <ChevronLeft className="h-3.5 w-3.5" style={{ color: palette.primary }} />
            Back to landing
          </button>
        </div>

        {/* AI Assistants */}
        <div className="px-4 pt-5">
          <div
            className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: palette.textMuted }}
          >
            AI Assistants
          </div>
          <div className="space-y-1">
            {ASSISTANTS.map((assistant) => {
              const Icon = assistant.icon
              const isActive = activeAssistant === assistant.key
              return (
                <button
                  key={assistant.key}
                  onClick={() => onSelectAssistant(assistant.key)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors"
                  style={{
                    background: isActive ? palette.panelAlt : 'transparent',
                    color: palette.textPrimary,
                  }}
                >
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-md"
                    style={{
                      background: isActive ? 'rgba(29,155,240,0.12)' : palette.panel,
                      color: isActive ? palette.primary : palette.textSecondary,
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span>{assistant.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Chats */}
        <div className="px-4 pt-5">
          <div
            className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: palette.textMuted }}
          >
            Chats
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-1 scrollbar-thin">
          {chats.map((chat) => {
            const assistantCfg = ASSISTANTS.find(a => a.key === chat.assistant) || ASSISTANTS[1]
            const Icon = assistantCfg.icon
            const isActive = chat.id === activeChatId
            return (
              <div
                key={chat.id}
                onClick={() => onSwitchChat(chat.id)}
                className="group flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer"
                style={{
                  background: isActive ? palette.panelAlt : 'transparent',
                  color: palette.textPrimary,
                }}
              >
                <div
                  className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md shrink-0"
                  style={{
                    background: isActive ? 'rgba(29,155,240,0.12)' : palette.panel,
                    color: isActive ? palette.primary : palette.textSecondary,
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate">{chat.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: palette.textMuted }}>
                    <MessageSquareText className="h-3 w-3" />
                    {assistantCfg.label}
                  </div>
                </div>
                {chats.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id) }}
                    className="opacity-0 group-hover:opacity-100 transition p-1 rounded-md hover:bg-white/5"
                    style={{ color: palette.textMuted }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="mt-auto border-t px-4 py-3" style={{ borderColor: palette.border }}>
          <button
            onClick={onBackToLanding}
            className="mb-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:opacity-90"
            style={{ borderColor: palette.borderStrong, background: palette.panel, color: palette.textSecondary }}
          >
            <ChevronLeft className="h-3 w-3" />
            Back to landing
          </button>
          <div className="text-[11px]" style={{ color: palette.textMuted }}>
            Voice & Text · AI Assistant
          </div>
        </div>
      </aside>
    </>
  )
}
