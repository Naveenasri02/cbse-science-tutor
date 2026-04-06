import { useState, useRef, useCallback, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, X, Maximize2, Minimize2 } from 'lucide-react'
import { palette } from '@cbse/shared'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

const normalize = (s) => s.toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()

export default function PdfViewer({ fileUrl, fileType, filename, targetPage, targetSnippet, targetRequestId, onClose }) {
  const [numPages, setNumPages] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const scrollContainerRef = useRef(null)
  const pageRefs = useRef({})
  const observerRef = useRef(null)
  const highlightTimersRef = useRef([])
  const highlightGenRef = useRef(0)

  // Cancel all pending highlight timers
  const clearHighlightTimers = () => {
    highlightTimersRef.current.forEach(id => clearTimeout(id))
    highlightTimersRef.current = []
  }

  const isPdf = fileType === 'application/pdf' || filename?.toLowerCase().endsWith('.pdf')

  // Track current visible page via IntersectionObserver
  useEffect(() => {
    if (!numPages || !scrollContainerRef.current) return
    const root = scrollContainerRef.current

    observerRef.current?.disconnect()
    const obs = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0, visiblePage = currentPage
        entries.forEach(e => {
          if (e.intersectionRatio > maxRatio) {
            maxRatio = e.intersectionRatio
            visiblePage = parseInt(e.target.dataset.page, 10)
          }
        })
        if (maxRatio > 0) setCurrentPage(visiblePage)
      },
      { root, threshold: [0, 0.25, 0.5, 0.75] }
    )
    observerRef.current = obs

    Object.values(pageRefs.current).forEach(el => { if (el) obs.observe(el) })
    return () => obs.disconnect()
  }, [numPages, scale])

  // Clear all existing PDF highlights
  const clearAllHighlights = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    container.querySelectorAll('.pdf-highlight').forEach(el => {
      el.classList.remove('pdf-highlight')
    })
  }, [])

  // Core highlight logic — finds and highlights the source text in PDF
  const tryHighlight = useCallback((snippet, page) => {
    const container = scrollContainerRef.current
    if (!container) return false

    clearAllHighlights()

    const snippetNorm = normalize(snippet)
    const snippetWords = snippetNorm.split(/\s+/).filter(Boolean)
    if (snippetWords.length === 0) return false

    // Ensure page is a number for arithmetic
    const pageNum = Number(page) || 1

    // Try target page, then ±1, then ±2
    const pagesToTry = [pageNum]
    for (const offset of [1, -1, 2, -2]) {
      const p = pageNum + offset
      if (p >= 1 && (!numPages || p <= numPages) && !pagesToTry.includes(p)) {
        pagesToTry.push(p)
      }
    }

    for (const pageNum of pagesToTry) {
      const pageEl = pageRefs.current[pageNum]
      if (!pageEl) continue

      const textSpans = Array.from(
        pageEl.querySelectorAll('.react-pdf__Page__textContent span')
      ).filter(s => s.textContent.trim().length > 0)

      if (textSpans.length === 0) continue

      // Build full page text with character→span index mapping
      const spanNorms = textSpans.map(s => normalize(s.textContent))
      let fullText = ''
      const charToSpan = []

      for (let i = 0; i < spanNorms.length; i++) {
        if (fullText.length > 0 && spanNorms[i].length > 0) {
          charToSpan.push(i)
          fullText += ' '
        }
        for (let c = 0; c < spanNorms[i].length; c++) {
          charToSpan.push(i)
        }
        fullText += spanNorms[i]
      }

      if (fullText.length === 0) continue

      let matchStart = -1
      let matchEnd = -1

      // Strategy 1: Full snippet as substring (most accurate)
      const fullIdx = fullText.indexOf(snippetNorm)
      if (fullIdx !== -1) {
        matchStart = fullIdx
        matchEnd = fullIdx + snippetNorm.length - 1
      }

      // Strategy 2: Progressive prefix matching — try longest first
      if (matchStart === -1) {
        const wordCounts = [
          Math.ceil(snippetWords.length * 0.8),
          Math.ceil(snippetWords.length * 0.6),
          Math.ceil(snippetWords.length * 0.4),
          Math.min(10, snippetWords.length),
          Math.min(7, snippetWords.length),
          Math.min(5, snippetWords.length),
        ]
        for (const wc of wordCounts) {
          if (wc < 3) continue
          const searchStr = snippetWords.slice(0, wc).join(' ')
          const idx = fullText.indexOf(searchStr)
          if (idx !== -1) {
            matchStart = idx
            matchEnd = idx + searchStr.length - 1
            if (snippetWords.length > wc + 3) {
              for (const endWc of [8, 5, 3].map(n => Math.min(n, snippetWords.length))) {
                if (endWc < 3) continue
                const endStr = snippetWords.slice(-endWc).join(' ')
                const endIdx = fullText.indexOf(endStr, matchStart)
                if (endIdx !== -1 && endIdx >= matchStart) {
                  const candidateEnd = endIdx + endStr.length - 1
                  if (candidateEnd - matchStart <= snippetNorm.length * 1.5) {
                    matchEnd = candidateEnd
                    break
                  }
                }
              }
            }
            break
          }
        }
      }

      // Strategy 3: Suffix matching as last resort
      if (matchStart === -1) {
        const wordCounts = [
          Math.ceil(snippetWords.length * 0.6),
          Math.ceil(snippetWords.length * 0.4),
          Math.min(8, snippetWords.length),
          Math.min(5, snippetWords.length),
        ]
        for (const wc of wordCounts) {
          if (wc < 3) continue
          const searchStr = snippetWords.slice(-wc).join(' ')
          const idx = fullText.indexOf(searchStr)
          if (idx !== -1) {
            matchStart = idx
            matchEnd = idx + searchStr.length - 1
            break
          }
        }
      }

      if (matchStart === -1 || matchEnd === -1) continue

      matchEnd = Math.min(matchEnd, charToSpan.length - 1)
      if (matchStart >= charToSpan.length) continue

      const startSpanIdx = charToSpan[matchStart]
      const endSpanIdx = charToSpan[matchEnd]
      if (startSpanIdx === undefined || endSpanIdx === undefined) continue

      const hlCount = endSpanIdx - startSpanIdx + 1
      if (hlCount > textSpans.length * 0.6) {
        console.log('[Highlight] match too large (' + hlCount + '/' + textSpans.length + '), skipping false positive')
        continue
      }

      console.log('[Highlight] highlighting spans', startSpanIdx, 'to', endSpanIdx, 'on page', pageNum)
      for (let k = startSpanIdx; k <= endSpanIdx; k++) {
        textSpans[k].classList.add('pdf-highlight')
      }
      textSpans[startSpanIdx].scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }

    console.log('[Highlight] no match found on any page')
    return false
  }, [numPages, clearAllHighlights])

  // Scroll to target page + highlight when citation clicked
  // Uses targetRequestId (timestamp) to guarantee re-trigger on every click
  useEffect(() => {
    if (!targetPage || !targetRequestId || !numPages) return
    console.log('[PdfViewer Effect] target page:', targetPage, 'requestId:', targetRequestId, 'snippet:', targetSnippet?.slice(0, 40))

    clearHighlightTimers()
    clearAllHighlights()

    const genId = ++highlightGenRef.current

    const scrollToPage = () => {
      const pageEl = pageRefs.current[targetPage]
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return true
      }
      return false
    }

    // Retry with progressive delays (text layer may still be rendering)
    const delays = [200, 400, 800, 1400, 2500]
    let attempt = 0

    const runHighlight = () => {
      if (highlightGenRef.current !== genId) return
      console.log('[Highlight] attempt', attempt, 'for requestId:', targetRequestId)
      scrollToPage()
      if (targetSnippet) {
        const found = tryHighlight(targetSnippet, targetPage)
        if (!found && attempt < delays.length - 1) {
          attempt++
          const tid = setTimeout(runHighlight, delays[attempt])
          highlightTimersRef.current.push(tid)
        }
      }
    }

    const firstTimer = setTimeout(runHighlight, delays[0])
    highlightTimersRef.current.push(firstTimer)

    return () => {
      clearHighlightTimers()
    }
  }, [targetPage, targetSnippet, targetRequestId, numPages, tryHighlight, clearAllHighlights])

  const onDocumentLoadSuccess = useCallback(({ numPages: n }) => {
    setNumPages(n)
    setLoading(false)
  }, [])

  const goToPage = (page) => {
    if (page >= 1 && page <= numPages) {
      const pageEl = pageRefs.current[page]
      if (pageEl) pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const zoomIn = () => setScale(s => Math.min(s + 0.2, 2.5))
  const zoomOut = () => setScale(s => Math.max(s - 0.2, 0.5))

  if (!fileUrl) return null

  if (!isPdf) {
    return (
      <div className="h-full flex flex-col" style={{ background: palette.panel }}>
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: palette.border }}>
          <span className="text-[13px] font-medium truncate" style={{ color: palette.textPrimary }}>
            {filename || 'Document'}
          </span>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-white/5" style={{ color: palette.textMuted }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-[13px] text-center" style={{ color: palette.textMuted }}>
            Preview is available for PDF files only.<br />
            This document has been analyzed and you can ask questions about it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`h-full flex flex-col ${expanded ? 'fixed inset-0 z-50' : ''}`}
      style={{ background: palette.panel }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
        style={{ borderColor: palette.border, background: palette.bg }}
      >
        <span className="text-[12px] font-medium truncate max-w-[140px]" style={{ color: palette.textPrimary }} title={filename}>
          {filename || 'Document'}
        </span>

        <div className="flex items-center gap-1">
          {/* Page jump */}
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="p-1 rounded disabled:opacity-30"
            style={{ color: palette.textMuted }}
          >
            <ChevronUp size={14} />
          </button>
          <span className="text-[11px] min-w-[60px] text-center" style={{ color: palette.textSecondary }}>
            {currentPage} / {numPages || '…'}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            className="p-1 rounded disabled:opacity-30"
            style={{ color: palette.textMuted }}
          >
            <ChevronDown size={14} />
          </button>

          <div className="w-px h-4 mx-1" style={{ background: palette.border }} />

          {/* Zoom */}
          <button onClick={zoomOut} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}>
            <ZoomOut size={14} />
          </button>
          <span className="text-[10px] min-w-[36px] text-center" style={{ color: palette.textMuted }}>
            {Math.round(scale * 100)}%
          </span>
          <button onClick={zoomIn} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}>
            <ZoomIn size={14} />
          </button>

          <div className="w-px h-4 mx-1" style={{ background: palette.border }} />

          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-white/5"
            style={{ color: palette.textMuted }}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* PDF content — ALL pages rendered, scrollable */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto pdf-scroll" style={{ background: '#1a1a2e' }}>
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-t-transparent" style={{ borderColor: palette.primary, borderTopColor: 'transparent' }} />
          </div>
        )}
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(err) => console.error('PDF load error:', err)}
          loading=""
        >
          {numPages && Array.from({ length: numPages }, (_, i) => (
            <div
              key={i + 1}
              data-page={i + 1}
              ref={el => { pageRefs.current[i + 1] = el }}
              className="flex justify-center py-2"
            >
              <Page
                pageNumber={i + 1}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                loading=""
              />
            </div>
          ))}
        </Document>
      </div>
    </div>
  )
}
