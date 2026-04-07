import { useState, useRef, useCallback, useEffect } from 'react'
import Sidebar, { ASSISTANTS } from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputBar from './components/InputBar'
import DocViewer, { isPreviewable } from './components/DocViewer'


import useWebSocket from './hooks/useWebSocket'
import useVoice from './hooks/useVoice'
import useAudioPlayer from './hooks/useAudioPlayer'
import useDocuments from './hooks/useDocuments'
import { palette } from '@cbse/shared'
import { FileText, PanelRightClose, PanelRightOpen, Mail, ShieldCheck, ChevronDown } from 'lucide-react'

const WS_URL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voice`

function generateSessionId() {
  return Math.random().toString(36).slice(2, 14)
}

export default function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [selectedModel, setSelectedModel] = useState('Pico 2.5')
  const [chats, setChats] = useState([{ id: 1, title: 'New Chat', mode: 'doc', assistant: 'legal', workflow: null, messages: [] }])
  const [activeChatId, setActiveChatId] = useState(1)
  const [activeAssistant, setActiveAssistant] = useState('legal')
  const [voiceActive, setVoiceActive] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState({ visible: false, cls: '', text: '' })
  const [isBotResponding, setIsBotResponding] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ragSources, setRagSources] = useState([])
  const botBufferRef = useRef('')
  const chatIdCounter = useRef(2)
  const interruptedRef = useRef(false)
  const sessionIdRef = useRef(generateSessionId())
  const activeAssistantRef = useRef('legal')
  const activeWorkflowRef = useRef('')
  const requestIdCounter = useRef(0)

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0]
  const [dismissedSummaries, setDismissedSummaries] = useState(new Set())

  // Keep refs in sync for upload hook
  activeAssistantRef.current = activeAssistant
  activeWorkflowRef.current = activeChat?.workflow || ''

  // PDF Viewer state
  const [pdfPanelOpen, setPdfPanelOpen] = useState(false)
  const [pdfTarget, setPdfTarget] = useState({ page: null, snippet: null })
  const [mobileTab, setMobileTab] = useState('chat')
  // Stop words for context-aware term extraction
  const STOP_WORDS = useRef(new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did',
    'will','would','could','should','may','might','can','to','of','in','for','on','with','at','by',
    'from','as','into','through','and','but','or','if','that','this','it','its','than','also','not',
    'no','so','very','just','about','more','most','other','some','such','only','their','they','them',
    'we','our','you','your','he','she','her','him','his','who','which','what','where','when','how',
    'all','each','both','few','up','out','over','between','after','before','during','while','because',
  ])).current

  // Narrow a large chunk to the most relevant paragraph based on the LLM's claim sentence
  // Only narrow for very large chunks; for normal chunks, highlight the full text
  const narrowToRelevantParagraph = useCallback((chunkText, contextText) => {
    // For chunks under 800 chars (~2 paragraphs), highlight everything
    if (!contextText || chunkText.length < 800) return chunkText
    
    // For very large chunks (e.g. full-doc injection), narrow to the best 2-3 paragraphs
    let paragraphs = chunkText.split(/\n\n+/).filter(p => p.trim().length > 40)
    if (paragraphs.length <= 2) return chunkText
    
    const contextWords = contextText.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))

    if (contextWords.length < 2) return chunkText

    // Score each paragraph
    const scored = paragraphs.map(para => {
      const paraLower = para.toLowerCase()
      const score = contextWords.filter(w => paraLower.includes(w)).length / contextWords.length
      return { para, score }
    })
    scored.sort((a, b) => b.score - a.score)

    // Take top 2-3 paragraphs (enough for full context highlighting)
    const topParas = scored.filter(s => s.score >= 0.2).slice(0, 3)
    if (topParas.length === 0) return chunkText

    // Return them in original document order
    const topTexts = new Set(topParas.map(s => s.para))
    const ordered = paragraphs.filter(p => topTexts.has(p))
    return ordered.join('\n\n').trim()
  }, [STOP_WORDS])

  // Handle citation click — navigate PDF directly + highlight source text
  const handleCitationClick = useCallback((refNum, chipRect, msgSources, contextText) => {
    // Priority: 1) sources from the clicked message, 2) find from chat history, 3) live streaming ref (last resort)
    let allSources = msgSources?.length ? msgSources : null
    if (!allSources?.length) {
      const chat = chats.find(c => c.id === activeChatId)
      const lastBotWithSources = chat?.messages?.findLast(m => m.role === 'bot' && m.sources?.length > 0)
      if (lastBotWithSources) allSources = lastBotWithSources.sources
    }
    if (!allSources?.length) allSources = lastRagSourcesRef.current

    const ref = Number(refNum)
    console.log(`[Citation] Click ref=[${ref}], ${allSources?.length || 0} sources available:`, allSources?.map(s => `[${s.ref}] p.${s.page} "${s.text?.slice(0,40)}..."`))
    const source = allSources?.find(s => Number(s.ref) === ref)
    if (!source) {
      console.warn(`[Citation] No source found for ref [${ref}] in ${allSources?.length || 0} sources:`, allSources?.map(s => s.ref))
      return
    }

    console.log(`[Citation] Found source [${ref}]: page=${source.page}, page_end=${source.page_end}, text="${source.text?.slice(0,80)}..."`)

    // Navigate PDF to the correct page + highlight
    if (source.page != null) {
      const pageNum = Number(source.page) || 1
      const pageEnd = source.page_end != null ? Number(source.page_end) : pageNum
      const fullChunkText = source.text || source.snippet || ''

      // Context-aware narrowing: use the sentence around the citation to find
      // the most relevant paragraph within the chunk for precise highlighting
      const highlightSnippet = narrowToRelevantParagraph(fullChunkText, contextText)
      const fallbackSnippet = highlightSnippet !== fullChunkText ? fullChunkText : null

      setPdfTarget({ page: pageNum, pageEnd, snippet: highlightSnippet, fallbackSnippet, requestId: Date.now() })
      setPdfPanelOpen(true)
      setMobileTab('doc')
    }
  }, [chats, activeChatId, narrowToRelevantParagraph])

  // Store last rag sources for citation lookups (persists after streaming ends)
  const lastRagSourcesRef = useRef([])

  // Documents (RAG) — pass ref so session ID is always current
  const { documents, uploading, uploadProgress, uploadFile, deleteDocument, clearDocuments, abortUpload } = useDocuments(sessionIdRef, activeAssistantRef, activeWorkflowRef)

  // Auto-open doc panel when a previewable document is uploaded
  const prevDocCountRef = useRef(0)
  useEffect(() => {
    if (documents.length > prevDocCountRef.current) {
      const newDoc = documents[documents.length - 1]
      if (!newDoc?.relevanceWarning && isPreviewable(newDoc?.filename, newDoc?.fileType)) {
        setPdfPanelOpen(true)
      }
    }
    prevDocCountRef.current = documents.length
  }, [documents])

  // WebSocket URL with session_id for per-chat RAG scoping + assistant key for system prompt
  const wsUrl = `${WS_URL}?session_id=${sessionIdRef.current}&assistant=${activeAssistant}`

  const addMsg = useCallback((role, text, chatId) => {
    setChats(prev => prev.map(c =>
      c.id === (chatId || activeChatId)
        ? { ...c, messages: [...c.messages, { id: Date.now() + Math.random(), role, text }] }
        : c
    ))
  }, [activeChatId])

  const updateLastBotMsg = useCallback((text) => {
    setChats(prev => prev.map(c => {
      if (c.id !== activeChatId) return c
      const msgs = [...c.messages]
      const lastBot = msgs.findLastIndex(m => m.role === 'bot')
      if (lastBot >= 0) msgs[lastBot] = { ...msgs[lastBot], text }
      return { ...c, messages: msgs }
    }))
  }, [activeChatId])

  const updateLastBotMsgSources = useCallback((sources) => {
    setChats(prev => prev.map(c => {
      if (c.id !== activeChatId) return c
      const msgs = [...c.messages]
      const lastBot = msgs.findLastIndex(m => m.role === 'bot')
      if (lastBot >= 0) msgs[lastBot] = { ...msgs[lastBot], sources }
      return { ...c, messages: msgs }
    }))
  }, [activeChatId])

  const updateChatTitle = useCallback((text) => {
    const title = text.length > 30 ? text.slice(0, 30) + '…' : text
    setChats(prev => prev.map(c =>
      c.id === activeChatId && c.title === 'New Chat' ? { ...c, title } : c
    ))
  }, [activeChatId])

  // Audio player for TTS
  const { playAudio, stopPlayback, isPlaying, isPlayingRef } = useAudioPlayer()

  // Refs for instant barge-in (avoid stale React state in callbacks)
  const isBotRespondingRef = useRef(false)

  // WebSocket handler
  const onMessage = useCallback((msg, binary) => {
    if (binary) {
      // Drop stale audio if user interrupted
      if (interruptedRef.current) return
      playAudio(msg)
      return
    }

    switch (msg.type) {
      case 'user_transcript':
        if (voiceActive) {
          addMsg('user', msg.text)
          updateChatTitle(msg.text)
        }
        break

      case 'llm_start':
        interruptedRef.current = false
        setIsBotResponding(true)
        isBotRespondingRef.current = true
        botBufferRef.current = ''
        addMsg('bot', '')
        setVoiceStatus({ visible: true, cls: 'thinking', text: '💭 Thinking...' })
        break

      case 'rag_sources':
        setRagSources(msg.sources || [])
        lastRagSourcesRef.current = msg.sources || []
        updateLastBotMsgSources(msg.sources || [])
        break

      case 'citation_correction':
        // Backend verified citations — update message text and sources
        // This may arrive after llm_done, so always update both refs and message
        if (msg.text) updateLastBotMsg(msg.text)
        if (msg.sources) {
          lastRagSourcesRef.current = msg.sources
          updateLastBotMsgSources(msg.sources)
        }
        break

      case 'llm_delta': {
        if (interruptedRef.current) break
        botBufferRef.current += msg.text
        updateLastBotMsg(botBufferRef.current)
        break
      }

      case 'llm_done':
        setIsBotResponding(false)
        isBotRespondingRef.current = false
        if (msg.interrupted && botBufferRef.current) {
          updateLastBotMsg(botBufferRef.current + ' …')
        }
        botBufferRef.current = ''
        // Persist sources on the bot message so SourceCards stay visible
        if (lastRagSourcesRef.current.length > 0) {
          updateLastBotMsgSources([...lastRagSourcesRef.current])
        }
        setRagSources([])
        break

      case 'tts_start':
        if (!interruptedRef.current) {
          setVoiceStatus({ visible: true, cls: 'speaking', text: '🔊 Speaking...' })
        }
        break

      case 'tts_done':
        setIsBotResponding(false)
        isBotRespondingRef.current = false
        if (voiceActive) {
          setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
        } else {
          setVoiceStatus({ visible: false, cls: '', text: '' })
        }
        break

      case 'vad_no_speech':
        if (voiceActive) setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
        break

      case 'ping':
        break

      case 'error':
        setVoiceStatus({ visible: true, cls: 'error', text: '❌ ' + msg.text })
        setTimeout(() => {
          if (voiceActive) setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
          else setVoiceStatus({ visible: false, cls: '', text: '' })
        }, 3000)
        break
    }
  }, [voiceActive, addMsg, updateLastBotMsg, updateChatTitle, playAudio])

  const { ws, connected, reconnect } = useWebSocket(wsUrl, onMessage)

  // Voice mode — barge-in: if bot is speaking and user talks, stop bot and process new input
  const onSpeechDetected = useCallback(() => {
    const botSpeaking = isPlayingRef.current || isBotRespondingRef.current
    if (botSpeaking) {
      // Barge-in: stop bot, send interrupt to backend
      interruptedRef.current = true
      stopPlayback()
      setIsBotResponding(false)
      isBotRespondingRef.current = false
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'interrupt' }))
      }
    }
    setVoiceStatus({ visible: true, cls: 'recording', text: '🎤 Recording...' })
  }, [stopPlayback, ws])

  const onSpeechEnd = useCallback((audio) => {
    setVoiceStatus({ visible: true, cls: 'processing', text: '⏳ Processing...' })
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(audio.buffer)
    }
  }, [ws])

  const { startVoice, stopVoice } = useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef })

  const toggleVoice = async () => {
    if (voiceActive) {
      stopVoice()
      stopPlayback()
      setVoiceActive(false)
      setVoiceStatus({ visible: false, cls: '', text: '' })
    } else {
      setVoiceActive(true)
      setVoiceStatus({ visible: true, cls: 'processing', text: '⏳ Starting...' })
      const ok = await startVoice()
      if (ok) {
        setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
      } else {
        setVoiceStatus({ visible: true, cls: 'error', text: '❌ Mic failed' })
        setTimeout(() => {
          setVoiceActive(false)
          setVoiceStatus({ visible: false, cls: '', text: '' })
        }, 3000)
      }
    }
  }

  // Stop all active streams — call before switching chat/assistant
  const stopCurrentResponse = useCallback(() => {
    interruptedRef.current = true
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'interrupt' }))
    }
    stopVoice()
    stopPlayback()
    setVoiceActive(false)
    setVoiceStatus({ visible: false, cls: '', text: '' })
    // Reset bot state
    setIsBotResponding(false)
    isBotRespondingRef.current = false
    botBufferRef.current = ''
  }, [stopVoice, stopPlayback, ws])

  const sendText = (text) => {
    if (!text.trim() || !ws.current || ws.current.readyState !== WebSocket.OPEN) return

    // Block if only irrelevant documents are uploaded — tell user to upload a related doc
    const hasRelevantDoc = documents.some(d => !d.relevanceWarning)
    const hasIrrelevantDoc = documents.some(d => d.relevanceWarning)
    if (hasIrrelevantDoc && !hasRelevantDoc) {
      const assistantCfg = ASSISTANTS.find(a => a.key === activeAssistant) || ASSISTANTS[0]
      addMsg('user', text.trim())
      updateChatTitle(text.trim())
      setTimeout(() => {
        addMsg('bot', `The uploaded document doesn't appear to be relevant to the **${assistantCfg.label}**. I can only answer questions based on documents within this assistant's domain.\n\nPlease upload a relevant document to get started, or switch to the **General Assistant** which accepts any document type.`)
      }, 300)
      return
    }

    // Auto-select first workflow if user types before choosing one
    if (!activeChat.workflow && activeAssistantCfg.tryOptions?.length > 0) {
      const defaultWf = activeAssistantCfg.tryOptions[0].message
      setChats(prev => prev.map(c =>
        c.id === activeChatId ? { ...c, workflow: defaultWf } : c
      ))
    }
    addMsg('user', text.trim())
    updateChatTitle(text.trim())
    const payload = { type: 'text_chat', text: text.trim() }
    if (activeChat.workflow) payload.workflow = activeChat.workflow
    ws.current.send(JSON.stringify(payload))
  }

  // Handle Try button click — set workflow + title on chat (reveals InputBar, no message sent)
  const handleTryClick = (message, label) => {
    setChats(prev => prev.map(c =>
      c.id === activeChatId ? { ...c, workflow: message, title: label || message } : c
    ))
  }

  const selectAssistant = (assistantKey) => {
    const cfg = ASSISTANTS.find(a => a.key === assistantKey)
    if (!cfg) return
    if (uploading) return // Block switching during upload to prevent session_id mismatch
    stopCurrentResponse()
    setActiveAssistant(assistantKey)

    // If current chat has no messages, morph it to the new assistant (even if workflow was set)
    const currentChat = chats.find(c => c.id === activeChatId)
    if (currentChat && currentChat.messages.length === 0) {
      setChats(prev => prev.map(c =>
        c.id === activeChatId ? { ...c, assistant: assistantKey, mode: cfg.mode, workflow: null, title: 'New Chat' } : c
      ))
    } else {
      // Current chat has messages — find existing empty chat for this assistant or create new
      const existingEmpty = chats.find(c => c.assistant === assistantKey && c.messages.length === 0)
      if (existingEmpty) {
        setActiveChatId(existingEmpty.id)
      } else {
        const id = chatIdCounter.current++
        setChats(prev => [...prev, { id, title: 'New Chat', mode: cfg.mode, assistant: assistantKey, workflow: null, messages: [] }])
        setActiveChatId(id)
      }
    }
    clearDocuments()
    setPdfPanelOpen(false)
    setPdfTarget({ page: null, snippet: null })
    setMobileTab('chat')
    lastRagSourcesRef.current = []
    sessionIdRef.current = generateSessionId()
    reconnect()
    setSidebarOpen(false)
  }

  const deleteChat = (id) => {
    if (id === activeChatId) stopCurrentResponse()
    setChats(prev => {
      const next = prev.filter(c => c.id !== id)
      if (next.length === 0) {
        const newId = chatIdCounter.current++
        next.push({ id: newId, title: 'New Chat', mode: 'doc', assistant: activeAssistant, workflow: null, messages: [] })
        setActiveChatId(newId)
      } else if (activeChatId === id) {
        setActiveChatId(next[next.length - 1].id)
        setActiveAssistant(next[next.length - 1].assistant || 'legal')
      }
      return next
    })
  }

  const switchChat = (id) => {
    if (uploading) return
    stopCurrentResponse()
    setActiveChatId(id)
    const chat = chats.find(c => c.id === id)
    if (chat?.assistant) setActiveAssistant(chat.assistant)
    setSidebarOpen(false)
    clearDocuments()
    setPdfPanelOpen(false)
    setPdfTarget({ page: null, snippet: null })
    setMobileTab('chat')
    lastRagSourcesRef.current = []
    sessionIdRef.current = generateSessionId()
    reconnect()
  }

  const activeAssistantCfg = ASSISTANTS.find(a => a.key === activeAssistant) || ASSISTANTS[0]

  // Find first previewable document for the doc viewer panel
  const [hoveredAssistant, setHoveredAssistant] = useState(null)
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactSubmitted, setContactSubmitted] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', email: '', company: '', useCase: '' })

  const activeViewDoc = documents.find(d => !d.relevanceWarning && isPreviewable(d.filename, d.fileType))
  const hasPreviewableDoc = !!activeViewDoc

  // Select assistant from landing page
  const selectAssistantFromLanding = (key) => {
    selectAssistant(key)
    setShowLanding(false)
  }

  // Go back to landing
  const goToLanding = () => {
    setShowLanding(true)
  }

  const showDocPanel = pdfPanelOpen && hasPreviewableDoc

  // Calculate chat column flex based on PDF panel
  return (
    <div className="h-dvh flex overflow-hidden" style={{ background: palette.bg, color: palette.textPrimary }}>
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        activeAssistant={activeAssistant}
        onSelectAssistant={(key) => { selectAssistant(key); setShowLanding(false) }}
        onSwitchChat={(id) => { switchChat(id); setShowLanding(false) }}
        onDeleteChat={deleteChat}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onHome={goToLanding}
        showLanding={showLanding}
      />
      <div className="relative min-w-0 flex-1 overflow-hidden" style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100%' }}>
        {/* Header */}
        <header
          className="flex items-center justify-between border-b px-5 py-4 md:px-6"
          style={{ borderColor: palette.border, background: palette.bg }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors active:bg-white/5"
              style={{ color: palette.textMuted }}
            >
              ☰
            </button>
            <div className="text-[15px] font-semibold lg:hidden">matify.tech</div>
            <div className="hidden lg:block">
              <div className="relative">
                <div
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: palette.textMuted }}
                >
                  Model
                </div>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="min-w-[190px] rounded-2xl border pl-[72px] pr-11 py-3 text-[15px] font-medium outline-none"
                  style={{
                    borderColor: palette.borderStrong,
                    background: palette.panel,
                    color: palette.textPrimary,
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
                  }}
                >
                  <option value="Pico 2.5">Pico 2.5</option>
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: palette.textSecondary }}
                />
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* Doc panel toggle */}
            {!showLanding && hasPreviewableDoc && (
              <button
                onClick={() => { const willOpen = !pdfPanelOpen; setPdfPanelOpen(willOpen); setMobileTab(willOpen ? 'doc' : 'chat') }}
                className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[12px] font-medium transition-all"
                style={{
                  background: pdfPanelOpen ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.06)',
                  color: pdfPanelOpen ? palette.primary : palette.textMuted,
                  border: `1px solid ${pdfPanelOpen ? 'rgba(29,155,240,0.3)' : 'transparent'}`,
                }}
              >
                <FileText size={14} /><span className="hidden sm:inline">Doc</span>
                {pdfPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              </button>
            )}
            <button
              onClick={() => { setContactSubmitted(false); setShowContactModal(true) }}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
              style={{ background: palette.primary, color: 'white' }}
            >
              <Mail className="h-4 w-4" />
              Contact Us
            </button>
            <span
              className={`w-2.5 h-2.5 rounded-full ${connected ? '' : 'animate-pulse'}`}
              style={{ background: connected ? '#10b981' : '#ef4444' }}
              title={connected ? 'Connected' : 'Reconnecting...'}
            />
          </div>
        </header>

        {/* Main content */}
        {showLanding ? (
          /* ── LANDING PAGE ── */
          <div className="flex flex-1 items-start justify-center overflow-auto px-6 pb-8 pt-6 md:px-10 md:pt-8">
            <div className="w-full max-w-6xl text-center">
              {/* Badge */}
              <div
                className="mx-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em]"
                style={{ borderColor: palette.borderStrong, background: palette.panel, color: palette.primary }}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Own your AI
              </div>

              {/* Hero */}
              <h1
                className="mx-auto mt-6 max-w-[1000px] text-[36px] font-semibold leading-[1.08] tracking-tight md:text-[52px] xl:text-[54px]"
                style={{ color: palette.textPrimary }}
              >
                <span className="block">Who owns the AI you are using?</span>
                <span className="mt-1 block">
                  <span style={{ color: palette.textPrimary }}>and </span>
                  <span style={{ color: palette.primary }}>How secure is your data?</span>
                </span>
              </h1>

              <p
                className="mx-auto mt-5 max-w-[900px] text-sm leading-7 md:text-[17px]"
                style={{ color: palette.textSecondary }}
              >
                We turn your organization's data into a secure SLM, deployed in your own environment, so your data never leaves your premise.
              </p>

              {/* TRY section */}
              <div className="mx-auto mt-12 max-w-6xl">
                <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: palette.textMuted }}>
                  TRY
                </div>
                <div className="mx-auto grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {ASSISTANTS.map((assistant) => {
                    const Icon = assistant.icon
                    const hovered = hoveredAssistant === assistant.key
                    return (
                      <button
                        key={assistant.key}
                        onClick={() => selectAssistantFromLanding(assistant.key)}
                        onMouseEnter={() => setHoveredAssistant(assistant.key)}
                        onMouseLeave={() => setHoveredAssistant(null)}
                        className="rounded-[22px] border px-4 py-4 text-left transition-all hover:-translate-y-0.5"
                        style={{
                          borderColor: hovered ? palette.primary : palette.border,
                          background: hovered ? palette.panelAlt : palette.panel,
                          color: palette.textPrimary,
                          boxShadow: hovered ? '0 0 0 1px rgba(29,155,240,0.18)' : 'none',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-9 w-9 items-center justify-center rounded-xl"
                            style={{
                              background: hovered ? 'rgba(29,155,240,0.14)' : palette.bg,
                              color: hovered ? palette.primary : palette.textSecondary,
                            }}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="text-sm font-medium leading-5">{assistant.label}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Footer */}
                <div
                  className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t pt-5 text-sm"
                  style={{ borderColor: palette.border, color: palette.textMuted }}
                >
                  <span>© 2026 Mat Studio, Inc.</span>
                  <a href="#" className="transition-opacity hover:opacity-80" style={{ color: palette.textSecondary }}>Terms</a>
                  <a href="#" className="transition-opacity hover:opacity-80" style={{ color: palette.textSecondary }}>Privacy Policy</a>
                  <a href="#" className="transition-opacity hover:opacity-80" style={{ color: palette.textSecondary }}>Cookie Policy</a>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── CHAT / ASSISTANT VIEW ── */
          <div className="flex flex-col min-h-0 overflow-hidden" style={{ flex: '1 1 0%' }}>
            {/* Mobile: vertical stack (chat top 50%, doc bottom 50%)
                Desktop: horizontal side-by-side (55% chat, 45% doc) */}
            <div className={`flex flex-1 min-h-0 overflow-hidden ${showDocPanel ? 'mobile-split' : ''}`}>
              {/* Chat column */}
              <div className={`flex flex-col min-w-0 relative flex-1 overflow-hidden ${showDocPanel ? 'md:flex-[0_0_55%] mobile-split-panel' : ''}`}>
                <ChatArea
                  messages={activeChat.messages}
                  isBotResponding={isBotResponding}
                  mode={activeChat.mode}
                  assistantConfig={activeAssistantCfg}
                  onTryClick={handleTryClick}
                  workflow={activeChat.workflow}
                  ragSources={ragSources}
                  onUpload={uploadFile}
                  uploading={uploading}
                  uploadProgress={uploadProgress}
                  hasDocuments={documents.some(d => !d.relevanceWarning)}
                  onCitationClick={handleCitationClick}
                  documents={documents}
                  dismissedSummaries={dismissedSummaries}
                  onDismissSummary={(docId) => setDismissedSummaries(prev => new Set([...prev, docId]))}
                  onQuestionClick={(q) => sendText(q)}
                  onOpenPdf={hasPreviewableDoc ? () => setPdfPanelOpen(true) : undefined}
                />
              </div>

              {/* Document Viewer panel */}
              {showDocPanel && (
                <>
                  {/* Desktop: vertical resize handle | Mobile: horizontal divider */}
                  <div className="panel-resize-handle shrink-0 max-md:hidden" style={{ background: palette.border }} />
                  <div className="hidden max-md:block shrink-0 h-px" style={{ background: palette.border }} />
                  <div className="min-w-0 flex-1 md:flex-[0_0_45%] mobile-split-panel overflow-hidden">
                    <DocViewer
                      fileUrl={activeViewDoc.fileUrl}
                      fileType={activeViewDoc.fileType}
                      filename={activeViewDoc.filename}
                      targetPage={pdfTarget.page}
                      targetPageEnd={pdfTarget.pageEnd}
                      targetSnippet={pdfTarget.snippet}
                      targetFallbackSnippet={pdfTarget.fallbackSnippet}
                      targetRequestId={pdfTarget.requestId}
                      onClose={() => setPdfPanelOpen(false)}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="shrink-0">
              {(activeChat.workflow || !activeAssistantCfg.tryOptions?.length) && (
                <InputBar
                  onSend={sendText}
                  onToggleVoice={toggleVoice}
                  voiceActive={voiceActive}
                  voiceStatus={voiceStatus}
                  disabled={!connected}
                  mode={activeChat.mode}
                  voiceEnabled={activeAssistantCfg.voice}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── CONTACT MODAL ── */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.62)' }}>
          <div className="w-full max-w-lg rounded-[28px] border p-6 shadow-2xl"
            style={{ borderColor: palette.borderStrong, background: palette.panel, color: palette.textPrimary }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-2xl font-semibold">Contact Us</div>
                <p className="mt-2 text-sm leading-7" style={{ color: palette.textMuted }}>
                  Tell us about your organization and workflow. We'll reach out to discuss how we can deploy a secure SLM for you.
                </p>
              </div>
              <button onClick={() => setShowContactModal(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: palette.bg, color: palette.textSecondary }}>
                ✕
              </button>
            </div>

            {contactSubmitted ? (
              <div className="mt-6 rounded-2xl border p-5" style={{ borderColor: palette.borderStrong, background: palette.bg }}>
                <div className="text-lg font-semibold">Thanks — we've got your details.</div>
                <p className="mt-2 text-sm leading-7" style={{ color: palette.textMuted }}>
                  Our team will reach out to discuss your use case.
                </p>
                <button onClick={() => setShowContactModal(false)}
                  className="mt-5 rounded-xl px-4 py-3 text-sm font-medium"
                  style={{ background: palette.primary, color: 'white' }}>
                  Close
                </button>
              </div>
            ) : (
              <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); setContactSubmitted(true) }}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <div className="mb-2 text-sm" style={{ color: palette.textSecondary }}>Name</div>
                    <input value={contactForm.name} onChange={(e) => setContactForm(p => ({ ...p, name: e.target.value }))}
                      className="w-full rounded-xl border px-4 py-3 outline-none"
                      style={{ borderColor: palette.borderStrong, background: palette.bg, color: palette.textPrimary }}
                      placeholder="Your name" required />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm" style={{ color: palette.textSecondary }}>Work Email</div>
                    <input type="email" value={contactForm.email} onChange={(e) => setContactForm(p => ({ ...p, email: e.target.value }))}
                      className="w-full rounded-xl border px-4 py-3 outline-none"
                      style={{ borderColor: palette.borderStrong, background: palette.bg, color: palette.textPrimary }}
                      placeholder="you@company.com" required />
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <div className="mb-2 text-sm" style={{ color: palette.textSecondary }}>Company</div>
                    <input value={contactForm.company} onChange={(e) => setContactForm(p => ({ ...p, company: e.target.value }))}
                      className="w-full rounded-xl border px-4 py-3 outline-none"
                      style={{ borderColor: palette.borderStrong, background: palette.bg, color: palette.textPrimary }}
                      placeholder="Company name" />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm" style={{ color: palette.textSecondary }}>Use Case</div>
                    <input value={contactForm.useCase} onChange={(e) => setContactForm(p => ({ ...p, useCase: e.target.value }))}
                      className="w-full rounded-xl border px-4 py-3 outline-none"
                      style={{ borderColor: palette.borderStrong, background: palette.bg, color: palette.textPrimary }}
                      placeholder="Legal, employee, support, banking..." />
                  </label>
                </div>
                <div className="flex flex-wrap gap-3 pt-2">
                  <button type="submit" className="rounded-xl px-4 py-3 text-sm font-medium"
                    style={{ background: palette.primary, color: 'white' }}>Submit</button>
                  <button type="button" onClick={() => setShowContactModal(false)}
                    className="rounded-xl border px-4 py-3 text-sm font-medium"
                    style={{ borderColor: palette.borderStrong, background: palette.bg, color: palette.textPrimary }}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
