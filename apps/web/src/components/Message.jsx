import { useRef, useEffect, useState } from 'react'
import { marked } from 'marked'
import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'
import { palette } from '@cbse/shared'

marked.setOptions({ breaks: true, gfm: true })

// Protect LaTeX blocks from markdown parsing by replacing them with placeholders
function protectLatex(md) {
  const placeholders = []
  // Protect display math $$...$$ and \[...\]
  let result = md.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, (match) => {
    placeholders.push(match)
    return `%%LATEX_${placeholders.length - 1}%%`
  })
  // Protect inline math $...$ and \(...\)
  result = result.replace(/\$[^$\n]+?\$|\\\(.*?\\\)/g, (match) => {
    placeholders.push(match)
    return `%%LATEX_${placeholders.length - 1}%%`
  })
  return { result, placeholders }
}

function restoreLatex(html, placeholders) {
  return html.replace(/%%LATEX_(\d+)%%/g, (_, idx) => {
    return placeholders[parseInt(idx)] || ''
  })
}

export default function Message({ role, text, streaming }) {
  const contentRef = useRef(null)
  const renderTimer = useRef(null)
  const textRef = useRef(text || '')
  const displayTextRef = useRef('')

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

  // Ensure markdown headers/lists have preceding newlines for proper parsing
  const fixMarkdown = (md) => md
    .replace(/([^\n])(#{1,4}\s)/g, '$1\n$2')
    .replace(/([^\n])(\n?- \*\*)/g, '$1\n$2')

  const parseWithLatex = (md) => {
    const fixed = fixMarkdown(md)
    const { result, placeholders } = protectLatex(fixed)
    const html = marked.parse(result)
    return restoreLatex(html, placeholders)
  }

  const [renderedHtml, setRenderedHtml] = useState('')

  useEffect(() => {
    if (role === 'user' || !displayText) {
      setRenderedHtml('')
      return
    }
    if (!streaming) {
      setRenderedHtml(parseWithLatex(displayText))
      return
    }
    if (!renderTimer.current) {
      renderTimer.current = setTimeout(() => {
        renderTimer.current = null
        setRenderedHtml(parseWithLatex(displayTextRef.current))
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

  // Render KaTeX — both during streaming and after
  useEffect(() => {
    if (role === 'bot' && contentRef.current && renderedHtml) {
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
  }, [role, renderedHtml])

  if (role === 'user') {
    return (
      <div className="flex justify-end animate-msg">
        <div
          className="max-w-[88%] md:max-w-[80%] rounded-[20px] px-4 py-2.5 text-base md:text-[15px] leading-[1.6]"
          style={{ background: palette.primary, color: 'white' }}
        >
          {text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start animate-msg">
      <div
        className="max-w-[88%] md:max-w-[80%] rounded-[20px] px-4 py-2.5 text-base md:text-[15px] leading-[1.6]"
        style={{ background: palette.panelAlt, color: palette.textSecondary, border: `1px solid ${palette.border}` }}
      >
        <div
          ref={contentRef}
          className="msg-md"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
        {streaming && <span className="typing-cursor" />}
      </div>
    </div>
  )
}
