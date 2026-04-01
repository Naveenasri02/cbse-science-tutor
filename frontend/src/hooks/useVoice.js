import { useRef, useCallback } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

// ── Silero VAD thresholds (tuned for noisy environments) ──
const POSITIVE_THRESHOLD = 0.6   // Probability to START speech (default 0.5 — raised to reject noise)
const NEGATIVE_THRESHOLD = 0.3   // Probability to END speech (default 0.35)
const MIN_SPEECH_FRAMES = 3      // ~288ms of speech to confirm (rejects short bursts)
const PRESPEECH_PAD_FRAMES = 3   // ~288ms audio kept before speech onset
const REDEMPTION_FRAMES = 10     // ~960ms silence tolerance before ending

// ── Barge-in thresholds (strict to avoid false interrupts) ──
const BARGEIN_PROBABILITY = 0.85 // Very high confidence required to interrupt bot
const BARGEIN_FRAMES = 2         // Consecutive high-confidence frames (~192ms)

export default function useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef }) {
  const vadRef = useRef(null)
  const activeRef = useRef(false)
  const bargeinCountRef = useRef(0)
  const notifiedRef = useRef(false)

  const startVoice = useCallback(async () => {
    try {
      const vad = await MicVAD.new({
        positiveSpeechThreshold: POSITIVE_THRESHOLD,
        negativeSpeechThreshold: NEGATIVE_THRESHOLD,
        minSpeechFrames: MIN_SPEECH_FRAMES,
        preSpeechPadFrames: PRESPEECH_PAD_FRAMES,
        redemptionFrames: REDEMPTION_FRAMES,

        // Per-frame callback for responsive barge-in
        onFrameProcessed: (probabilities) => {
          if (!activeRef.current) return
          const { isSpeech } = probabilities

          if (isSpeech > BARGEIN_PROBABILITY) {
            bargeinCountRef.current++
            const botActive = isBotRespondingRef?.current && !isPlayingRef?.current
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

          // audio: Float32Array at 16kHz from Silero VAD
          if (audio.length < 1600) return // <100ms — too short

          // Send as raw bytes (same format backend expects for Float32 PCM)
          const bytes = new Uint8Array(
            audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)
          )
          onSpeechEnd(bytes)
        },

        onVADMisfire: () => {
          // Speech was too short — Silero rejected it
          notifiedRef.current = false
          bargeinCountRef.current = 0
        },
      })

      vad.start()
      vadRef.current = vad
      activeRef.current = true
      console.log('✅ Silero VAD initialized (ML-based speech detection)')
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
