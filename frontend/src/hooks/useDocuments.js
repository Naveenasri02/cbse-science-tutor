import { useState, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_WS_URL
  ? import.meta.env.VITE_WS_URL.replace(/^wss?:/, match => match === 'wss:' ? 'https:' : 'http:').replace(/\/ws\/voice$/, '')
  : ''

export default function useDocuments(sessionIdRef) {
  const [documents, setDocuments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const uploadFile = useCallback(async (file) => {
    const sessionId = sessionIdRef.current
    const maxSize = 50 * 1024 * 1024 // 50 MB
    if (file.size > maxSize) {
      throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 50 MB`)
    }

    const allowed = ['.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.pptx', '.xlsx']
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
    if (!allowed.includes(ext)) {
      throw new Error(`Unsupported file type. Supported: ${allowed.join(', ')}`)
    }

    setUploading(true)
    setUploadProgress(0)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const url = `${API_BASE}/api/upload?session_id=${encodeURIComponent(sessionId)}`

      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', url)

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 90)
            setUploadProgress(pct)
          }
        }

        xhr.onload = () => {
          setUploadProgress(95)
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

        xhr.onerror = () => reject(new Error('Network error'))
        xhr.ontimeout = () => reject(new Error('Upload timed out'))
        xhr.timeout = 120000
        xhr.send(formData)
      })

      const fileUrl = URL.createObjectURL(file)
      setDocuments(prev => [...prev, { ...data, fileUrl, fileType: file.type }])
      setUploadProgress(100)
      await new Promise(r => setTimeout(r, 500))
      setUploadProgress(0)
      return data
    } catch (err) {
      setUploadProgress(0)
      throw err
    } finally {
      setUploading(false)
    }
  }, [sessionIdRef])

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

  return { documents, uploading, uploadProgress, uploadFile, deleteDocument, clearDocuments }
}
