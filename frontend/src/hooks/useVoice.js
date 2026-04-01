import { useRef, useCallback } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

const POSITIVE_THRESHOLD = 0.6
const NEGATIVE_THRESHOLD = 0.3
const MIN_SPEECH_FRAMES = 3
const PRESPEECH_PAD_FRAMES = 3
const REDEMPTION_FRAMES = 10
const BARGEIN_PROBABILITY = 0.85
const BARGEIN_FRAMES = 2

export default function useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef }) {
  const vadRef = useRef(null)
  const activeRef = useRef(false)
  const bargeinCountRef = useRef(0)
  const notifiedRef = useRef(false)

  const startVoice = useCallback(async () => {
    try {
      // Set ONNX Runtime WASM paths before VAD init
      try {
        const ort = await import('onnxruntime-web')
        ort.env.wasm.wasmPaths = '/'
      } catch (e) {
        console.warn('ONNX WASM path config skipped:', e)
      }

      const vad = await MicVAD.new({
        modelURL: '/silero_vad_v5.onnx',
        workletURL: '/vad.worklet.bundle.min.js',

        positiveSpeechThreshold: POSITIVE_THRESHOLD,
        negativeSpeechThreshold: NEGATIVE_THRESHOLD,
        minSpeechFrames: MIN_SPEECH_FRAMES,
        preSpeechPadFrames: PRESPEECH_PAD_FRAMES,
        redemptionFrames: REDEMPTION_FRAMES,

        onFrameProcessed: (probabilities) => {
          if (!activeRef.current) return
          const { isSpeech } = probabilities
          if (isSpeech > BARGEIN_PROBABILITY) {
            bargeinCountRef.current++
            const botActive = isBotRespondingRef?.current || isPlayingRef?.current
            if (botActive && !notifiedRef.current && bargeinCountRef.current >= BARGEIN_FRAMES) {
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
      console.log('✅ Silero VAD initialized')
      return true
    } catch (err) {
      console.error('Silero VAD init error:', err)
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
