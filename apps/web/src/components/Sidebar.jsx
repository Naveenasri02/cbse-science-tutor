import { Trash2, X, ChevronLeft, ChevronDown, Scale, GraduationCap, Briefcase, Headset, Landmark, Bot, MessageSquareText, FileSearch, FileText, ShieldCheck, BookOpen, PenLine, ClipboardList, Users, UserPlus, Monitor, Package, Wrench, Info, ClipboardCheck, FileUp, Home, CircleUserRound, LogOut } from 'lucide-react'
import { palette } from '@cbse/shared'
import { useState } from 'react'
import { MatifyLogo } from './LandingPage'

export const ASSISTANTS = [
  {
    key: 'legal',
    label: 'Legal Assistant',
    icon: Scale,
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Legal Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Due diligence', icon: FileSearch, message: 'I want help with due diligence' },
      { label: 'Contract analysis', icon: FileText, message: 'I want help with contract analysis' },
      { label: 'Compliance lookup', icon: ShieldCheck, message: 'I want help with compliance lookup' },
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
      { label: 'Curriculum doubt solving', icon: BookOpen, message: 'I want help with curriculum doubt solving' },
      { label: 'Lesson plan creation', icon: PenLine, message: 'I want help with lesson plan creation' },
      { label: 'Exam preparation', icon: ClipboardList, message: 'I want help with exam preparation' },
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
      { label: 'HR policy support', icon: Users, message: 'I want help with HR policy support' },
      { label: 'Employee onboarding', icon: UserPlus, message: 'I want help with employee onboarding' },
      { label: 'IT helpdesk guidance', icon: Monitor, message: 'I want help with IT helpdesk guidance' },
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
      { label: 'Product discovery', icon: Package, message: 'I want help with product discovery' },
      { label: 'Issue troubleshooting', icon: Wrench, message: 'I want help with issue troubleshooting' },
      { label: 'Policy clarification', icon: Info, message: 'I want help with policy clarification' },
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
      { label: 'Policy lookup', icon: FileSearch, message: 'I want help with policy and product lookup' },
      { label: 'Claims guidance', icon: ClipboardCheck, message: 'I want help with claims and service guidance' },
      { label: 'Compliance support', icon: ShieldCheck, message: 'I want help with compliance and regulatory support' },
    ],
  },
  {
    key: 'general',
    label: 'General Assistant',
    icon: Bot,
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade General Document Assistant running on our local server. Upload any document and ask questions. I will analyze the content and provide accurate answers based on your uploaded material.',
    tryOptions: [],
  },
]

export default function Sidebar({ chats, activeChatId, activeAssistant, onSelectAssistant, onSwitchChat, onDeleteChat, open, onClose, onHome, showLanding }) {
  const [showProfileMenu, setShowProfileMenu] = useState(false)

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" onClick={onClose} />
      )}

      <aside
        className={`
          fixed lg:relative z-50 top-0 bottom-0 left-0 w-[85vw] max-w-[286px]
          flex flex-col border-r
          transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{ borderColor: palette.border, background: palette.sidebar }}
      >
        {/* Logo */}
        <div className="px-5 pt-7">
          <div className="flex items-center gap-2.5">
            <MatifyLogo className="h-8 w-8 rounded-lg" />
            <div className="text-[15px] font-semibold">matify.tech</div>
          </div>
        </div>

        {/* Home + Assistants */}
        <div className="px-5 pt-8">
          <button
            onClick={() => { onHome(); onClose() }}
            className="mb-4 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-all hover:bg-white/5"
            style={{ color: showLanding ? palette.textPrimary : palette.textSecondary }}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                background: showLanding ? 'rgba(29,155,240,0.14)' : undefined,
                color: showLanding ? palette.primary : palette.textSecondary,
              }}>
              <Home className="h-4 w-4" />
            </div>
            <div className="text-[14px] font-medium leading-5">Home</div>
          </button>

          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: palette.textMuted }}>
            AI Assistants
          </div>
          <div className="space-y-1.5">
            {ASSISTANTS.map((assistant) => {
              const Icon = assistant.icon
              const active = !showLanding && activeAssistant === assistant.key
              return (
                <button
                  key={assistant.key}
                  onClick={() => { onSelectAssistant(assistant.key); onClose() }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-all hover:bg-white/5"
                  style={{ color: active ? palette.textPrimary : palette.textSecondary }}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{
                      background: active ? 'rgba(29,155,240,0.14)' : undefined,
                      color: active ? palette.primary : palette.textSecondary,
                    }}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="text-[14px] font-medium leading-5">{assistant.label}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Chats */}
        <div className="px-5 pt-8">
          <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: palette.textMuted }}>
            Chats
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 space-y-1.5 scrollbar-thin">
          {chats.map((chat) => {
            const assistantCfg = ASSISTANTS.find(a => a.key === chat.assistant) || ASSISTANTS[0]
            const active = !showLanding && chat.id === activeChatId
            return (
              <div
                key={chat.id}
                onClick={() => { onSwitchChat(chat.id); onClose() }}
                className="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-all hover:bg-white/5 cursor-pointer"
                style={{ background: active ? palette.panelAlt : undefined, color: palette.textPrimary }}
              >
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ background: active ? 'rgba(29,155,240,0.14)' : palette.panel }}>
                  <FileText className="h-4 w-4" style={{ color: active ? palette.primary : palette.textSecondary }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px]">{chat.title}</div>
                  <div className="mt-1 text-xs" style={{ color: palette.textMuted }}>
                    {assistantCfg.label}
                  </div>
                </div>
                {chats.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id) }}
                    className="opacity-0 group-hover:opacity-100 transition p-1 rounded-lg hover:bg-white/10"
                    style={{ color: palette.textMuted }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Profile */}
        <div className="mt-auto border-t p-5" style={{ borderColor: palette.border }}>
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(p => !p)}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-all hover:bg-white/5"
              style={{ background: palette.panel }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: 'rgba(29,155,240,0.14)', color: palette.primary }}>
                <CircleUserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: palette.textPrimary }}>User</div>
                <div className="truncate text-xs" style={{ color: palette.textMuted }}>Admin</div>
              </div>
              <ChevronDown className="h-4 w-4 transition-transform"
                style={{ color: palette.textSecondary, transform: showProfileMenu ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>

            {showProfileMenu && (
              <div className="mt-3 rounded-2xl border p-2" style={{ borderColor: palette.borderStrong, background: palette.panel }}>
                <button
                  onClick={() => { onHome(); onClose(); setShowProfileMenu(false) }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all hover:bg-white/5"
                  style={{ color: palette.textSecondary }}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: palette.panelAlt, color: palette.textSecondary }}>
                    <LogOut className="h-4 w-4" />
                  </div>
                  <div className="text-[14px] font-medium leading-5">Logout</div>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
