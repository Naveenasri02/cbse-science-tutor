import { useState, useRef, useCallback, useEffect } from 'react'
import LandingPage from './components/LandingPage'
import Sidebar, { ASSISTANTS } from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputBar from './components/InputBar'
import PdfViewer from './components/PdfViewer'
import SourcePopup from './components/SourcePopup'

import useWebSocket from './hooks/useWebSocket'
import useVoice from './hooks/useVoice'
import useAudioPlayer from './hooks/useAudioPlayer'
import useDocuments from './hooks/useDocuments'
import { palette } from '@cbse/shared'
import { FileText, PanelRightClose, PanelRightOpen } from 'lucide-react'

const WS_URL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voice`

function generateSessionId() {
  return Math.random().toString(36).slice(2, 14)
}

export default function App() {
  const [pageMode, setPageMode] = useState('landing')
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
  const [popupSource, setPopupSource] = useState(null)

  // Handle citation click — navigate PDF + highlight full source + show popup
  const handleCitationClick = useCallback((refNum, chipRect, msgSources) => {
    // Priority: 1) sources from the clicked message, 2) live RAG ref (streaming), 3) last bot fallback
    let allSources = msgSources?.length ? msgSources : lastRagSourcesRef.current
    if (!allSources?.length) {
      const chat = chats.find(c => c.id === activeChatId)
      const lastBotWithSources = chat?.messages?.findLast(m => m.role === 'bot' && m.sources?.length > 0)
      if (lastBotWithSources) allSources = lastBotWithSources.sources
    }

    const source = allSources?.find(s => s.ref === refNum || s.ref === String(refNum))
    if (!source) return

    // Always create a new object so React detects the state change (even for same source)
    setPopupSource({ ...source, _clickId: Date.now() })

    // Navigate PDF to the correct page + highlight using FULL source text
    if (source.page != null) {
      const pageNum = Number(source.page) || 1
      const fullText = source.text || source.snippet || ''
      setPdfTarget({ page: pageNum, snippet: fullText, requestId: Date.now() })
      setPdfPanelOpen(true)
    }
  }, [chats, activeChatId])

  // Store last rag sources for citation lookups (persists after streaming ends)
  const lastRagSourcesRef = useRef([])

  // Documents (RAG) — pass ref so session ID is always current
  const { documents, uploading, uploadProgress, uploadFile, deleteDocument, clearDocuments, abortUpload } = useDocuments(sessionIdRef, activeAssistantRef, activeWorkflowRef)

  // Auto-open PDF panel when a PDF is uploaded
  const prevDocCountRef = useRef(0)
  useEffect(() => {
    if (documents.length > prevDocCountRef.current) {
      const newDoc = documents[documents.length - 1]
      if (!newDoc?.relevanceWarning && (newDoc?.fileType === 'application/pdf' || newDoc?.filename?.toLowerCase().endsWith('.pdf'))) {
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
    setPopupSource(null)
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
    setPopupSource(null)
    lastRagSourcesRef.current = []
    sessionIdRef.current = generateSessionId()
    reconnect()
  }

  const activeAssistantCfg = ASSISTANTS.find(a => a.key === activeAssistant) || ASSISTANTS[0]

  // Auto-open PDF panel when a PDF is uploaded
  const activePdfDoc = documents.find(d => !d.relevanceWarning && (d.fileType === 'application/pdf' || d.filename?.toLowerCase().endsWith('.pdf')))
  const hasPdf = !!activePdfDoc

  // Landing page
  if (pageMode === 'landing') {
    return <LandingPage onTryDemo={() => setPageMode('demo')} />
  }

  const showPdfPanel = pdfPanelOpen && hasPdf

  // Calculate chat column flex based on PDF panel
  const chatFlex = showPdfPanel ? '0 0 55%' : '1 1 auto'

  return (
    <div className="h-dvh flex overflow-hidden" style={{ background: palette.bg, color: palette.textPrimary }}>
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        activeAssistant={activeAssistant}
        onSelectAssistant={selectAssistant}
        onSwitchChat={switchChat}
        onDeleteChat={deleteChat}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onBackToLanding={() => setPageMode('landing')}
      />
      <div className="relative min-w-0 flex-1 overflow-hidden" style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100%' }}>
        {/* Header */}
        <header
          className="flex items-center justify-between border-b px-3 py-2 md:px-5 md:py-3"
          style={{ borderColor: palette.border, background: palette.bg }}
        >
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors active:bg-white/5"
              style={{ color: palette.textMuted }}
            >
              ☰
            </button>
            <div className="text-[15px] font-semibold" style={{ color: palette.textPrimary }}>
              Secure AI Chat
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {/* PDF panel toggle — only show when PDF is available */}
            {hasPdf && (
              <button
                onClick={() => setPdfPanelOpen(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all hover:scale-[1.03] active:scale-[0.97]"
                style={{
                  background: pdfPanelOpen ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.06)',
                  color: pdfPanelOpen ? palette.primary : palette.textMuted,
                  border: `1px solid ${pdfPanelOpen ? 'rgba(29,155,240,0.3)' : 'transparent'}`,
                }}
                title={pdfPanelOpen ? 'Hide PDF viewer' : 'Show PDF viewer'}
              >
                <FileText size={14} />
                <span className="hidden sm:inline">PDF</span>
                {pdfPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              </button>
            )}
            <div
              className="rounded-full px-3 py-1.5 text-[13px]"
              style={{ background: palette.panel, color: palette.textSecondary }}
            >
              {activeAssistantCfg.label}
            </div>
            <span
              className={`w-2.5 h-2.5 rounded-full ${connected ? '' : 'animate-pulse'}`}
              style={{ background: connected ? '#10b981' : '#ef4444' }}
              title={connected ? 'Connected' : 'Reconnecting...'}
            />
          </div>
        </header>

        {/* Main content: Chat (LEFT) + optional PDF panel (RIGHT) */}
        <div className="flex min-h-0 overflow-hidden">
          {/* Chat column */}
          <div className="flex flex-col min-w-0 relative" style={{ flex: chatFlex }}>
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
              onOpenPdf={hasPdf ? () => setPdfPanelOpen(true) : undefined}
            />
            {/* Source Popup — small tooltip at bottom of chat */}
            {popupSource && (
              <SourcePopup
                key={popupSource._clickId}
                source={popupSource}
                onClose={() => setPopupSource(null)}
              />
            )}
          </div>

          {/* PDF Viewer panel (RIGHT) */}
          {showPdfPanel && (
            <>
              <div className="panel-resize-handle shrink-0" style={{ background: palette.border }} />
              <div className="min-w-0" style={{ flex: '0 0 45%' }}>
                <PdfViewer
                  fileUrl={activePdfDoc.fileUrl}
                  fileType={activePdfDoc.fileType}
                  filename={activePdfDoc.filename}
                  targetPage={pdfTarget.page}
                  targetSnippet={pdfTarget.snippet}
                  targetRequestId={pdfTarget.requestId}
                  onClose={() => setPdfPanelOpen(false)}
                />
              </div>
            </>
          )}
        </div>

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
  )
}
