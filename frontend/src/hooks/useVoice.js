import { useRef, useCallback } from 'react'

export default function useVoice({ onSpeechStart, onSpeechEnd }) {
  const vadRef = useRef(null)
  const audioCtxRef = useRef(null)

  const startVoice = useCallback(async () => {
    try {
      // Request mic permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      stream.getTracks().forEach(t => t.stop())

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ sampleRate: 16000 })
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume()
      }

      // Dynamic import VAD (loaded from CDN or public/)
      if (!window.vad?.MicVAD) {
        console.error('VAD library not loaded')
        return false
      }

      vadRef.current = await window.vad.MicVAD.new({
        positiveSpeechThreshold: 0.7,
        negativeSpeechThreshold: 0.3,
        minSpeechFrames: 5,
        preSpeechPadFrames: 10,
        redemptionFrames: 15,
        onSpeechStart: () => onSpeechStart(),
        onSpeechEnd: (audio) => onSpeechEnd(audio),
      })

      vadRef.current.start()
      return true
    } catch (err) {
      console.error('Voice init error:', err)
      return false
    }
  }, [onSpeechStart, onSpeechEnd])

  const stopVoice = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.pause()
      vadRef.current.destroy()
      vadRef.current = null
    }
  }, [])

  return { startVoice, stopVoice }
}
