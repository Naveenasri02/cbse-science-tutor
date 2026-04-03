import { useState, useRef, useCallback } from 'react'
import LandingPage from './components/LandingPage'
import Sidebar, { ASSISTANTS } from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputBar from './components/InputBar'

import useWebSocket from './hooks/useWebSocket'
import useVoice from './hooks/useVoice'
import useAudioPlayer from './hooks/useAudioPlayer'
import useDocuments from './hooks/useDocuments'
import { palette } from './palette'

const WS_URL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voice`

function generateSessionId() {
  return Math.random().toString(36).slice(2, 14)
}

export default function App() {
  const [pageMode, setPageMode] = useState('landing')
  const [chats, setChats] = useState([{ id: 1, title: 'New Chat', mode: 'doc', assistant: 'legal', messages: [] }])
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

  // WebSocket handler
  const onMessage = useCallback((msg, binary) => {
    if (binary) {
      // Discard stale TTS audio from interrupted pipeline
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
          setVoiceStatus({ visible: true, cls: 'speaking', text: '🔊 Speaking...' })
          ttsPlayingSinceRef.current = Date.now()
        }
        break

      case 'tts_done':
        setIsBotResponding(false)
        isBotRespondingRef.current = false
        ttsPlayingSinceRef.current = 0
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

  // Voice mode — instant barge-in on speech start
  const onSpeechDetected = useCallback(() => {
    if (isBotRespondingRef.current || isPlayingRef.current) {
      // Grace period: suppress during first 2s of TTS — echo from AEC convergence
      if (ttsPlayingSinceRef.current > 0 && Date.now() - ttsPlayingSinceRef.current < 2000) return
      interruptedRef.current = true
      stopPlayback()
      setIsBotResponding(false)
      isBotRespondingRef.current = false
      ttsPlayingSinceRef.current = 0
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'interrupt' }))
      }
    }
    setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Recording...' })
  }, [stopPlayback, ws])

  const onSpeechEnd = useCallback((audio) => {
    // If bot is responding/playing, check for barge-in
    if (isBotRespondingRef.current || isPlayingRef.current) {
      // Grace period: suppress during first 2s of TTS — echo from AEC convergence
      if (ttsPlayingSinceRef.current > 0 && Date.now() - ttsPlayingSinceRef.current < 2000) return
      interruptedRef.current = true
      stopPlayback()
      setIsBotResponding(false)
      isBotRespondingRef.current = false
      ttsPlayingSinceRef.current = 0
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'interrupt' }))
      }
    }
    setVoiceStatus({ visible: true, cls: 'processing', text: '⏳ Processing...' })
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(audio.buffer)
    }
  }, [stopPlayback, ws])

  const { startVoice, stopVoice } = useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef })

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
    addMsg('user', text.trim())
    updateChatTitle(text.trim())
    const payload = { type: 'text_chat', text: text.trim() }
    ws.current.send(JSON.stringify(payload))
  }

  const selectAssistant = (assistantKey) => {
    const cfg = ASSISTANTS.find(a => a.key === assistantKey)
    if (!cfg) return
    stopCurrentResponse()
    setActiveAssistant(assistantKey)

    // If current chat is empty (no messages), just switch it to the new assistant
    const currentChat = chats.find(c => c.id === activeChatId)
    if (currentChat && currentChat.messages.length === 0) {
      setChats(prev => prev.map(c =>
        c.id === activeChatId ? { ...c, assistant: assistantKey, mode: cfg.mode } : c
      ))
    } else {
      // Current chat has messages — find existing empty chat for this assistant or create new
      const existingEmpty = chats.find(c => c.assistant === assistantKey && c.messages.length === 0)
      if (existingEmpty) {
        setActiveChatId(existingEmpty.id)
      } else {
        const id = chatIdCounter.current++
        setChats(prev => [...prev, { id, title: 'New Chat', mode: cfg.mode, assistant: assistantKey, messages: [] }])
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
        next.push({ id: newId, title: 'New Chat', mode: 'doc', assistant: activeAssistant, messages: [] })
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
    <div className="h-screen flex overflow-hidden" style={{ background: palette.bg, color: palette.textPrimary }}>
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
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header
          className="flex items-center justify-between border-b px-4 py-3 md:px-5 shrink-0"
          style={{ borderColor: palette.border, background: palette.bg }}
        >
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-sm transition-colors"
              style={{ color: palette.textMuted }}
            >
              ☰
            </button>
            <div className="text-[13px] font-semibold" style={{ color: palette.textPrimary }}>
              Secure AI Chat
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div
              className="rounded-full px-3 py-1.5 text-[12px]"
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
          onTryClick={sendText}
        />
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
      </div>

    </div>
  )
}
