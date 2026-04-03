import { ShieldCheck, ArrowRight, Mail, MapPin } from 'lucide-react'
import { palette } from '../palette'

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

function BrandHeader() {
  return (
    <header
      className="flex items-center justify-between rounded-xl border px-4 py-3 md:px-5"
      style={{ borderColor: palette.border, background: palette.panel }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg border p-1"
          style={{ borderColor: palette.borderStrong, background: palette.bg }}
        >
          <MatifyLogo className="h-full w-full rounded-md object-cover" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight" style={{ color: palette.textPrimary }}>
            matify.tech
          </div>
          <div className="text-[11px]" style={{ color: palette.textMuted }}>
            We build GPT for your business
          </div>
        </div>
      </div>

      <a
        href="mailto:help@matify.tech"
        className="hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium md:inline-flex"
        style={{ borderColor: palette.borderStrong, background: palette.bg, color: palette.textSecondary }}
      >
        <Mail className="h-3.5 w-3.5" style={{ color: palette.primary }} />
        help@matify.tech
      </a>
    </header>
  )
}

function LandingFooter() {
  return (
    <footer className="mt-8">
      <section
        className="rounded-2xl border px-5 py-5 md:px-6 md:py-6"
        style={{ borderColor: palette.border, background: palette.panel }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-md">
            <div className="text-sm font-semibold" style={{ color: palette.textPrimary }}>
              matify.tech
            </div>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: palette.textMuted }}>
              Private AI experiences for businesses that want more control, better security, and deployment inside their own environment.
            </p>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <div
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: palette.borderStrong, background: palette.bg }}
            >
              <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: palette.textMuted }}>
                Location
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: palette.textPrimary }}>
                <MapPin className="h-3.5 w-3.5" style={{ color: palette.primary }} />
                California, USA
              </div>
            </div>

            <a
              href="mailto:help@matify.tech"
              className="rounded-xl border px-3 py-3 transition-colors"
              style={{ borderColor: palette.borderStrong, background: palette.bg, color: palette.textPrimary }}
            >
              <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: palette.textMuted }}>
                Email
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: palette.textPrimary }}>
                <Mail className="h-3.5 w-3.5" style={{ color: palette.primary }} />
                help@matify.tech
              </div>
            </a>
          </div>
        </div>

        <div
          className="mt-5 flex flex-col gap-2 border-t pt-3 text-[11px] md:flex-row md:items-center md:justify-between"
          style={{ borderColor: palette.border }}
        >
          <div style={{ color: palette.textMuted }}>On-prem SLM deployment · Secure AI infrastructure</div>
          <div style={{ color: palette.textMuted }}>© 2026 matify.tech</div>
        </div>
      </section>
    </footer>
  )
}

export default function LandingPage({ onTryDemo }) {
  return (
    <div className="min-h-screen w-full" style={{ background: palette.bg, color: palette.textPrimary }}>
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-5 md:px-6 lg:px-8">
        <BrandHeader />

        <main className="flex flex-1 items-center justify-center py-8 md:py-10">
          <section className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
            <div
              className="mb-4 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ borderColor: palette.borderStrong, background: palette.panel, color: palette.primary }}
            >
              <ShieldCheck className="h-3 w-3" />
              Own Your AI
            </div>

            <h1
              className="mx-auto max-w-[900px] text-3xl font-semibold leading-[1.1] tracking-tight md:text-4xl xl:text-[2.75rem]"
              style={{ color: palette.textPrimary }}
            >
              <span className="block">Who owns the AI you are using?</span>
              <span className="block">and how secure is your data?</span>
            </h1>

            <p
              className="mx-auto mt-4 max-w-xl text-[13px] leading-relaxed md:text-sm"
              style={{ color: palette.textSecondary }}
            >
              We build GPT for your business using your data, deploy it on your server, and keep your data inside your premise.
            </p>

            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={onTryDemo}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-all hover:-translate-y-0.5"
                style={{
                  background: palette.primary,
                  color: 'white',
                  boxShadow: '0 6px 20px rgba(29,155,240,0.22)',
                }}
              >
                Try the Demo
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        </main>

        <LandingFooter />
      </div>
    </div>
  )
}
