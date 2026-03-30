import { useMemo, useRef, useEffect, useState } from 'react'
import { marked } from 'marked'
import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'

marked.setOptions({ breaks: true, gfm: true })

export default function Message({ role, text, streaming }) {
  const contentRef = useRef(null)
  const [renderedHtml, setRenderedHtml] = useState('')
  const renderTimer = useRef(null)
  const lastRenderedText = useRef('')

  // Throttle markdown parsing during streaming — render at most every 80ms
  useEffect(() => {
    if (role === 'user' || !text) {
      setRenderedHtml('')
      return
    }

    if (!streaming) {
      // Final render — immediate
      setRenderedHtml(marked.parse(text))
      lastRenderedText.current = text
      return
    }

    // During streaming, throttle renders
    if (!renderTimer.current) {
      renderTimer.current = setTimeout(() => {
        renderTimer.current = null
        if (lastRenderedText.current !== text) {
          setRenderedHtml(marked.parse(text))
          lastRenderedText.current = text
        }
      }, 80)
    }

    return () => {
      if (renderTimer.current) {
        clearTimeout(renderTimer.current)
        renderTimer.current = null
      }
    }
  }, [role, text, streaming])

  // Run KaTeX only when streaming stops (final render)
  useEffect(() => {
    if (role === 'bot' && contentRef.current && text && !streaming) {
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
  }, [role, streaming, renderedHtml])

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
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>
    </div>
  )
}
