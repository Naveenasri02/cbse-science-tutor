import { useState, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputBar from './components/InputBar'
import NewChatModal from './components/NewChatModal'
import useWebSocket from './hooks/useWebSocket'
import useVoice from './hooks/useVoice'
import useAudioPlayer from './hooks/useAudioPlayer'
import useDocuments from './hooks/useDocuments'

const WS_URL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voice`

function generateSessionId() {
  return Math.random().toString(36).slice(2, 14)
}

export default function App() {
  const [chats, setChats] = useState([{ id: 1, title: 'New Chat', mode: 'smart', messages: [] }])
  const [activeChatId, setActiveChatId] = useState(1)
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState({ visible: false, cls: '', text: '' })
  const [isBotResponding, setIsBotResponding] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const botBufferRef = useRef('')
  const chatIdCounter = useRef(2)
  const interruptedRef = useRef(false)
  const sessionIdRef = useRef(generateSessionId())

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0]

  // Documents (RAG)
  const { documents, uploading, uploadProgress, uploadFile, deleteDocument, clearDocuments } = useDocuments(sessionIdRef.current)

  // WebSocket URL with session_id for per-chat RAG scoping
  const wsUrl = `${WS_URL}?session_id=${sessionIdRef.current}`

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

  // Voice mode — realistic conversation flow
  const onSpeechDetected = useCallback(() => {
    // Barge-in: instant audio stop using refs (not stale state)
    if (isPlayingRef.current || isBotRespondingRef.current) {
      interruptedRef.current = true
      stopPlayback()
      setIsBotResponding(false)
      isBotRespondingRef.current = false
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'interrupt' }))
      }
    }
    setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Recording...' })
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
      // Show overlay immediately while VAD loads
      setVoiceActive(true)
      setVoiceStatus({ visible: true, cls: 'processing', text: '⏳ Starting...' })
      const ok = await startVoice()
      if (ok) {
        setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
      } else {
        // Show error briefly then close
        setVoiceStatus({ visible: true, cls: 'error', text: '❌ Mic failed' })
        setTimeout(() => {
          setVoiceActive(false)
          setVoiceStatus({ visible: false, cls: '', text: '' })
        }, 3000)
      }
    }
  }

  const sendText = (text) => {
    if (!text.trim() || !ws.current || ws.current.readyState !== WebSocket.OPEN) return
    addMsg('user', text.trim())
    updateChatTitle(text.trim())
    const payload = { type: 'text_chat', text: text.trim() }
    // In doc mode, request parallel TTS so response is read aloud
    if (activeChat.mode === 'doc') payload.tts = true
    ws.current.send(JSON.stringify(payload))
  }

  const newChat = () => {
    setShowNewChatModal(true)
    setSidebarOpen(false)
  }

  const handleNewChatMode = (mode) => {
    setShowNewChatModal(false)
    const id = chatIdCounter.current++
    setChats(prev => [...prev, { id, title: 'New Chat', mode, messages: [] }])
    setActiveChatId(id)
    clearDocuments()
    sessionIdRef.current = generateSessionId()
    reconnect()
  }

  const deleteChat = (id) => {
    setChats(prev => {
      const next = prev.filter(c => c.id !== id)
      if (next.length === 0) {
        const newId = chatIdCounter.current++
        next.push({ id: newId, title: 'New Chat', mode: 'smart', messages: [] })
        setActiveChatId(newId)
      } else if (activeChatId === id) {
        setActiveChatId(next[next.length - 1].id)
      }
      return next
    })
  }

  const switchChat = (id) => {
    setActiveChatId(id)
    setSidebarOpen(false)
    clearDocuments()
    sessionIdRef.current = generateSessionId()
    reconnect()
  }

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onNewChat={newChat}
        onSwitchChat={switchChat}
        onDeleteChat={deleteChat}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-[#2a2a2a] bg-[#212121] shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden text-lg text-[#8e8ea0] hover:text-white transition-colors">☰</button>
            <h1 className="text-sm font-semibold text-[#ececf1] hidden md:block">AI Chat</h1>
            <span className="md:hidden text-sm font-medium truncate text-[#ececf1]">{activeChat.title}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-[#2a2a2a] text-[#8e8ea0] font-medium">AI Assistant</span>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#10a37f]' : 'bg-[#ef4444] animate-pulse'}`}
              title={connected ? 'Connected' : 'Reconnecting...'} />
          </div>
        </header>

        <ChatArea messages={activeChat.messages} isBotResponding={isBotResponding} mode={activeChat.mode} />
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
        />
      </div>

      {showNewChatModal && (
        <NewChatModal
          onSelect={handleNewChatMode}
          onClose={() => setShowNewChatModal(false)}
        />
      )}
    </div>
  )
}
