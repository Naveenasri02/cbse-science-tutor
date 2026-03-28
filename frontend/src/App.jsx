import { useState, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputBar from './components/InputBar'
import VoiceStatus from './components/VoiceStatus'
import useWebSocket from './hooks/useWebSocket'
import useVoice from './hooks/useVoice'
import useAudioPlayer from './hooks/useAudioPlayer'

const WS_URL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voice`

export default function App() {
  const [chats, setChats] = useState([{ id: 1, title: 'New Chat', messages: [] }])
  const [activeChatId, setActiveChatId] = useState(1)
  const [voiceActive, setVoiceActive] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState({ visible: false, cls: '', text: '' })
  const [isBotResponding, setIsBotResponding] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const botBufferRef = useRef('')
  const chatIdCounter = useRef(2)

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0]

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
  const { playAudio, stopPlayback, isPlaying } = useAudioPlayer()

  // WebSocket handler
  const onMessage = useCallback((msg, binary) => {
    if (binary) {
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
        setIsBotResponding(true)
        botBufferRef.current = ''
        addMsg('bot', '')
        setVoiceStatus({ visible: true, cls: 'thinking', text: '💭 Thinking...' })
        break

      case 'llm_delta': {
        botBufferRef.current += msg.text
        let clean = botBufferRef.current.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
        clean = clean.replace(/<think>[\s\S]*$/g, '')
        updateLastBotMsg(clean)
        break
      }

      case 'llm_done':
        setIsBotResponding(false)
        if (msg.interrupted) {
          botBufferRef.current += ' …'
        }
        let final = botBufferRef.current.replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/<think>[\s\S]*$/g, '')
        if (msg.interrupted) final += ' …'
        updateLastBotMsg(final)
        botBufferRef.current = ''
        setVoiceStatus(v => v.cls === 'thinking' ? { ...v, visible: false } : v)
        break

      case 'tts_start':
        setVoiceStatus({ visible: true, cls: 'speaking', text: '🔊 Speaking...' })
        break

      case 'tts_done':
        setIsBotResponding(false)
        if (voiceActive) {
          setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
        } else {
          setVoiceStatus({ visible: false, cls: '', text: '' })
        }
        break

      case 'vad_no_speech':
        if (voiceActive) setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Listening...' })
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

  const { ws, connected, reconnect } = useWebSocket(WS_URL, onMessage)

  // Voice mode
  const onSpeechStart = useCallback(() => {
    setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Recording...' })
    if (isPlaying || isBotResponding) {
      stopPlayback()
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'interrupt' }))
      }
    }
  }, [isPlaying, isBotResponding, stopPlayback, ws])

  const onSpeechEnd = useCallback((audio) => {
    setVoiceStatus({ visible: true, cls: 'processing', text: '⏳ Processing...' })
    setVoiceActive(false)
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(audio.buffer)
    }
  }, [ws])

  const { startVoice, stopVoice } = useVoice({ onSpeechStart, onSpeechEnd })

  const toggleVoice = async () => {
    if (voiceActive) {
      stopVoice()
      stopPlayback()
      setVoiceActive(false)
      setVoiceStatus({ visible: false, cls: '', text: '' })
    } else {
      const ok = await startVoice()
      if (ok) {
        setVoiceActive(true)
        setVoiceStatus({ visible: true, cls: 'listening', text: '🎤 Recording...' })
      }
    }
  }

  const sendText = (text) => {
    if (!text.trim() || !ws.current || ws.current.readyState !== WebSocket.OPEN) return
    addMsg('user', text.trim())
    updateChatTitle(text.trim())
    ws.current.send(JSON.stringify({ type: 'text_chat', text: text.trim() }))
  }

  const newChat = () => {
    const id = chatIdCounter.current++
    setChats(prev => [...prev, { id, title: 'New Chat', messages: [] }])
    setActiveChatId(id)
    setSidebarOpen(false)
    // Reconnect WS to reset server-side history
    reconnect()
  }

  const deleteChat = (id) => {
    setChats(prev => {
      const next = prev.filter(c => c.id !== id)
      if (next.length === 0) {
        const newId = chatIdCounter.current++
        next.push({ id: newId, title: 'New Chat', messages: [] })
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
        {/* Mobile header */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-[#2f2f2f]">
          <button onClick={() => setSidebarOpen(true)} className="text-xl">☰</button>
          <span className="font-semibold text-sm truncate">{activeChat.title}</span>
        </div>

        <ChatArea messages={activeChat.messages} isBotResponding={isBotResponding} />
        <VoiceStatus status={voiceStatus} />
        <InputBar
          onSend={sendText}
          onToggleVoice={toggleVoice}
          voiceActive={voiceActive}
          disabled={!connected}
        />
      </div>
    </div>
  )
}
