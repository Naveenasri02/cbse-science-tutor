import { useRef, useCallback } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

const CDN = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist'
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/'

export default function useVoice({ onSpeechStart, onSpeechEnd }) {
  const vadRef = useRef(null)

  const startVoice = useCallback(async () => {
    try {
      vadRef.current = await MicVAD.new({
        workletURL: `${CDN}/vad.worklet.bundle.min.js`,
        modelURL: `${CDN}/silero_vad_legacy.onnx`,
        onnxWASMBasePath: ORT_CDN,
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
