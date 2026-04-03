import { useRef, useCallback, useEffect } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

export default function useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef }) {
  const vadRef = useRef(null)
  const activeRef = useRef(false)
  const bargeinCountRef = useRef(0)
  const notifiedRef = useRef(false)
  const initPromiseRef = useRef(null)

  // Stable callback refs to avoid re-creating VAD
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

        onFrameProcessed: (probabilities) => {
          if (!activeRef.current) return
          const { isSpeech } = probabilities
          const botActive = isBotRespondingRef?.current || isPlayingRef?.current

          // During playback: barge-in via sustained frames (echo-safe)
          // When idle: no barge-in needed (onSpeechStart handles it)
          if (botActive) {
            if (isSpeech > 0.82) {
              bargeinCountRef.current++
              if (!notifiedRef.current && bargeinCountRef.current >= 3) {
                notifiedRef.current = true
                onSpeechDetectedRef.current()
              }
            } else {
              bargeinCountRef.current = 0
            }
          }
        },

        onSpeechStart: () => {
          if (!activeRef.current) return
          // Suppress during playback — TTS echo triggers false starts.
          // Barge-in is handled by onFrameProcessed (0.82 × 3 frames ≈ 90ms).
          if (isBotRespondingRef?.current || isPlayingRef?.current) return
          if (!notifiedRef.current) {
            notifiedRef.current = true
            onSpeechDetectedRef.current()
          }
        },

        onSpeechEnd: (audio) => {
          if (!activeRef.current) return
          // Fallback: if bot was active and barge-in didn't fire, trigger now
          const botActive = isBotRespondingRef?.current || isPlayingRef?.current
          if (botActive && !notifiedRef.current) {
            notifiedRef.current = true
            onSpeechDetectedRef.current()
          }
          notifiedRef.current = false
          bargeinCountRef.current = 0
          if (audio.length < 1600) return
          const bytes = new Uint8Array(
            audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)
          )
          onSpeechEndRef.current(bytes)
        },

        onVADMisfire: () => {
          notifiedRef.current = false
          bargeinCountRef.current = 0
        },
      })

      vadRef.current = vad
      return vad
    })()

    return initPromiseRef.current
  }, [isPlayingRef, isBotRespondingRef])

  const startVoice = useCallback(async () => {
    try {
      const vad = await initVAD()
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
    bargeinCountRef.current = 0
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

  return { startVoice, stopVoice }
}
