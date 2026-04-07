import { palette } from '@cbse/shared'

/**
 * Normalize text for comparison — NFKD decomposition, lowercase, collapse whitespace.
 */
export const normalize = (s) =>
  s.normalize('NFKD').toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Walk all text nodes under `root`, find substring matches for `snippet`,
 * and wrap them with highlighted <mark> elements.
 * Returns true if any match was found.
 */
export function highlightTextInDOM(root, snippet, { scrollTo = true, className = 'doc-highlight' } = {}) {
  if (!root || !snippet) return false

  const snippetNorm = normalize(snippet)
  if (snippetNorm.length < 3) return false

  // Collect all text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  let node
  while ((node = walker.nextNode())) {
    if (node.textContent.trim()) textNodes.push(node)
  }

  // Build combined text with node index mapping
  let fullText = ''
  const charMap = [] // charMap[i] = { nodeIdx, offset }
  for (let ni = 0; ni < textNodes.length; ni++) {
    const t = textNodes[ni].textContent
    for (let ci = 0; ci < t.length; ci++) {
      charMap.push({ nodeIdx: ni, offset: ci })
    }
    if (ni < textNodes.length - 1) {
      charMap.push({ nodeIdx: -1, offset: 0 }) // separator space
      fullText += ' '
    }
    fullText += t
  }

  const fullNorm = normalize(fullText)

  // Try full match
  let matchStart = fullNorm.indexOf(snippetNorm)

  // Try anchor-based matching if full match fails
  if (matchStart === -1) {
    const words = snippetNorm.split(/\s+/).filter(Boolean)
    if (words.length >= 3) {
      for (const phraseLen of [4, 3]) {
        if (words.length < phraseLen) continue
        const anchors = []
        // Start, middle, end anchors
        for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
          const pos = Math.min(Math.round((words.length - phraseLen) * frac), words.length - phraseLen)
          anchors.push(words.slice(pos, pos + phraseLen).join(' '))
        }
        const found = []
        for (const anchor of anchors) {
          const idx = fullNorm.indexOf(anchor)
          if (idx !== -1) found.push({ start: idx, end: idx + anchor.length - 1 })
        }
        if (found.length >= 2) {
          matchStart = Math.min(...found.map(f => f.start))
          break
        }
      }
    }
  }

  if (matchStart === -1) return false

  // Map normalized match back to original positions (approximate)
  const matchEnd = Math.min(matchStart + snippetNorm.length, charMap.length - 1)

  // Find which text nodes are involved
  const startInfo = charMap[matchStart]
  const endInfo = charMap[matchEnd]
  if (!startInfo || !endInfo || startInfo.nodeIdx === -1) return false

  let firstHighlight = null
  for (let ni = startInfo.nodeIdx; ni <= endInfo.nodeIdx; ni++) {
    if (ni === -1) continue
    const tNode = textNodes[ni]
    if (!tNode?.parentNode) continue

    const mark = document.createElement('mark')
    mark.className = className
    mark.style.cssText = `background: rgba(29,155,240,0.25); color: inherit; border-radius: 2px; padding: 0 1px;`

    tNode.parentNode.replaceChild(mark, tNode)
    mark.appendChild(tNode)
    if (!firstHighlight) firstHighlight = mark
  }

  if (scrollTo && firstHighlight) {
    firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return true
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
