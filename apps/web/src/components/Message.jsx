import { useRef, useEffect, useState } from 'react'
import { marked } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { palette } from '@cbse/shared'

marked.setOptions({ breaks: true, gfm: true })

// Strip <think>...</think> reasoning traces from LLM output
function stripThinkBlocks(text) {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
}

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
    const raw = placeholders[parseInt(idx)] || ''
    if (!raw) return ''
    // Determine display vs inline and extract math content
    const isDisplay = raw.startsWith('$$') || raw.startsWith('\\[')
    let math = raw
    if (raw.startsWith('$$')) math = raw.slice(2, -2)
    else if (raw.startsWith('\\[')) math = raw.slice(2, -2)
    else if (raw.startsWith('$')) math = raw.slice(1, -1)
    else if (raw.startsWith('\\(')) math = raw.slice(2, -2)
    try {
      return katex.renderToString(math.trim(), { displayMode: isDisplay, throwOnError: false })
    } catch {
      return raw
    }
  })
}

// Convert inline citation references like [1], [2] into styled clickable citation chips
function renderCitations(html) {
  // Match [N] patterns (but not inside href or src attributes, and not [Source:...])
  return html.replace(/\[(\d{1,2})\]/g, (match, num) => {
    return `<span class="citation-chip" data-ref="${num}" title="Jump to Source [${num}]" role="button" tabindex="0">[${num}]</span>`
  })
}

// Add id attributes to source entries in the Sources footer so citations can scroll to them
function addSourceIds(html) {
  // Match patterns like "[1] filename" in the Sources section
  return html.replace(/\[(\d{1,2})\]\s/g, (match, num) => {
    return `<span id="source-ref-${num}" class="source-entry">[${num}] </span>`
  })
}

export default function Message({ role, text, streaming, onCitationClick, sources }) {
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

  // Strip "Sources:" footer block from bot responses (e.g., "---\nSources:\n[1] ...")
  const stripSourcesFooter = (md) => md.replace(/\n*-{2,}\s*\n\s*\*{0,2}Sources:?\*{0,2}\s*\n[\s\S]*$/i, '').replace(/\n\s*\*{0,2}Sources:?\*{0,2}\s*\n\s*\[[\s\S]*$/i, '')

  const displayText = (role === 'bot') ? stripSourcesFooter(stripThinkBlocks((text || '').slice(0, displayLen))) : (text || '')
  displayTextRef.current = displayText

  // Ensure markdown headers/lists have preceding newlines for proper parsing
  const fixMarkdown = (md) => md
    .replace(/([^\n])(#{1,4}\s)/g, '$1\n$2')
    .replace(/([^\n])(\n?- \*\*)/g, '$1\n$2')

  const parseWithLatex = (md) => {
    const fixed = fixMarkdown(md)
    const { result, placeholders } = protectLatex(fixed)
    let html = marked.parse(result)
    html = restoreLatex(html, placeholders)
    html = renderCitations(html)
    return html
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

  // Keep stable refs so delegation handler never goes stale
  const onCitationClickRef = useRef(onCitationClick)
  useEffect(() => { onCitationClickRef.current = onCitationClick }, [onCitationClick])
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  // Event delegation for citation clicks — survives DOM changes from KaTeX
  useEffect(() => {
    if (role !== 'bot') return
    const container = contentRef.current
    if (!container) return

    const handler = (e) => {
      const chip = e.target.closest('.citation-chip[data-ref]')
      if (!chip) return
      e.preventDefault()
      e.stopPropagation()
      const ref = parseInt(chip.getAttribute('data-ref'), 10)
      if (onCitationClickRef.current) {
        const rect = chip.getBoundingClientRect()
        // Extract surrounding sentence/paragraph for accurate PDF highlighting
        const block = chip.closest('p, li, td, blockquote') || chip.parentElement
        const contextText = (block?.textContent || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim()
        onCitationClickRef.current(ref, { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }, sourcesRef.current, contextText)
      }
    }

    container.addEventListener('click', handler)
    return () => container.removeEventListener('click', handler)
  }, [role])

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
