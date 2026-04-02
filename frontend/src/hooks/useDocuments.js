import { useState, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_WS_URL
  ? import.meta.env.VITE_WS_URL.replace(/^wss?:/, match => match === 'wss:' ? 'https:' : 'http:').replace(/\/ws\/voice$/, '')
  : ''

export default function useDocuments(sessionId) {
  const [documents, setDocuments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')

  const uploadFile = useCallback(async (file) => {
    const maxSize = 50 * 1024 * 1024 // 50 MB
    if (file.size > maxSize) {
      throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 50 MB`)
    }

    const allowed = ['.pdf', '.docx', '.doc']
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
    if (!allowed.includes(ext)) {
      throw new Error('Unsupported file type. Use PDF, DOCX, or DOC.')
    }

    setUploading(true)
    setUploadProgress(`Uploading ${file.name}...`)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const url = `${API_BASE}/api/upload?session_id=${encodeURIComponent(sessionId)}`
      const res = await fetch(url, { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      const fileUrl = URL.createObjectURL(file)
      setDocuments(prev => [...prev, { ...data, fileUrl, fileType: file.type }])
      setUploadProgress('')
      return data
    } catch (err) {
      setUploadProgress('')
      throw err
    } finally {
      setUploading(false)
    }
  }, [sessionId])

  const deleteDocument = useCallback(async (docId) => {
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
  }, [sessionId, documents])

  const clearDocuments = useCallback(() => {
    documents.forEach(d => { if (d.fileUrl) URL.revokeObjectURL(d.fileUrl) })
    setDocuments([])
  }, [documents])

  return { documents, uploading, uploadProgress, uploadFile, deleteDocument, clearDocuments }
}
