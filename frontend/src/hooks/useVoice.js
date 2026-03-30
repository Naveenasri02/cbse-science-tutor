import { useRef, useCallback } from 'react'

// AudioWorklet processor — captures raw PCM samples on the audio thread
const WORKLET_CODE = `
class PCMCapture extends AudioWorkletProcessor {
  constructor() { super(); this._buf = [] }
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) this._buf.push(ch[i])
      if (this._buf.length >= 2400) {
        this.port.postMessage(new Float32Array(this._buf))
        this._buf = []
      }
    }
    return true
  }
}
registerProcessor('pcm-capture', PCMCapture)
`

const SILENCE_MS = 900       // ms of silence before sending (allows natural pauses)
const SPEECH_THRESHOLD = 14  // VAD energy threshold for normal speech
const BARGEIN_THRESHOLD = 22 // Higher energy required to interrupt bot (avoids false barge-in)
const BARGEIN_RATIO = 0.55   // Stricter speech-band ratio for barge-in
const BARGEIN_FRAMES = 3     // Consecutive speech frames before barge-in (~48ms)
const MIN_SPEECH_FRAMES = 2  // consecutive frames to confirm normal speech
const PRE_BUFFER_MS = 150    // capture audio before speech onset
const SPEECH_BAND_RATIO = 0.4 // speech-band energy must be ≥40% of total (human voice filter)

