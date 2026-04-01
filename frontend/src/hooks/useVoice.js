import { useRef, useCallback } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

export default function useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef }) {
  const vadRef = useRef(null)
  const activeRef = useRef(false)
  const bargeinCountRef = useRef(0)
  const notifiedRef = useRef(false)

  const startVoice = useCallback(async () => {
    try {
      const vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/',
        onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/',

        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.3,
        minSpeechMs: 250,
        preSpeechPadMs: 250,
        redemptionMs: 900,

        onFrameProcessed: (probabilities) => {
          if (!activeRef.current) return
          const { isSpeech } = probabilities
          if (isSpeech > 0.85) {
            bargeinCountRef.current++
            const botActive = isBotRespondingRef?.current || isPlayingRef?.current
            if (botActive && !notifiedRef.current && bargeinCountRef.current >= 2) {
              notifiedRef.current = true
              onSpeechDetected()
            }
          } else {
            bargeinCountRef.current = 0
          }
        },

        onSpeechStart: () => {
          if (!activeRef.current) return
          if (!notifiedRef.current) {
            notifiedRef.current = true
            onSpeechDetected()
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
          onSpeechEnd(bytes)
        },

        onVADMisfire: () => {
          notifiedRef.current = false
          bargeinCountRef.current = 0
        },
      })

      vad.start()
      vadRef.current = vad
      activeRef.current = true
      return true
    } catch (err) {
      console.error('VAD init error:', err)
      return false
    }
  }, [onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef])

  const stopVoice = useCallback(() => {
    activeRef.current = false
    if (vadRef.current) {
      vadRef.current.destroy()
      vadRef.current = null
    }
    bargeinCountRef.current = 0
    notifiedRef.current = false
  }, [])

  return { startVoice, stopVoice }
}
