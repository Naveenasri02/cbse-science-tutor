import { useRef, useEffect, useCallback, useState } from 'react'

export default function useWebSocket(url, onMessage) {
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const onMessageRef = useRef(onMessage)
  const urlRef = useRef(url)
  const intentionalCloseRef = useRef(false)
  const [connected, setConnected] = useState(false)
  onMessageRef.current = onMessage
  urlRef.current = url

  const connect = useCallback(() => {
    clearTimeout(reconnectTimer.current)
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      intentionalCloseRef.current = true
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
      setConnected(false)
      if (intentionalCloseRef.current) {
        intentionalCloseRef.current = false
        return
      }
      console.log('WS closed unexpectedly, reconnecting in 2s...')
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
    intentionalCloseRef.current = true
    setConnected(false)
    if (wsRef.current) wsRef.current.close()
    reconnectTimer.current = setTimeout(connect, 300)
  }, [connect])

  useEffect(() => {
    connect()
    return () => {
      intentionalCloseRef.current = true
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [connect])

  return { ws: wsRef, connected, reconnect }
}
