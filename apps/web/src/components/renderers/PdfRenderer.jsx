import { useState, useRef, useCallback, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react'
import { palette } from '@cbse/shared'
import { ViewerToolbar } from './highlightUtils'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

const normalize = (s) => s.normalize('NFKD').toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()

export default function PdfRenderer({ fileUrl, filename, targetPage, targetPageEnd, targetSnippet, targetFallbackSnippet, targetRequestId, onClose }) {
  const [numPages, setNumPages] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return Math.round(Math.max(0.5, (window.innerWidth - 32) / 612) * 10) / 10
    }
    return 1.0
  })
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const scrollContainerRef = useRef(null)
  const pageRefs = useRef({})
  const observerRef = useRef(null)
  const highlightTimersRef = useRef([])
  const highlightGenRef = useRef(0)

  const clearHighlightTimers = () => {
    highlightTimersRef.current.forEach(id => clearTimeout(id))
    highlightTimersRef.current = []
  }

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

  const clearAllHighlights = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    container.querySelectorAll('.pdf-highlight').forEach(el => {
      el.classList.remove('pdf-highlight')
    })
  }, [])

  const tryHighlight = useCallback((snippet, page, pageEnd) => {
    const container = scrollContainerRef.current
    if (!container) return false
    clearAllHighlights()
    const snippetNorm = normalize(snippet)
    const snippetWords = snippetNorm.split(/\s+/).filter(Boolean)
    if (snippetWords.length === 0) return false

    const pageNum = Number(page) || 1
    const lastPage = Number(pageEnd) || pageNum
    const pagesToTry = []
    for (let p = pageNum; p <= lastPage; p++) {
      if (p >= 1 && (!numPages || p <= numPages)) pagesToTry.push(p)
    }
    for (const pad of [pageNum - 1, lastPage + 1, pageNum - 2, lastPage + 2]) {
      if (pad >= 1 && (!numPages || pad <= numPages) && !pagesToTry.includes(pad)) pagesToTry.push(pad)
    }

    for (const tryPage of pagesToTry) {
      const pageEl = pageRefs.current[tryPage]
      if (!pageEl) continue
      const textSpans = Array.from(pageEl.querySelectorAll('.react-pdf__Page__textContent span')).filter(s => s.textContent.trim().length > 0)
      if (textSpans.length === 0) continue

      const spanNorms = textSpans.map(s => normalize(s.textContent))
      let fullText = ''
      const charToSpan = []
      for (let i = 0; i < spanNorms.length; i++) {
        if (fullText.length > 0 && spanNorms[i].length > 0) { charToSpan.push(i); fullText += ' ' }
        for (let c = 0; c < spanNorms[i].length; c++) charToSpan.push(i)
        fullText += spanNorms[i]
      }
      if (fullText.length === 0) continue

      let matchStart = -1, matchEnd = -1

      // Strategy 1: Full substring
      const fullIdx = fullText.indexOf(snippetNorm)
      if (fullIdx !== -1) { matchStart = fullIdx; matchEnd = fullIdx + snippetNorm.length - 1 }

      // Strategy 2: Anchor-based
      if (matchStart === -1) {
        for (const phraseLen of [4, 3]) {
          if (snippetWords.length < phraseLen) continue
          const maxStart = snippetWords.length - phraseLen
          const positions = new Set()
          for (let s = 0; s <= Math.min(4, maxStart); s++) positions.add(s)
          for (let s = 0; s <= Math.min(4, maxStart); s++) positions.add(maxStart - s)
          for (const frac of [0.2, 0.35, 0.5, 0.65, 0.8]) positions.add(Math.round(maxStart * frac))
          const sorted = [...positions].sort((a, b) => a - b)
          const anchors = sorted.map(pos => ({ phrase: snippetWords.slice(pos, pos + phraseLen).join(' '), pos }))
          const found = []
          for (const anchor of anchors) {
            const idx = fullText.indexOf(anchor.phrase)
            if (idx !== -1) found.push({ start: idx, end: idx + anchor.phrase.length - 1, snippetPos: anchor.pos })
          }
          const minRequired = snippetWords.length <= 15 ? 1 : 2
          if (found.length >= minRequired) {
            const candidateStart = Math.min(...found.map(f => f.start))
            const candidateEnd = Math.max(...found.map(f => f.end))
            const rangeLen = candidateEnd - candidateStart + 1
            if (rangeLen <= snippetNorm.length * 3 && rangeLen <= fullText.length * 0.8) {
              matchStart = candidateStart; matchEnd = candidateEnd; break
            }
          }
        }
      }

      // Strategy 3: Spaceless matching
      if (matchStart === -1) {
        const spacelessSnippet = snippetNorm.replace(/\s+/g, '')
        if (spacelessSnippet.length >= 15) {
          for (const len of [60, 40, 25]) {
            const probe = spacelessSnippet.slice(0, Math.min(len, spacelessSnippet.length))
            if (probe.length < 15) continue
            let spacelessFull = '', spacelessToOrigIdx = []
            for (let ci = 0; ci < fullText.length; ci++) {
              if (fullText[ci] !== ' ') { spacelessToOrigIdx.push(ci); spacelessFull += fullText[ci] }
            }
            const sIdx = spacelessFull.indexOf(probe)
            if (sIdx !== -1) {
              matchStart = spacelessToOrigIdx[sIdx]
              const endProbe = spacelessSnippet.length <= spacelessFull.length - sIdx ? spacelessSnippet : spacelessSnippet.slice(0, spacelessFull.length - sIdx)
              const endPos = sIdx + endProbe.length - 1
              matchEnd = endPos < spacelessToOrigIdx.length ? spacelessToOrigIdx[endPos] : spacelessToOrigIdx[spacelessToOrigIdx.length - 1]
              break
            }
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
      if (hlCount > textSpans.length * 0.8) continue

      for (let k = startSpanIdx; k <= endSpanIdx; k++) textSpans[k].classList.add('pdf-highlight')
      textSpans[startSpanIdx].scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }
    return false
  }, [numPages, clearAllHighlights])

  useEffect(() => {
    if (!targetPage || !targetRequestId || !numPages) return
    clearHighlightTimers()
    clearAllHighlights()
    const genId = ++highlightGenRef.current
    const scrollToPage = () => {
      const pageEl = pageRefs.current[targetPage]
      if (pageEl) { pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); return true }
      return false
    }
    const delays = [200, 400, 800, 1400, 2500, 4000]
    let attempt = 0, triedFallback = false
    const runHighlight = () => {
      if (highlightGenRef.current !== genId) return
      scrollToPage()
      if (targetSnippet) {
        const found = tryHighlight(targetSnippet, targetPage, targetPageEnd)
        if (!found && attempt < delays.length - 1) { attempt++; highlightTimersRef.current.push(setTimeout(runHighlight, delays[attempt])) }
        else if (!found && !triedFallback && targetFallbackSnippet) {
          triedFallback = true; attempt = 0
          const fallbackFound = tryHighlight(targetFallbackSnippet, targetPage, targetPageEnd)
          if (!fallbackFound) highlightTimersRef.current.push(setTimeout(() => { if (highlightGenRef.current === genId) tryHighlight(targetFallbackSnippet, targetPage, targetPageEnd) }, 800))
        }
      }
    }
    highlightTimersRef.current.push(setTimeout(runHighlight, delays[0]))
    return () => clearHighlightTimers()
  }, [targetPage, targetPageEnd, targetSnippet, targetFallbackSnippet, targetRequestId, numPages, tryHighlight, clearAllHighlights])

  const onDocumentLoadSuccess = useCallback(({ numPages: n }) => { setNumPages(n); setLoading(false) }, [])
  const goToPage = (page) => { if (page >= 1 && page <= numPages) pageRefs.current[page]?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const zoomIn = () => setScale(s => Math.min(s + 0.2, 2.5))
  const zoomOut = () => setScale(s => Math.max(s - 0.2, 0.5))

  return (
    <div className={`h-full flex flex-col ${expanded ? 'fixed inset-0 z-50' : ''}`} style={{ background: palette.panel }}>
      <ViewerToolbar filename={filename} onClose={onClose} expanded={expanded} onToggleExpand={() => setExpanded(!expanded)}>
        <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="p-1 rounded disabled:opacity-30" style={{ color: palette.textMuted }}><ChevronUp size={14} /></button>
        <span className="text-[11px] min-w-[60px] text-center" style={{ color: palette.textSecondary }}>{currentPage} / {numPages || '…'}</span>
        <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-1 rounded disabled:opacity-30" style={{ color: palette.textMuted }}><ChevronDown size={14} /></button>
        <div className="w-px h-4 mx-1" style={{ background: palette.border }} />
        <button onClick={zoomOut} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}><ZoomOut size={14} /></button>
        <span className="text-[10px] min-w-[36px] text-center" style={{ color: palette.textMuted }}>{Math.round(scale * 100)}%</span>
        <button onClick={zoomIn} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}><ZoomIn size={14} /></button>
      </ViewerToolbar>

      <div ref={scrollContainerRef} className="flex-1 overflow-auto pdf-scroll" style={{ background: '#1a1a2e' }}>
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-t-transparent" style={{ borderColor: palette.primary, borderTopColor: 'transparent' }} />
          </div>
        )}
        <Document file={fileUrl} onLoadSuccess={onDocumentLoadSuccess} onLoadError={(err) => console.error('PDF load error:', err)} loading="">
          {numPages && Array.from({ length: numPages }, (_, i) => (
            <div key={i + 1} data-page={i + 1} ref={el => { pageRefs.current[i + 1] = el }} className="flex justify-center py-2">
              <Page pageNumber={i + 1} scale={scale} renderTextLayer={true} renderAnnotationLayer={true} loading="" />
            </div>
          ))}
        </Document>
      </div>
    </div>
  )
}
