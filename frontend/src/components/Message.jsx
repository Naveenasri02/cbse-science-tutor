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
      <div className="flex justify-end py-2 animate-msg">
        <div className="max-w-[80%] bg-[#303030] rounded-3xl px-5 py-3 text-[.95rem] leading-relaxed text-[#ececf1]">
          {text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 py-2 animate-msg group">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#10a37f] to-[#0d8c6c] flex items-center justify-center text-sm shrink-0 mt-1 shadow-sm">
        ⚛
      </div>
      <div className="flex-1 min-w-0 pt-1">
        <div
          ref={contentRef}
          className="msg-md text-[.95rem] leading-[1.75]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
