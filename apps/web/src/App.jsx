import { useState, useRef, useCallback } from 'react'
import LandingPage from './components/LandingPage'
import Sidebar, { ASSISTANTS } from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputBar from './components/InputBar'

import useWebSocket from './hooks/useWebSocket'
import useVoice from './hooks/useVoice'
import useAudioPlayer from './hooks/useAudioPlayer'
import useDocuments from './hooks/useDocuments'
import VoiceOverlay from './components/VoiceOverlay'
import { palette } from '@cbse/shared'

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
  const botBufferRef = useRef('')
  const chatIdCounter = useRef(2)
  const interruptedRef = useRef(false)
  const ttsPlayingSinceRef = useRef(0)
  const processingTimerRef = useRef(null)
  const sessionIdRef = useRef(generateSessionId())

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0]

  // Documents (RAG) — pass ref so session ID is always current
  const { documents, uploading, uploadProgress, uploadFile, deleteDocument, clearDocuments } = useDocuments(sessionIdRef)

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
  const resetVoiceRef = useRef(() => {})

  // WebSocket handler
  const onMessage = useCallback((msg, binary) => {
    if (binary) {
      // Discard stale TTS audio from interrupted pipeline
      if (interruptedRef.current) return
      playAudio(msg)
      return
    }

    // Any server response clears the processing timeout
    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current)
      processingTimerRef.current = null
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
        stopPlayback()
        setIsBotResponding(true)
        isBotRespondingRef.current = true
        botBufferRef.current = ''
        addMsg('bot', '')
        setVoiceStatus({ visible: true, cls: 'thinking', text: '💭 Thinking...' })
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
        if (msg.interrupted) {
          if (botBufferRef.current) updateLastBotMsg(botBufferRef.current + ' …')
        }
        botBufferRef.current = ''
        break

      case 'tts_start':
        if (!interruptedRef.current) {
          setVoiceStatus({ visible: true, cls: 'speaking', text: '🔊 Speaking... 🎤' })
          ttsPlayingSinceRef.current = Date.now()
        }
        break

      case 'tts_done':
        setIsBotResponding(false)
        isBotRespondingRef.current = false
        ttsPlayingSinceRef.current = 0
        if (voiceActive) {
          if (!interruptedRef.current) {
            // Normal completion: reset VAD for fresh listening
            resetVoiceRef.current()
            setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
          }
          // If interrupted: don't reset VAD — user is still speaking,
          // let onSpeechEnd fire naturally to capture their audio
        } else {
          setVoiceStatus({ visible: false, cls: '', text: '' })
        }
        break

      case 'vad_no_speech':
        interruptedRef.current = false
        // Only show Listening if bot isn't actively speaking (grace period echo)
        if (voiceActive && !isPlayingRef.current && ttsPlayingSinceRef.current === 0) {
          setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
        }
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
  }, [voiceActive, addMsg, updateLastBotMsg, updateChatTitle, playAudio, stopPlayback])

  const { ws, connected, reconnect } = useWebSocket(wsUrl, onMessage)

  // Voice mode — barge-in with AEC grace period (Gemini Live-style)
  // ttsPlayingSinceRef > 0 catches the gap after llm_done where isPlayingRef
  // can briefly go false between audio chunks but TTS hasn't finished yet
  const onSpeechDetected = useCallback(() => {
    const botActive = isBotRespondingRef.current || isPlayingRef.current || ttsPlayingSinceRef.current > 0
    if (botActive) {
      // 600ms grace lets browser AEC converge (vs 1.5s before)
      if (ttsPlayingSinceRef.current > 0 && Date.now() - ttsPlayingSinceRef.current < 600) return
      interruptedRef.current = true
      stopPlayback()
      setIsBotResponding(false)
      isBotRespondingRef.current = false
      ttsPlayingSinceRef.current = 0
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'interrupt' }))
      }
    }
    setVoiceStatus({ visible: true, cls: 'recording', text: '🎤 Recording...' })
  }, [stopPlayback, ws])

  const onSpeechEnd = useCallback((audio) => {
    const botActive = isBotRespondingRef.current || isPlayingRef.current || ttsPlayingSinceRef.current > 0
    const inGracePeriod = botActive && ttsPlayingSinceRef.current > 0 && Date.now() - ttsPlayingSinceRef.current < 600

    if (botActive && !inGracePeriod) {
      // Past grace period — interrupt immediately on client side
      interruptedRef.current = true
      stopPlayback()
      setIsBotResponding(false)
      isBotRespondingRef.current = false
      ttsPlayingSinceRef.current = 0
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'interrupt' }))
      }
    }
    // During grace period: no client-side interrupt, but still send audio.
    // Backend STT-first approach filters echo vs real speech server-side.

    if (!inGracePeriod) {
      setVoiceStatus({ visible: true, cls: 'processing', text: '⏳ Processing...' })
    }

    // Safety timeout: if backend silently fails, auto-recover to Listening after 15s
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current)
    processingTimerRef.current = setTimeout(() => {
      processingTimerRef.current = null
      // Only recover if we're still stuck (no response came)
      if (!isBotRespondingRef.current && !isPlayingRef.current) {
        setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
        interruptedRef.current = false
      }
    }, 15000)

    // ALWAYS send audio — never drop user speech
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(audio.buffer)
    }
  }, [stopPlayback, ws])

  const { startVoice, stopVoice, resetVoice } = useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef })
  resetVoiceRef.current = resetVoice

  const toggleVoice = async () => {
    if (voiceActive) {
      // If bot is speaking, tap = interrupt (stop audio, resume VAD)
      if (isPlayingRef.current || isBotRespondingRef.current) {
        interruptedRef.current = true
        stopPlayback()
        setIsBotResponding(false)
        isBotRespondingRef.current = false
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'interrupt' }))
        }
        setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
        return
      }
      // Otherwise, turn off voice mode
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
        setVoiceStatus({ visible: true, cls: 'error', text: '❌ Mic failed — check permissions' })
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
    stopCurrentResponse()
    setActiveChatId(id)
    const chat = chats.find(c => c.id === id)
    if (chat?.assistant) setActiveAssistant(chat.assistant)
    setSidebarOpen(false)
    clearDocuments()
    sessionIdRef.current = generateSessionId()
    reconnect()
  }

  const activeAssistantCfg = ASSISTANTS.find(a => a.key === activeAssistant) || ASSISTANTS[0]

  // Landing page
  if (pageMode === 'landing') {
    return <LandingPage onTryDemo={() => setPageMode('demo')} />
  }

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

        <ChatArea
          messages={activeChat.messages}
          isBotResponding={isBotResponding}
          mode={activeChat.mode}
          assistantConfig={activeAssistantCfg}
          onTryClick={handleTryClick}
          workflow={activeChat.workflow}
        />
        {activeChat.workflow && (
          <InputBar
            onSend={sendText}
            onToggleVoice={toggleVoice}
            voiceActive={voiceActive}
            voiceStatus={voiceStatus}
            disabled={!connected}
            onUpload={uploadFile}
            documents={documents}
            onDeleteDoc={deleteDocument}
            uploading={uploading}
            uploadProgress={uploadProgress}
            mode={activeChat.mode}
            voiceEnabled={activeAssistantCfg.voice}
          />
        )}
      </div>

      {/* Gemini Live-style full-screen voice overlay */}
      {voiceActive && (
        <VoiceOverlay status={voiceStatus} onClose={toggleVoice} />
      )}
    </div>
  )
}
