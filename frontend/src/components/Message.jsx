import { useRef, useEffect, useState } from 'react'
import { marked } from 'marked'
import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'

marked.setOptions({ breaks: true, gfm: true })

export default function Message({ role, text, streaming }) {
  const contentRef = useRef(null)
  const renderTimer = useRef(null)
  const textRef = useRef(text || '')
  const displayTextRef = useRef('')

  // Typewriter: gradually reveal characters during streaming
  const [displayLen, setDisplayLen] = useState(text?.length || 0)

  useEffect(() => {
    textRef.current = text || ''
    if (role !== 'bot' || !streaming) {
      setDisplayLen(text?.length || 0)
    }
  }, [text, streaming, role])

  useEffect(() => {
    if (role !== 'bot' || !streaming) return
    const timer = setInterval(() => {
      setDisplayLen(prev => {
        const target = textRef.current.length
        if (prev >= target) return prev
        const gap = target - prev
        const step = gap > 80 ? Math.ceil(gap * 0.08) : 2
        return Math.min(prev + step, target)
      })
    }, 18)
    return () => clearInterval(timer)
  }, [streaming, role])

  const displayText = (role === 'bot') ? (text || '').slice(0, displayLen) : (text || '')
  displayTextRef.current = displayText

  // Throttled markdown rendering
  const [renderedHtml, setRenderedHtml] = useState('')

  useEffect(() => {
    if (role === 'user' || !displayText) {
      setRenderedHtml('')
      return
    }
    if (!streaming) {
      setRenderedHtml(marked.parse(displayText))
      return
    }
    if (!renderTimer.current) {
      renderTimer.current = setTimeout(() => {
        renderTimer.current = null
        setRenderedHtml(marked.parse(displayTextRef.current))
      }, 50)
    }
  }, [displayText, streaming, role])

  useEffect(() => {
    return () => {
      if (renderTimer.current) {
        clearTimeout(renderTimer.current)
        renderTimer.current = null
      }
    }
  }, [])

  // KaTeX — only after streaming ends
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
        {streaming && <span className="typing-cursor" />}
      </div>
    </div>
  )
}
