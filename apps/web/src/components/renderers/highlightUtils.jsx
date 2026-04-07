import { palette } from '@cbse/shared'

/**
 * Normalize text for comparison — NFKD decomposition, lowercase, collapse whitespace.
 * Mirrors PdfRenderer's normalize exactly.
 */
export const normalize = (s) =>
  s.normalize('NFKD').toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Core highlighting engine — mirrors PdfRenderer's tryHighlight exactly.
 * Operates on an array of DOM text nodes just like PDF operates on text layer spans.
 *
 * 1. Normalize each node individually (like spanNorms)
 * 2. Build fullText from normalized nodes with charToNode mapping
 * 3. Apply 3 strategies: full match → anchor-based → spaceless
 * 4. Map back to DOM nodes, add highlight class
 */
function tryHighlightNodes(textNodes, snippet, { className = 'doc-highlight', scrollTo = true } = {}) {
  if (!textNodes.length || !snippet) return false

  const snippetNorm = normalize(snippet)
  const snippetWords = snippetNorm.split(/\s+/).filter(Boolean)
  if (snippetWords.length === 0) return false

  // Normalize each node individually (mirrors PdfRenderer's spanNorms)
  const nodeNorms = textNodes.map(n => normalize(n.textContent))

  // Build fullText from normalized nodes with charToNode mapping (mirrors charToSpan)
  let fullText = ''
  const charToNode = []
  for (let i = 0; i < nodeNorms.length; i++) {
    if (fullText.length > 0 && nodeNorms[i].length > 0) {
      charToNode.push(i)
      fullText += ' '
    }
    for (let c = 0; c < nodeNorms[i].length; c++) {
      charToNode.push(i)
    }
    fullText += nodeNorms[i]
  }

  if (fullText.length === 0) return false

  let matchStart = -1, matchEnd = -1

  // Strategy 1: Full snippet as substring (most accurate)
  const fullIdx = fullText.indexOf(snippetNorm)
  if (fullIdx !== -1) {
    matchStart = fullIdx
    matchEnd = fullIdx + snippetNorm.length - 1
  }

  // Strategy 2: Anchor-based — probe start, middle, end
  if (matchStart === -1) {
    for (const phraseLen of [4, 3]) {
      if (snippetWords.length < phraseLen) continue
      const maxStart = snippetWords.length - phraseLen
      const positions = new Set()
      for (let s = 0; s <= Math.min(4, maxStart); s++) positions.add(s)
      for (let s = 0; s <= Math.min(4, maxStart); s++) positions.add(maxStart - s)
      for (const frac of [0.2, 0.35, 0.5, 0.65, 0.8]) positions.add(Math.round(maxStart * frac))
      const sorted = [...positions].sort((a, b) => a - b)
      const anchors = sorted.map(pos => ({
        phrase: snippetWords.slice(pos, pos + phraseLen).join(' '),
        pos
      }))
      const found = []
      for (const anchor of anchors) {
        const idx = fullText.indexOf(anchor.phrase)
        if (idx !== -1) found.push({ start: idx, end: idx + anchor.phrase.length - 1 })
      }
      const minRequired = snippetWords.length <= 15 ? 1 : 2
      if (found.length >= minRequired) {
        const candidateStart = Math.min(...found.map(f => f.start))
        const candidateEnd = Math.max(...found.map(f => f.end))
        const rangeLen = candidateEnd - candidateStart + 1
        if (rangeLen <= snippetNorm.length * 3 && rangeLen <= fullText.length * 0.8) {
          matchStart = candidateStart
          matchEnd = candidateEnd
          break
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
          const endProbe = spacelessSnippet.length <= spacelessFull.length - sIdx
            ? spacelessSnippet : spacelessSnippet.slice(0, spacelessFull.length - sIdx)
          const endPos = sIdx + endProbe.length - 1
          matchEnd = endPos < spacelessToOrigIdx.length ? spacelessToOrigIdx[endPos] : spacelessToOrigIdx[spacelessToOrigIdx.length - 1]
          break
        }
      }
    }
  }

  if (matchStart === -1 || matchEnd === -1) return false

  // Validate bounds
  matchEnd = Math.min(matchEnd, charToNode.length - 1)
  if (matchStart >= charToNode.length) return false

  const startNodeIdx = charToNode[matchStart]
  const endNodeIdx = charToNode[matchEnd]
  if (startNodeIdx === undefined || endNodeIdx === undefined) return false

  // Guard against false positives (highlighting >80% of content)
  const hlCount = endNodeIdx - startNodeIdx + 1
  if (hlCount > textNodes.length * 0.8) return false

  // Apply highlights — wrap each matched text node in a <mark>
  let firstMark = null
  for (let k = startNodeIdx; k <= endNodeIdx; k++) {
    const tNode = textNodes[k]
    if (!tNode?.parentNode) continue
    // Skip if already highlighted
    if (tNode.parentNode.nodeName === 'MARK' && tNode.parentNode.classList.contains(className)) continue

    const mark = document.createElement('mark')
    mark.className = className
    mark.style.cssText = 'background: rgba(29,155,240,0.25); color: inherit; border-radius: 2px; padding: 0 1px;'
    tNode.parentNode.insertBefore(mark, tNode)
    mark.appendChild(tNode)
    if (!firstMark) firstMark = mark
  }

  if (scrollTo && firstMark) {
    firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return true
}

/**
 * Walk all text nodes under `root` and highlight using the 3-strategy engine.
 */
export function highlightTextInDOM(root, snippet, options = {}) {
  if (!root || !snippet) return false

  // Collect all text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  let node
  while ((node = walker.nextNode())) {
    if (node.textContent.trim()) textNodes.push(node)
  }

  return tryHighlightNodes(textNodes, snippet, options)
}

/**
 * Remove all highlight marks from a container.
 */
export function clearHighlights(root, className = 'doc-highlight') {
  if (!root) return
  root.querySelectorAll(`mark.${className}`).forEach(mark => {
    const parent = mark.parentNode
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

/**
 * Highlight with retry mechanism — mirrors PdfRenderer's progressive delay approach.
 * Tries primary snippet first, then fallback snippet.
 * Returns a cleanup function to cancel pending retries.
 */
export function highlightWithRetry(root, snippet, fallbackSnippet, requestId, genRef) {
  const delays = [200, 400, 800, 1400, 2500, 4000]
  const timers = []
  let attempt = 0
  let triedFallback = false
  const genId = ++genRef.current

  const run = () => {
    if (genRef.current !== genId || !root) return
    clearHighlights(root)

    const found = highlightTextInDOM(root, snippet)
    if (!found && attempt < delays.length - 1) {
      attempt++
      timers.push(setTimeout(run, delays[attempt]))
    } else if (!found && !triedFallback && fallbackSnippet) {
      triedFallback = true
      attempt = 0
      const fallbackFound = highlightTextInDOM(root, fallbackSnippet)
      if (!fallbackFound) {
        timers.push(setTimeout(() => {
          if (genRef.current === genId) highlightTextInDOM(root, fallbackSnippet)
        }, 800))
      }
    }
  }

  timers.push(setTimeout(run, delays[0]))

  // Return cleanup function
  return () => { timers.forEach(id => clearTimeout(id)) }
}

/**
 * Shared toolbar component for all renderers.
 */
export function ViewerToolbar({ filename, children, onClose, expanded, onToggleExpand }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
      style={{ borderColor: palette.border, background: palette.bg }}
    >
      <span className="text-[12px] font-medium truncate max-w-[140px]" style={{ color: palette.textPrimary }} title={filename}>
        {filename || 'Document'}
      </span>
      <div className="flex items-center gap-1">
        {children}
        {onToggleExpand && (
          <>
            <div className="w-px h-4 mx-1" style={{ background: palette.border }} />
            <button onClick={onToggleExpand} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}>
              {expanded ? '⊡' : '⊞'}
            </button>
          </>
        )}
        <button onClick={onClose} className="p-1 rounded hover:bg-white/5" style={{ color: palette.textMuted }}>
          ✕
        </button>
      </div>
    </div>
  )
}
