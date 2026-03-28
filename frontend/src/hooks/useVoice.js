import { useRef, useCallback } from 'react'

export default function useVoice({ onSpeechStart, onSpeechEnd }) {
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const recordingRef = useRef(false)
  const silenceTimerRef = useRef(null)
  const analyserRef = useRef(null)
  const silenceStartRef = useRef(null)
  const rafRef = useRef(null)

  const stopRecording = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    recordingRef.current = false
  }, [])

  const startVoice = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      })
      streamRef.current = stream

      // Set up silence detection via AnalyserNode
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyserRef.current = analyser

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus' : 'audio/webm'
      })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        chunksRef.current = []

        if (blob.size < 1000) return // too short

        // Convert to Float32 PCM 16kHz for the server
        try {
          const arrayBuf = await blob.arrayBuffer()
          const actx = new AudioContext({ sampleRate: 16000 })
          const decoded = await actx.decodeAudioData(arrayBuf)
          const f32 = decoded.getChannelData(0)
          actx.close()
          onSpeechEnd(f32)
        } catch (err) {
          console.error('Audio decode error:', err)
        }
      }

      mediaRecorder.start(250) // collect data every 250ms
      recordingRef.current = true
      onSpeechStart()

      // Auto-silence detection: stop after 1.5s of silence
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      silenceStartRef.current = null

      const checkSilence = () => {
        if (!recordingRef.current) return
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

        if (avg < 8) {
          if (!silenceStartRef.current) silenceStartRef.current = Date.now()
          else if (Date.now() - silenceStartRef.current > 1500) {
            stopRecording()
            return
          }
        } else {
          silenceStartRef.current = null
        }
        rafRef.current = requestAnimationFrame(checkSilence)
      }
      rafRef.current = requestAnimationFrame(checkSilence)

      // Hard limit: 15 seconds max
      silenceTimerRef.current = setTimeout(stopRecording, 15000)

      return true
    } catch (err) {
      console.error('Voice init error:', err)
      return false
    }
  }, [onSpeechStart, onSpeechEnd, stopRecording])

  const stopVoice = useCallback(() => {
    stopRecording()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [stopRecording])

  return { startVoice, stopVoice }
}
