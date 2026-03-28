import { useRef, useCallback, useState } from 'react'

export default function useAudioPlayer() {
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const sourceRef = useRef(null)
  const ctxRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const playNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      playingRef.current = false
      setIsPlaying(false)
      return
    }

    playingRef.current = true
    setIsPlaying(true)
    const buffer = queueRef.current.shift()

    try {
      if (!ctxRef.current) ctxRef.current = new AudioContext({ sampleRate: 16000 })
      if (ctxRef.current.state === 'suspended') await ctxRef.current.resume()

      const audioBuffer = await ctxRef.current.decodeAudioData(buffer.slice(0))
      const src = ctxRef.current.createBufferSource()
      src.buffer = audioBuffer
      src.connect(ctxRef.current.destination)
      sourceRef.current = src
      src.onended = () => {
        sourceRef.current = null
        playNext()
      }
      src.start()
    } catch (err) {
      console.error('Audio decode error:', err)
      sourceRef.current = null
      playNext()
    }
  }, [])

  const playAudio = useCallback((arrayBuffer) => {
    queueRef.current.push(arrayBuffer)
    if (!playingRef.current) playNext()
  }, [playNext])

  const stopPlayback = useCallback(() => {
    queueRef.current = []
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
        sourceRef.current.disconnect()
      } catch {}
      sourceRef.current = null
    }
    playingRef.current = false
    setIsPlaying(false)
  }, [])

  return { playAudio, stopPlayback, isPlaying }
}
