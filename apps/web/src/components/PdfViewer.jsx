import { useState, useRef, useCallback, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, X, Maximize2, Minimize2 } from 'lucide-react'
import { palette } from '@cbse/shared'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

const normalize = (s) => s.toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim()

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

  // Highlight function — finds and highlights the FULL source text in PDF
  const scheduleHighlight = useCallback(() => {
    if (!targetSnippet) { console.log('[Highlight] no targetSnippet'); return }
    console.log('[Highlight] scheduling for page:', targetPage, 'snippet:', targetSnippet?.slice(0, 60))

    // Cancel any pending timers from previous highlight
    clearHighlightTimers()

    const tryHighlight = () => {
      const container = scrollContainerRef.current
      if (!container) { console.log('[Highlight] no container'); return false }

      // Remove ALL previous highlights
      container.querySelectorAll('.pdf-highlight').forEach(el => {
        el.classList.remove('pdf-highlight')
      })

      const snippetNorm = normalize(targetSnippet)
      const snippetWords = snippetNorm.split(/\s+/).filter(Boolean)
      if (snippetWords.length === 0) { console.log('[Highlight] no snippet words'); return false }

      // Try target page first, then adjacent pages
      const pagesToTry = [targetPage]
      if (targetPage > 1) pagesToTry.push(targetPage - 1)
      if (numPages && targetPage < numPages) pagesToTry.push(targetPage + 1)

      for (const pageNum of pagesToTry) {
        const pageEl = pageRefs.current[pageNum]
        if (!pageEl) continue

        const textSpans = Array.from(
          pageEl.querySelectorAll('.react-pdf__Page__textContent span')
        ).filter(s => s.textContent.trim().length > 0)

        if (textSpans.length === 0) continue

        // Build combined text from all spans on this page to find the source range
        const spanTexts = textSpans.map(s => normalize(s.textContent))

        // Strategy: find the START of the source text using first N words,
        // then find the END using last N words, highlight everything between
        const findPosition = (searchWords, startFrom = 0) => {
          const searchStr = searchWords.join(' ')
          for (let i = startFrom; i < textSpans.length; i++) {
            let combined = ''
            for (let j = i; j < Math.min(i + 40, textSpans.length); j++) {
              combined += (combined ? ' ' : '') + spanTexts[j]
              if (combined.includes(searchStr)) return { start: i, end: j }
            }
          }
          return null
        }

        // Find start position using first 5-8 words
        let startPos = null
        for (const n of [8, 6, 5, 3]) {
          if (n > snippetWords.length) continue
          startPos = findPosition(snippetWords.slice(0, n))
          if (startPos) break
        }
        if (!startPos) continue

        // Find end position using last 5-8 words (searching from startPos)
        let endIdx = startPos.end
        if (snippetWords.length > 10) {
          for (const n of [8, 6, 5, 3]) {
            if (n > snippetWords.length) continue
            const endPos = findPosition(snippetWords.slice(-n), startPos.start)
            if (endPos && endPos.end >= startPos.start) {
              endIdx = endPos.end
              break
            }
          }
        }

        // Highlight all spans between start and end
        console.log('[Highlight] highlighting spans', startPos.start, 'to', endIdx, 'on page', pageNum)
        for (let k = startPos.start; k <= endIdx; k++) {
          textSpans[k].classList.add('pdf-highlight')
        }
        textSpans[startPos.start].scrollIntoView({ behavior: 'smooth', block: 'center' })
        return true
      }

      console.log('[Highlight] could not find text on any page')
      return false
    }

    // Retry with delays for text layer to render
    let attempt = 0
    const delays = [600, 1200, 2000, 3000]
    const run = () => {
      console.log('[Highlight] attempt', attempt)
      const found = tryHighlight()
      if (!found && attempt < delays.length - 1) {
        attempt++
        const tid = setTimeout(run, delays[attempt])
        highlightTimersRef.current.push(tid)
      }
    }
    const firstTimer = setTimeout(run, delays[0])
    highlightTimersRef.current.push(firstTimer)
  }, [targetSnippet, targetPage, targetRequestId, numPages])

  // Scroll to target page + highlight when citation clicked
  useEffect(() => {
    if (!targetPage || !targetRequestId || !numPages) return
    console.log('[PdfViewer Effect] target page:', targetPage, 'requestId:', targetRequestId, 'snippet:', targetSnippet?.slice(0, 40))

    // Cancel any pending highlight timers from previous clicks
    clearHighlightTimers()

    const scrollToPage = () => {
      const pageEl = pageRefs.current[targetPage]
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return true
      }
      return false
    }

    // Wait for page element to exist, then scroll
    const scrollTimer = setTimeout(() => {
      scrollToPage()
      // After scrolling, attempt highlight
      if (targetSnippet) {
        scheduleHighlight()
      }
    }, 300)
    highlightTimersRef.current.push(scrollTimer)

    return () => {
      clearHighlightTimers()
    }
  }, [targetPage, targetSnippet, targetRequestId, numPages, scheduleHighlight])

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
