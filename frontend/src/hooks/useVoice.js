import { useRef, useCallback } from 'react'

export default function useVoice({ onSpeechStart, onSpeechEnd }) {
  const streamRef = useRef(null)
  const activeRef = useRef(false)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const analyserRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)
  const silenceStartRef = useRef(null)
  const hasSpeechRef = useRef(false)

  const stopCurrentRecording = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }, [])

  const startRecordingCycle = useCallback(() => {
    if (!activeRef.current || !streamRef.current) return

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm'
    })
    recorderRef.current = recorder
    chunksRef.current = []
    hasSpeechRef.current = false
    silenceStartRef.current = null

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      const chunks = chunksRef.current
      chunksRef.current = []

      if (!hasSpeechRef.current || chunks.length === 0) {
        if (activeRef.current) setTimeout(() => startRecordingCycle(), 50)
        return
      }

      const blob = new Blob(chunks, { type: 'audio/webm' })
      if (blob.size < 500) {
        if (activeRef.current) setTimeout(() => startRecordingCycle(), 50)
        return
      }

      // Send webm blob directly — server decodes with ffmpeg (faster than client-side decode)
      try {
        const arrayBuf = await blob.arrayBuffer()
        onSpeechEnd(new Uint8Array(arrayBuf))
      } catch (err) {
        console.error('Audio send error:', err)
      }

      // Auto-restart recording after sending (continuous mode)
      if (activeRef.current) setTimeout(() => startRecordingCycle(), 100)
    }

    recorder.start(200)
    onSpeechStart()

    // Silence detection loop
    const analyser = analyserRef.current
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const checkAudio = () => {
      if (!activeRef.current) return
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

      if (avg > 10) {
        // Speech detected
        hasSpeechRef.current = true
        silenceStartRef.current = null
      } else if (hasSpeechRef.current) {
        // Silence after speech
        if (!silenceStartRef.current) {
          silenceStartRef.current = Date.now()
        } else if (Date.now() - silenceStartRef.current > 800) {
          // 0.8s silence after speech → send it
          stopCurrentRecording()
          return
        }
      }

      rafRef.current = requestAnimationFrame(checkAudio)
    }
    rafRef.current = requestAnimationFrame(checkAudio)
  }, [onSpeechStart, onSpeechEnd, stopCurrentRecording])

  const startVoice = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      })
      streamRef.current = stream
      activeRef.current = true

      // Analyser for silence detection
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const source = audioCtxRef.current.createMediaStreamSource(stream)
      const analyser = audioCtxRef.current.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyserRef.current = analyser

      // Start first recording cycle
      startRecordingCycle()
      return true
    } catch (err) {
      console.error('Voice init error:', err)
      return false
    }
  }, [startRecordingCycle])

  const stopVoice = useCallback(() => {
    activeRef.current = false
    stopCurrentRecording()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [stopCurrentRecording])

  return { startVoice, stopVoice }
}
