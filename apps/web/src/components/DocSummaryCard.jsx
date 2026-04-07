import { useState } from 'react'
import { FileText, Sparkles, X, Tag, Users, Layers, BookOpen, Lightbulb, List, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { palette } from '@cbse/shared'

function Section({ icon: Icon, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 mb-1.5 w-full text-left"
      >
        <Icon size={12} style={{ color: palette.primary }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider flex-1" style={{ color: palette.textMuted }}>
          {title}
        </span>
        {open ? <ChevronUp size={12} style={{ color: palette.textMuted }} /> : <ChevronDown size={12} style={{ color: palette.textMuted }} />}
      </button>
      {open && children}
    </div>
  )
}

export default function DocSummaryCard({ documents, onQuestionClick, onDismiss, onOpenPdf }) {
  const doc = [...documents].reverse().find(d => d.summary || d.relevanceWarning)
  if (!doc) return null

  // Irrelevant document — show compact rejection, hide summary entirely
  if (doc.relevanceWarning) {
    return (
      <div className="mx-auto max-w-3xl w-full px-3 md:px-6 lg:px-8 animate-fade-in">
        <div
          className="relative rounded-2xl border p-4 mb-3"
          style={{
            background: 'rgba(234,179,8,0.06)',
            borderColor: 'rgba(234,179,8,0.3)',
          }}
        >
          <button
            onClick={() => onDismiss?.(doc.doc_id)}
            className="absolute top-3 right-3 p-1 rounded-full transition-colors hover:bg-white/10"
            style={{ color: palette.textMuted }}
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5">⚠️</span>
            <div>
              <p className="text-[13px] font-semibold mb-1" style={{ color: '#b45309' }}>
                {doc.filename}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: '#92400e' }}>
                {doc.relevanceWarning}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl w-full px-3 md:px-6 lg:px-8 animate-fade-in">
      <div
        className="relative rounded-2xl border p-4 md:p-6 mb-3"
        style={{
          background: 'linear-gradient(135deg, rgba(29,155,240,0.06) 0%, rgba(29,155,240,0.02) 100%)',
          borderColor: 'rgba(29,155,240,0.2)',
        }}
      >
        {/* Dismiss button */}
        <button
          onClick={() => onDismiss?.(doc.doc_id)}
          className="absolute top-3 right-3 p-1 rounded-full transition-colors hover:bg-white/10"
          style={{ color: palette.textMuted }}
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Header with doc type badge */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: 'rgba(29,155,240,0.15)' }}
          >
            <FileText size={18} style={{ color: palette.primary }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold truncate" style={{ color: palette.textPrimary }}>
                {doc.filename}
              </span>
              {onOpenPdf && (
                <button
                  onClick={onOpenPdf}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-all hover:scale-[1.05]"
                  style={{ background: 'rgba(29,155,240,0.1)', color: palette.primary }}
                  title="View PDF"
                >
                  <ExternalLink size={10} /> View
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px]" style={{ color: palette.textMuted }}>
                {doc.chunks} chunks analyzed
              </span>
              {doc.doc_type && (
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    background: 'rgba(29,155,240,0.12)',
                    color: palette.primary,
                    border: '1px solid rgba(29,155,240,0.25)',
                  }}
                >
                  {doc.doc_type}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Summary — prominent, always open */}
        <Section icon={BookOpen} title="Summary">
          <p className="text-[14px] leading-relaxed" style={{ color: palette.textSecondary }}>
            {doc.summary}
          </p>
        </Section>

        {/* Suggested questions — prominent, always open */}
        {doc.suggestedQuestions?.length > 0 && (
          <Section icon={Sparkles} title="Suggested Questions">
            <div className="flex flex-wrap gap-2">
              {doc.suggestedQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onQuestionClick?.(q)}
                  className="text-left text-[13px] px-4 py-2 rounded-full border transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: 'rgba(29,155,240,0.08)',
                    borderColor: 'rgba(29,155,240,0.2)',
                    color: palette.textSecondary,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(29,155,240,0.5)'
                    e.currentTarget.style.background = 'rgba(29,155,240,0.15)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(29,155,240,0.2)'
                    e.currentTarget.style.background = 'rgba(29,155,240,0.08)'
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Table of Contents / Document Structure — collapsed */}
        {doc.toc?.length > 0 && (
          <Section icon={List} title="Document Structure" defaultOpen={false}>
            <div className="space-y-1">
              {doc.toc.map((entry, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (entry.page && onOpenPdf) onOpenPdf()
                  }}
                  className="flex items-center justify-between w-full text-left px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/5 group"
                >
                  <span className="text-[12px] truncate" style={{ color: palette.textSecondary }}>
                    {entry.title}
                  </span>
                  {entry.page && (
                    <span className="text-[10px] flex-shrink-0 ml-2" style={{ color: palette.textMuted }}>
                      p.{entry.page}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Key Findings — collapsed by default */}
        {doc.keyFindings?.length > 0 && (
          <Section icon={Lightbulb} title="Key Findings" defaultOpen={false}>
            <ul className="space-y-1.5">
              {doc.keyFindings.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: palette.textSecondary }}>
                  <span
                    className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold mt-0.5"
                    style={{ background: 'rgba(29,155,240,0.12)', color: palette.primary }}
                  >
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{f}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Important Terms — collapsed by default */}
        {doc.terms?.length > 0 && (
          <Section icon={Layers} title="Key Terms" defaultOpen={false}>
            <div className="space-y-1.5">
              {doc.terms.map((t, i) => {
                const parts = t.split('—')
                const term = parts[0]?.trim()
                const def = parts.slice(1).join('—').trim()
                return (
                  <div key={i} className="text-[12px] px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(29,155,240,0.04)' }}>
                    <span className="font-semibold" style={{ color: palette.primary }}>{term}</span>
                    {def && <span style={{ color: palette.textMuted }}> — {def}</span>}
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* Themes — collapsed by default */}
        {doc.themes?.length > 0 && (
          <Section icon={Tag} title="Key Themes" defaultOpen={false}>
            <div className="flex flex-wrap gap-1.5">
              {doc.themes.map((t, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2.5 py-1 rounded-full"
                  style={{
                    background: 'rgba(29,155,240,0.08)',
                    color: palette.textSecondary,
                    border: '1px solid rgba(29,155,240,0.15)',
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Key Entities — collapsed by default */}
        {doc.entities?.length > 0 && (
          <Section icon={Users} title="Key Entities" defaultOpen={false}>
            <p className="text-[12px] leading-relaxed" style={{ color: palette.textMuted }}>
              {doc.entities.join(' · ')}
            </p>
          </Section>
        )}
      </div>
    </div>
  )
}
