import { useRef, useCallback, useState } from 'react'

export default function useAudioPlayer() {
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const sourceRef = useRef(null)
  const ctxRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const pipelineIdRef = useRef(0)
  const nextStartRef = useRef(0)  // scheduled start time for gapless playback

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext({ sampleRate: 24000 })
    return ctxRef.current
  }, [])

  const playNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      playingRef.current = false
      setIsPlaying(false)
      nextStartRef.current = 0
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
      src.playbackRate.value = 1.15
      src.connect(ctx.destination)
      sourceRef.current = src

      // Gapless scheduling: start exactly when previous chunk ends
      const now = ctx.currentTime
      const startAt = nextStartRef.current > now ? nextStartRef.current : now
      nextStartRef.current = startAt + audioBuffer.duration / 1.15

      src.onended = () => {
        sourceRef.current = null
        playNext()
      }
      src.start(startAt)
    } catch (err) {
      console.error('Audio decode error:', err)
      sourceRef.current = null
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
    nextStartRef.current = 0
    if (sourceRef.current) {
      try { sourceRef.current.stop(); sourceRef.current.disconnect() } catch {}
      sourceRef.current = null
    }
    playingRef.current = false
    setIsPlaying(false)
  }, [])

  return { playAudio, stopPlayback, isPlaying, isPlayingRef: playingRef }
}
