import { useMemo, useRef, useEffect } from 'react'
import { marked } from 'marked'
import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'

marked.setOptions({ breaks: true, gfm: true })

export default function Message({ role, text }) {
  const contentRef = useRef(null)

  const html = useMemo(() => {
    if (role === 'user' || !text) return ''
    return marked.parse(text)
  }, [role, text])

  // Render math after HTML update
  useEffect(() => {
    if (role === 'bot' && contentRef.current && text) {
      try {
        renderMathInElement(contentRef.current, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          throwOnError: false,
        })
      } catch {}
    }
  }, [role, html])

  if (role === 'user') {
    return (
      <div className="flex gap-3 py-4 animate-msg">
        <div className="w-7 h-7 rounded-full bg-[#10a37f] flex items-center justify-center text-xs text-white shrink-0 mt-0.5">
          U
        </div>
        <div className="flex-1">
          <div className="font-semibold text-xs mb-1.5 text-[#9b9b9b]">You</div>
          <div className="inline-block bg-[#2f2f2f] rounded-2xl px-4 py-2.5 text-[.95rem] leading-relaxed max-w-[85%]">
            {text}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 py-4 animate-msg border-t border-[#2f2f2f] first:border-0">
      <div className="w-7 h-7 rounded-full bg-[#2f2f2f] flex items-center justify-center text-xs shrink-0 mt-0.5">
        ✦
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-xs mb-1.5 text-[#9b9b9b]">CBSE Tutor</div>
        <div
          ref={contentRef}
          className="msg-md text-[.95rem] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
