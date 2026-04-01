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
        minSpeechMs: 150,
        preSpeechPadMs: 500,
        redemptionMs: 600,

        onFrameProcessed: (probabilities) => {
          if (!activeRef.current) return
          const { isSpeech } = probabilities
          if (isSpeech > 0.85) {
            bargeinCountRef.current++
            const botActive = isBotRespondingRef?.current || isPlayingRef?.current
            if (botActive && !notifiedRef.current && bargeinCountRef.current >= 2) {
              notifiedRef.current = true
              onSpeechDetectedRef.current()
            }
          } else {
            bargeinCountRef.current = 0
          }
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
