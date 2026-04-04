import { useRef, useEffect, useCallback, useState } from 'react'

export default function useWebSocket(url, onMessage) {
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const onMessageRef = useRef(onMessage)
  const urlRef = useRef(url)
  const [connected, setConnected] = useState(false)
  onMessageRef.current = onMessage
  urlRef.current = url

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close()
    }

    const ws = new WebSocket(urlRef.current)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WS connected')
      setConnected(true)
      clearTimeout(reconnectTimer.current)
    }

    ws.onclose = () => {
      console.log('WS closed, reconnecting in 2s...')
      setConnected(false)
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = (e) => console.error('WS error', e)

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data)
          onMessageRef.current(msg, false)
        } catch {}
      } else {
        onMessageRef.current(event.data, true)
      }
    }
  }, [])

  const reconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current)
    setConnected(false)
    if (wsRef.current) wsRef.current.close()
    setTimeout(connect, 300)
  }, [connect])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [connect])

  return { ws: wsRef, connected, reconnect }
}
