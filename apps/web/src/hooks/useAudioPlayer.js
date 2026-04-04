import { useRef, useCallback, useState } from 'react'

export default function useAudioPlayer() {
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const activeSourcesRef = useRef([])
  const ctxRef = useRef(null)
  const gainRef = useRef(null)
  const audioElRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const pipelineIdRef = useRef(0)
  const nextStartTimeRef = useRef(0)

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext({ sampleRate: 24000 })
      gainRef.current = ctxRef.current.createGain()
      gainRef.current.gain.value = 1.0

      // Route through <audio> element so browser AEC gets a proper echo reference
      const dest = ctxRef.current.createMediaStreamDestination()
      gainRef.current.connect(dest)
      const el = new Audio()
      el.srcObject = dest.stream
      el.play().catch(() => {})
      audioElRef.current = el
    }
    return ctxRef.current
  }, [])

  const playNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      playingRef.current = false
      setIsPlaying(false)
      nextStartTimeRef.current = 0
      return
    }

    playingRef.current = true
    setIsPlaying(true)
    const { buffer, pipelineId } = queueRef.current.shift()

    if (pipelineId !== pipelineIdRef.current) {
      playNext()
      return
    }

    try {
      const ctx = getCtx()
      if (ctx.state === 'suspended') await ctx.resume()

      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
      const src = ctx.createBufferSource()
      src.buffer = audioBuffer
      src.connect(gainRef.current)

      const now = ctx.currentTime
      const startAt = nextStartTimeRef.current > now ? nextStartTimeRef.current : now
      nextStartTimeRef.current = startAt + audioBuffer.duration

      // Track all scheduled sources so stopPlayback can kill them all
      activeSourcesRef.current.push(src)

      src.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== src)
        // Only chain to next if this source is still from current pipeline
        if (pipelineId === pipelineIdRef.current) playNext()
      }
      src.start(startAt)
    } catch (err) {
      console.error('Audio decode error:', err)
      playNext()
    }
  }, [getCtx])

  const playAudio = useCallback((arrayBuffer) => {
    queueRef.current.push({ buffer: arrayBuffer, pipelineId: pipelineIdRef.current })
    if (!playingRef.current) playNext()
  }, [playNext])

  const stopPlayback = useCallback(() => {
    pipelineIdRef.current++
    queueRef.current = []
    nextStartTimeRef.current = 0
    // Stop ALL scheduled/playing sources immediately
    for (const src of activeSourcesRef.current) {
      try { src.stop(); src.disconnect() } catch {}
    }
    activeSourcesRef.current = []
    playingRef.current = false
    setIsPlaying(false)
  }, [])

  return { playAudio, stopPlayback, isPlaying, isPlayingRef: playingRef }
}
