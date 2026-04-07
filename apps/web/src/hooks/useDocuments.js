import { useState, useCallback, useRef } from 'react'

const API_BASE = import.meta.env.VITE_WS_URL
  ? import.meta.env.VITE_WS_URL.replace(/^wss?:/, match => match === 'wss:' ? 'https:' : 'http:').replace(/\/ws\/voice$/, '')
  : ''

export default function useDocuments(sessionIdRef, assistantRef, workflowRef) {
  const [documents, setDocuments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const processingTimer = useRef(null)
  const xhrRef = useRef(null)

  const stopProcessingTimer = useCallback(() => {
    if (processingTimer.current) {
      clearInterval(processingTimer.current)
      processingTimer.current = null
    }
  }, [])

  // Simulate gradual progress during server-side processing (90→98%)
  const startProcessingTimer = useCallback(() => {
    stopProcessingTimer()
    let current = 90
    processingTimer.current = setInterval(() => {
      current = Math.min(current + 1, 98)
      setUploadProgress(current)
      if (current >= 98) stopProcessingTimer()
    }, 400)
  }, [stopProcessingTimer])

  const uploadFile = useCallback(async (file) => {
    const sessionId = sessionIdRef.current
    const maxSize = 50 * 1024 * 1024 // 50 MB
    if (file.size > maxSize) {
      throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 50 MB`)
    }

    const allowed = ['.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.pptx', '.xlsx', '.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.webp', '.gif']
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
    if (!allowed.includes(ext)) {
      throw new Error(`Unsupported file type. Supported: ${allowed.join(', ')}`)
    }

    setUploading(true)
    setUploadProgress(2)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const url = `${API_BASE}/api/upload?session_id=${encodeURIComponent(sessionId)}&assistant=${encodeURIComponent(assistantRef?.current || 'general')}&workflow=${encodeURIComponent(workflowRef?.current || '')}`

      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr
        xhr.open('POST', url)

        let uploadDone = false
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            // Map upload 0-100% to display 5-85%
            const pct = 5 + Math.round((e.loaded / e.total) * 80)
            setUploadProgress(pct)
          }
        }

        xhr.upload.onload = () => {
          // Upload complete, server is now processing (parsing, chunking, embedding)
          uploadDone = true
          setUploadProgress(90)
          startProcessingTimer()
        }

        xhr.onload = () => {
          stopProcessingTimer()
          try {
            const json = JSON.parse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadProgress(100)
              resolve(json)
            } else {
              reject(new Error(json.error || 'Upload failed'))
            }
          } catch {
            reject(new Error('Upload failed'))
          }
        }

        xhr.onerror = () => { stopProcessingTimer(); xhrRef.current = null; reject(new Error('Network error')) }
        xhr.ontimeout = () => { stopProcessingTimer(); xhrRef.current = null; reject(new Error('Upload timed out')) }
        xhr.onabort = () => { stopProcessingTimer(); xhrRef.current = null; reject(new Error('Upload cancelled')) }
        xhr.timeout = 300000 // 5 min for large docs
        xhr.send(formData)
      })
      xhrRef.current = null

      // Verify session_id hasn't changed during upload (safety net)
      if (sessionIdRef.current !== sessionId) {
        console.warn('Session changed during upload — discarding result')
        setUploadProgress(0)
        return data
      }
      const fileUrl = URL.createObjectURL(file)
      console.log('[useDocuments] Adding doc, relevance_warning:', data.relevance_warning, 'summary:', !!data.summary)
      setDocuments(prev => [...prev, {
        ...data,
        fileUrl,
        fileType: file.type,
        summary: data.summary || '',
        doc_type: data.doc_type || '',
        themes: data.themes || [],
        entities: data.entities || [],
        suggestedQuestions: data.suggested_questions || [],
        keyFindings: data.key_findings || [],
        terms: data.terms || [],
        toc: data.toc || [],
        relevanceWarning: data.relevance_warning || null,
        uploadedAt: Date.now(),
      }])
      // Show 100% briefly before hiding
      setUploadProgress(100)
      await new Promise(r => setTimeout(r, 800))
      setUploadProgress(0)
      return data
    } catch (err) {
      stopProcessingTimer()
      setUploadProgress(0)
      throw err
    } finally {
      setUploading(false)
    }
  }, [sessionIdRef, startProcessingTimer, stopProcessingTimer])

  const deleteDocument = useCallback(async (docId) => {
    const sessionId = sessionIdRef.current
    try {
      const doc = documents.find(d => d.doc_id === docId)
      if (doc?.fileUrl) URL.revokeObjectURL(doc.fileUrl)
      const url = `${API_BASE}/api/documents/${docId}?session_id=${encodeURIComponent(sessionId)}`
      const res = await fetch(url, { method: 'DELETE' })
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.doc_id !== docId))
      }
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }, [sessionIdRef, documents])

  const clearDocuments = useCallback(() => {
    documents.forEach(d => { if (d.fileUrl) URL.revokeObjectURL(d.fileUrl) })
    setDocuments([])
  }, [documents])

  const abortUpload = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort()
      xhrRef.current = null
    }
    stopProcessingTimer()
    setUploading(false)
    setUploadProgress(0)
  }, [stopProcessingTimer])

  return { documents, uploading, uploadProgress, uploadFile, deleteDocument, clearDocuments, abortUpload }
}
