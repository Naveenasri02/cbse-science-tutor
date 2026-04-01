import { useRef, useCallback, useState } from 'react'

export default function useAudioPlayer() {
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const sourceRef = useRef(null)
  const ctxRef = useRef(null)
  const gainRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const pipelineIdRef = useRef(0)

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext({ sampleRate: 24000 })
      gainRef.current = ctxRef.current.createGain()
      gainRef.current.gain.value = 1.0
      gainRef.current.connect(ctxRef.current.destination)
    }
    return ctxRef.current
  }, [])

  const playNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      playingRef.current = false
      setIsPlaying(false)
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

      // Stop any still-playing source to prevent overlap
      if (sourceRef.current) {
        try { sourceRef.current.stop(); sourceRef.current.disconnect() } catch {}
        sourceRef.current = null
      }

      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
      const src = ctx.createBufferSource()
      src.buffer = audioBuffer
      src.connect(gainRef.current)
      sourceRef.current = src

      src.onended = () => {
        sourceRef.current = null
        playNext()
      }
      // Play immediately — no pre-scheduling, strictly sequential
      src.start(0)
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
    if (sourceRef.current) {
      try { sourceRef.current.stop(); sourceRef.current.disconnect() } catch {}
      sourceRef.current = null
    }
    playingRef.current = false
    setIsPlaying(false)
  }, [])

  return { playAudio, stopPlayback, isPlaying, isPlayingRef: playingRef }
}