export default function useVoice({ onSpeechDetected, onSpeechEnd, isPlayingRef, isBotRespondingRef }) {
  const activeRef = useRef(false)
  const streamRef = useRef(null)
  const ctxRef = useRef(null)
  const workletRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)

  // VAD state
  const silenceStartRef = useRef(null)
  const hasSpeechRef = useRef(false)
  const notifiedRef = useRef(false)
  const speechFramesRef = useRef(0)

  // PCM capture
  const pcmRef = useRef([])           // speech audio chunks
  const preBufferRef = useRef([])     // rolling pre-speech buffer
  const nativeSRRef = useRef(48000)
  const useWorkletRef = useRef(false) // true if AudioWorklet available

  // Fallback: MediaRecorder refs
  const recorderRef = useRef(null)
  const recChunksRef = useRef([])

  function downsample(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples
    const ratio = fromRate / toRate
    const len = Math.floor(samples.length / ratio)
    const out = new Float32Array(len)
    for (let i = 0; i < len; i++) out[i] = samples[Math.floor(i * ratio)]
    return out
  }

  const resetVAD = useCallback(() => {
    pcmRef.current = []
    hasSpeechRef.current = false
    notifiedRef.current = false
    silenceStartRef.current = null
    speechFramesRef.current = 0
  }, [])

  const sendPCM = useCallback(() => {
    const chunks = pcmRef.current
    pcmRef.current = []
    if (chunks.length === 0) return

    let total = 0
    for (const c of chunks) total += c.length
    const combined = new Float32Array(total)
    let off = 0
    for (const c of chunks) { combined.set(c, off); off += c.length }

    const down = downsample(combined, nativeSRRef.current, 16000)
    if (down.length < 1600) return // too short

    onSpeechEnd(new Uint8Array(down.buffer))
  }, [onSpeechEnd])

  const sendWebm = useCallback(async () => {
    const chunks = recChunksRef.current
    recChunksRef.current = []
    if (chunks.length === 0) return

    const blob = new Blob(chunks, { type: 'audio/webm' })
    if (blob.size < 300) return

    const buf = await blob.arrayBuffer()
    onSpeechEnd(new Uint8Array(buf))
  }, [onSpeechEnd])

  const runVAD = useCallback(() => {
    if (!activeRef.current || !analyserRef.current) return
    const analyser = analyserRef.current
    const data = new Uint8Array(analyser.frequencyBinCount)

    const check = () => {
      if (!activeRef.current) return

      // Skip VAD while audio is playing — on mobile, speaker audio leaks into mic
      // causing false barge-in (echo cancellation isn't reliable on phones)
      if (isPlayingRef?.current) {
        speechFramesRef.current = 0
        rafRef.current = requestAnimationFrame(check)
        return
      }

      analyser.getByteFrequencyData(data)

      // Overall energy
      const avg = data.reduce((a, b) => a + b, 0) / data.length

      // Frequency-band analysis: human speech is 300-3400 Hz
      // Each bin = sampleRate / fftSize Hz wide
      const binHz = (ctxRef.current?.sampleRate || 48000) / (analyser.fftSize || 512)
      const loIdx = Math.floor(300 / binHz)   // ~300 Hz
      const hiIdx = Math.min(Math.ceil(3400 / binHz), data.length - 1) // ~3400 Hz
      let speechEnergy = 0, totalEnergy = 0
      for (let i = 0; i < data.length; i++) {
        totalEnergy += data[i]
        if (i >= loIdx && i <= hiIdx) speechEnergy += data[i]
      }
      const speechRatio = totalEnergy > 0 ? speechEnergy / totalEnergy : 0

      // Must pass BOTH energy threshold AND speech-band ratio (filters out non-voice sounds)
      const isSpeech = avg > SPEECH_THRESHOLD && speechRatio >= SPEECH_BAND_RATIO

      if (isSpeech) {
        speechFramesRef.current++

        // Barge-in: use STRICTER thresholds to avoid false interrupts from ambient noise
        const botActive = isPlayingRef?.current || isBotRespondingRef?.current
        if (botActive && !notifiedRef.current) {
          const isStrongSpeech = avg > BARGEIN_THRESHOLD && speechRatio >= BARGEIN_RATIO
          if (isStrongSpeech && speechFramesRef.current >= BARGEIN_FRAMES) {
            notifiedRef.current = true
            onSpeechDetected()
          }
        }

        if (speechFramesRef.current >= MIN_SPEECH_FRAMES && !hasSpeechRef.current) {
          hasSpeechRef.current = true
          // Include pre-buffer audio (captures speech onset)
          if (useWorkletRef.current && preBufferRef.current.length > 0) {
            pcmRef.current.unshift(...preBufferRef.current)
            preBufferRef.current = []
          }
          if (!notifiedRef.current) {
            notifiedRef.current = true
            onSpeechDetected()
          }
          // Start MediaRecorder for fallback mode
          if (!useWorkletRef.current && recorderRef.current?.state !== 'recording') {
            recChunksRef.current = []
            try { recorderRef.current?.start(100) } catch {}
          }
        }
        silenceStartRef.current = null
      } else {
        speechFramesRef.current = 0
        if (hasSpeechRef.current) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = Date.now()
          } else if (Date.now() - silenceStartRef.current > SILENCE_MS) {
            // Silence detected — send audio
            if (useWorkletRef.current) {
              sendPCM()
            } else {
              try { recorderRef.current?.stop() } catch {}
              // sendWebm is triggered by recorder.onstop
            }
            resetVAD()
          }
        }
      }
      rafRef.current = requestAnimationFrame(check)
    }
    rafRef.current = requestAnimationFrame(check)
  }, [onSpeechDetected, sendPCM, resetVAD])

  const startVoice = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      streamRef.current = stream

      const ctx = new AudioContext()
      ctxRef.current = ctx
      nativeSRRef.current = ctx.sampleRate

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      analyserRef.current = analyser

      // Try AudioWorklet for raw PCM (eliminates webm+ffmpeg overhead)
      let workletOK = false
      try {
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
        const url = URL.createObjectURL(blob)
        await ctx.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)

        const node = new AudioWorkletNode(ctx, 'pcm-capture')
        const maxPreSamples = Math.floor(nativeSRRef.current * PRE_BUFFER_MS / 1000)
        node.port.onmessage = (e) => {
          if (!activeRef.current) return
          const samples = e.data
          if (hasSpeechRef.current) {
            pcmRef.current.push(samples)
          } else {
            // Rolling pre-buffer
            preBufferRef.current.push(samples)
            let total = 0
            for (const c of preBufferRef.current) total += c.length
            while (total > maxPreSamples && preBufferRef.current.length > 1) {
              total -= preBufferRef.current.shift().length
            }
          }
        }
        source.connect(node)
        workletRef.current = node
        useWorkletRef.current = true
        workletOK = true
        console.log('✅ Using AudioWorklet PCM capture (zero-latency)')
      } catch (err) {
        console.warn('AudioWorklet unavailable, falling back to MediaRecorder:', err)
      }

      // Fallback: MediaRecorder
      if (!workletOK) {
        useWorkletRef.current = false
        const recorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm'
        })
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recChunksRef.current.push(e.data)
        }
        recorder.onstop = () => {
          sendWebm()
        }
        recorderRef.current = recorder
      }

      activeRef.current = true
      resetVAD()
      runVAD()
      return true
    } catch (err) {
      console.error('Voice init error:', err)
      return false
    }
  }, [runVAD, resetVAD, sendWebm])

  const stopVoice = useCallback(() => {
    activeRef.current = false
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (workletRef.current) { workletRef.current.disconnect(); workletRef.current = null }
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop() } catch {}
    }
    recorderRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null }
    pcmRef.current = []
    preBufferRef.current = []
  }, [])

  return { startVoice, stopVoice }
}
