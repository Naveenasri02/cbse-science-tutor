import { useRef, useCallback, useEffect } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

export default function useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef }) {
  const vadRef = useRef(null)
  const activeRef = useRef(false)
  const notifiedRef = useRef(false)
  const initPromiseRef = useRef(null)
  const pausedForPlaybackRef = useRef(false)

  const onSpeechDetectedRef = useRef(onSpeechDetected)
  const onSpeechEndRef = useRef(onSpeechEnd)
  onSpeechDetectedRef.current = onSpeechDetected
  onSpeechEndRef.current = onSpeechEnd

  const initVAD = useCallback(async () => {
    if (vadRef.current) return vadRef.current
    if (initPromiseRef.current) return initPromiseRef.current

    initPromiseRef.current = (async () => {
      const vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/',
        onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/',

        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        minSpeechMs: 250,
        preSpeechPadMs: 400,
        redemptionMs: 800,

        additionalAudioConstraints: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },

        onSpeechStart: () => {
          if (!activeRef.current) return
          if (!notifiedRef.current) {
            notifiedRef.current = true
            onSpeechDetectedRef.current()
          }
        },

        onSpeechEnd: (audio) => {
          if (!activeRef.current) return
          notifiedRef.current = false
          if (audio.length < 1600) return
          const bytes = new Uint8Array(
            audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)
          )
          onSpeechEndRef.current(bytes)
        },

        onVADMisfire: () => {
          notifiedRef.current = false
        },
      })

      vadRef.current = vad
      return vad
    })()

    return initPromiseRef.current
  }, [])

  // Pause VAD while TTS is playing to avoid echo triggers
  const pauseForPlayback = useCallback(() => {
    if (vadRef.current && activeRef.current && !pausedForPlaybackRef.current) {
      pausedForPlaybackRef.current = true
      vadRef.current.pause()
    }
  }, [])

  // Resume VAD after TTS finishes
  const resumeAfterPlayback = useCallback(() => {
    if (vadRef.current && activeRef.current && pausedForPlaybackRef.current) {
      pausedForPlaybackRef.current = false
      vadRef.current.start()
    }
  }, [])

  const startVoice = useCallback(async () => {
    try {
      const vad = await initVAD()
      pausedForPlaybackRef.current = false
      vad.start()
      activeRef.current = true
      return true
    } catch (err) {
      console.error('VAD init error:', err)
      return false
    }
  }, [initVAD])

  const stopVoice = useCallback(() => {
    activeRef.current = false
    pausedForPlaybackRef.current = false
    notifiedRef.current = false
    if (vadRef.current) {
      vadRef.current.pause()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (vadRef.current) {
        vadRef.current.destroy()
        vadRef.current = null
      }
    }
  }, [])

  return { startVoice, stopVoice, pauseForPlayback, resumeAfterPlayback }
}
