import { useState } from 'react'
import { ShieldCheck, Scale, GraduationCap, Briefcase, Headset, Landmark, Bot, Mail } from 'lucide-react'
import { palette } from '@cbse/shared'

function MatifyLogo({ className = '' }) {
  return (
    <svg viewBox="0 0 100 100" aria-label="Matify logo" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="matifyBlue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#58BCFF" />
          <stop offset="100%" stopColor="#1D9BF0" />
        </linearGradient>
      </defs>
      <path d="M47 50C47 31 34 23 22 23C15 23 11 28 11 35C11 45 18 54 28 58C38 62 47 61 47 50Z" fill="url(#matifyBlue)" />
      <path d="M53 50C53 31 66 23 78 23C85 23 89 28 89 35C89 45 82 54 72 58C62 62 53 61 53 50Z" fill="url(#matifyBlue)" />
      <path d="M48 54C48 69 39 79 29 79C23 79 20 75 20 69C20 61 26 55 34 53C41 51 48 51 48 54Z" fill="url(#matifyBlue)" />
      <path d="M52 54C52 69 61 79 71 79C77 79 80 75 80 69C80 61 74 55 66 53C59 51 52 51 52 54Z" fill="url(#matifyBlue)" />
    </svg>
  )
}

export { MatifyLogo }

const LANDING_ASSISTANTS = [
  { key: 'legal', label: 'Legal Assistant', icon: Scale },
  { key: 'teaching', label: 'Teaching Assistant', icon: GraduationCap },
  { key: 'employee', label: 'Employee Assistant', icon: Briefcase },
  { key: 'customer', label: 'Customer Assistant', icon: Headset },
  { key: 'banking', label: 'Banking & Insurance', icon: Landmark },
  { key: 'general', label: 'General Assistant', icon: Bot },
]

export default function LandingPage({ onTryDemo }) {
  const [hoveredAssistant, setHoveredAssistant] = useState(null)

  return (
    <div
      className="flex min-h-screen w-full flex-col"
      style={{
        background: palette.bg,
        color: palette.textPrimary,
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between border-b px-5 py-4 md:px-6"
        style={{ borderColor: palette.border, background: palette.bg }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg border p-1"
            style={{ borderColor: palette.borderStrong, background: palette.panel }}
          >
            <MatifyLogo className="h-full w-full" />
          </div>
          <div className="text-[15px] font-semibold">matify.tech</div>
        </div>
        <a
          href="mailto:help@matify.tech"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
          style={{ background: palette.primary, color: 'white' }}
        >
          <Mail className="h-4 w-4" />
          Contact Us
        </a>
      </header>

      {/* Main content */}
      <main className="flex flex-1 items-start justify-center px-6 pb-8 pt-8 md:px-10 md:pt-12">
        <div className="w-full max-w-6xl text-center">
          {/* Badge */}
          <div
            className="mx-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{
              borderColor: palette.borderStrong,
              background: palette.panel,
              color: palette.primary,
            }}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Own your AI
          </div>

          {/* Hero */}
          <h1
            className="mx-auto mt-6 max-w-[1000px] text-[36px] font-semibold leading-[1.08] tracking-tight md:text-[52px] xl:text-[54px]"
            style={{ color: palette.textPrimary }}
          >
            <span className="block">Who owns the AI you are using?</span>
            <span className="mt-1 block">
              <span style={{ color: palette.primary }}>How secure is your data?</span>
            </span>
          </h1>

          <p
            className="mx-auto mt-5 max-w-[900px] text-sm leading-7 md:text-[17px]"
            style={{ color: palette.textSecondary }}
          >
            We turn your organization's data into a secure SLM, deployed in your own environment, so your data never leaves your premise.
          </p>

          {/* TRY section */}
          <div className="mx-auto mt-12 max-w-6xl">
            <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: palette.textMuted }}>
              TRY
            </div>
            <div className="mx-auto grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {LANDING_ASSISTANTS.map((assistant) => {
                const Icon = assistant.icon
                const hovered = hoveredAssistant === assistant.key
                return (
                  <button
                    key={assistant.key}
                    onClick={onTryDemo}
                    onMouseEnter={() => setHoveredAssistant(assistant.key)}
                    onMouseLeave={() => setHoveredAssistant(null)}
                    className="rounded-[22px] border px-4 py-4 text-left transition-all hover:-translate-y-0.5"
                    style={{
                      borderColor: hovered ? palette.primary : palette.border,
                      background: hovered ? palette.panelAlt : palette.panel,
                      color: palette.textPrimary,
                      boxShadow: hovered ? '0 0 0 1px rgba(29,155,240,0.18)' : 'none',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-xl"
                        style={{
                          background: hovered ? 'rgba(29,155,240,0.14)' : palette.bg,
                          color: hovered ? palette.primary : palette.textSecondary,
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="text-sm font-medium leading-5">{assistant.label}</div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Footer */}
            <div
              className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t pt-5 text-sm"
              style={{ borderColor: palette.border, color: palette.textMuted }}
            >
              <span>© 2026 Mat Studio, Inc.</span>
              <a href="#" className="transition-opacity hover:opacity-80" style={{ color: palette.textSecondary }}>
                Terms
              </a>
              <a href="#" className="transition-opacity hover:opacity-80" style={{ color: palette.textSecondary }}>
                Privacy Policy
              </a>
              <a href="#" className="transition-opacity hover:opacity-80" style={{ color: palette.textSecondary }}>
                Cookie Policy
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
