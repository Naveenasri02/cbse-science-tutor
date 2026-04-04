import { useRef, useCallback, useEffect } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

export default function useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef }) {
  const vadRef = useRef(null)
  const activeRef = useRef(false)
  const notifiedRef = useRef(false)
  const initPromiseRef = useRef(null)
  const notifiedTimerRef = useRef(null)

  const onSpeechDetectedRef = useRef(onSpeechDetected)
  const onSpeechEndRef = useRef(onSpeechEnd)
  onSpeechDetectedRef.current = onSpeechDetected
  onSpeechEndRef.current = onSpeechEnd

  // Safety: auto-reset notifiedRef if stuck for >5s (prevents dead mic after echo)
  const startNotifiedTimer = useCallback(() => {
    clearTimeout(notifiedTimerRef.current)
    notifiedTimerRef.current = setTimeout(() => {
      if (notifiedRef.current) {
        console.warn('VAD: notifiedRef stuck for 5s, resetting')
        notifiedRef.current = false
      }
    }, 5000)
  }, [])

  const clearNotifiedTimer = useCallback(() => {
    clearTimeout(notifiedTimerRef.current)
  }, [])

  const initVAD = useCallback(async () => {
    if (vadRef.current) return vadRef.current
    if (initPromiseRef.current) return initPromiseRef.current

    initPromiseRef.current = (async () => {
      const vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/',
        onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/',

        positiveSpeechThreshold: 0.35,
        negativeSpeechThreshold: 0.15,
        minSpeechMs: 150,
        preSpeechPadMs: 300,
        redemptionMs: 400,

        additionalAudioConstraints: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },

        onSpeechStart: () => {
          try {
            if (!activeRef.current) return
            if (!notifiedRef.current) {
              notifiedRef.current = true
              startNotifiedTimer()
              console.log('VAD: speech detected — triggering callback')
              onSpeechDetectedRef.current()
            }
          } catch (err) {
            console.error('VAD onSpeechStart error:', err)
            notifiedRef.current = false
          }
        },

        onSpeechEnd: (audio) => {
          try {
            if (!activeRef.current) return
            notifiedRef.current = false
            clearNotifiedTimer()
            if (audio.length < 1600) return
            const bytes = new Uint8Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength))
            if (bytes.length === 0) return
            onSpeechEndRef.current(bytes)
          } catch (err) {
            console.error('VAD onSpeechEnd error:', err)
            notifiedRef.current = false
          }
        },

        onVADMisfire: () => {
          notifiedRef.current = false
          clearNotifiedTimer()
        },
      })

      vadRef.current = vad
      return vad
    })()

    return initPromiseRef.current
  }, [startNotifiedTimer, clearNotifiedTimer])

  const startVoice = useCallback(async () => {
    try {
      const vad = await initVAD()
      vad.start()
      activeRef.current = true
      notifiedRef.current = false
      return true
    } catch (err) {
      console.error('VAD init error:', err)
      vadRef.current = null
      initPromiseRef.current = null
      return false
    }
  }, [initVAD])

  // Reset VAD state — call after bot finishes speaking to ensure mic is fresh
  const resetVoice = useCallback(() => {
    notifiedRef.current = false
    clearNotifiedTimer()
    if (vadRef.current && activeRef.current) {
      try {
        vadRef.current.pause()
        vadRef.current.start()
      } catch (err) {
        console.error('VAD reset error:', err)
      }
    }
  }, [clearNotifiedTimer])

  const stopVoice = useCallback(() => {
    activeRef.current = false
    notifiedRef.current = false
    clearNotifiedTimer()
    if (vadRef.current) {
      vadRef.current.pause()
    }
  }, [clearNotifiedTimer])

  useEffect(() => {
    return () => {
      clearTimeout(notifiedTimerRef.current)
      if (vadRef.current) {
        vadRef.current.destroy()
        vadRef.current = null
      }
    }
  }, [])

  return { startVoice, stopVoice, resetVoice }
}
