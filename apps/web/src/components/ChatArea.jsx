import { useEffect, useRef, useState, useCallback } from 'react'
import Message from './Message'
import DocSummaryCard from './DocSummaryCard'
import { MatifyLogo } from './LandingPage'
import { palette } from '@cbse/shared'
import { FileUp } from 'lucide-react'

export default function ChatArea({ messages, isBotResponding, mode, assistantConfig, onTryClick, workflow, ragSources, onUpload, uploading, uploadProgress, hasDocuments, onCitationClick, documents, dismissedSummaries, onDismissSummary, onQuestionClick, onOpenPdf }) {
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isBotResponding])

  // Original 2-screen logic
  const hasTryOptions = assistantConfig?.tryOptions?.length > 0
  const hasAnyDocs = documents?.length > 0
  const showWelcome = !workflow && messages.length === 0 && hasTryOptions
  const showUploadZone = !hasDocuments && !hasAnyDocs && messages.length === 0 && (workflow || !hasTryOptions)
  const activeWorkflow = showUploadZone
    ? assistantConfig?.tryOptions?.find(opt => opt.message === workflow)
    : null

  console.log('[ChatArea] hasDocuments:', hasDocuments, 'hasAnyDocs:', hasAnyDocs, 'showWelcome:', showWelcome, 'showUploadZone:', showUploadZone, 'docs:', documents?.map(d => ({id: d.doc_id, rw: d.relevanceWarning})))

  const handleDrop= useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) onUpload?.(file).catch(err => alert(err.message || 'Upload failed'))
  }, [onUpload])

  const handleDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true) }, [])
  const handleDragLeave = useCallback(() => setDragOver(false), [])

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try { await onUpload(file) } catch (err) { alert(err.message || 'Upload failed') }
  }

  return (
    <div className="relative flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
      {showWelcome ? (
        <div className="flex h-full flex-col items-center justify-start overflow-auto px-4 pt-6 pb-4 sm:justify-center sm:pt-4 md:px-6 md:py-8">
          <div className="text-center max-w-lg w-full">
            <div
              className="mx-auto flex h-16 w-16 md:h-14 md:w-14 items-center justify-center rounded-[18px] border-2 p-2"
              style={{ borderColor: 'rgba(29,155,240,0.35)', background: 'rgba(29,155,240,0.12)' }}
            >
              <MatifyLogo className="h-full w-full rounded-[12px] object-cover" />
            </div>

            <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-xl md:mt-5 md:text-3xl" style={{ color: palette.textPrimary }}>
              {assistantConfig?.label || 'AI Assistant'}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed md:mt-3 md:text-[15px]" style={{ color: palette.textMuted }}>
              {assistantConfig?.welcomeMessage || 'Select a workflow to get started.'}
            </p>

            {/* Workflow cards */}
            {assistantConfig?.tryOptions && assistantConfig.tryOptions.length > 0 && (
              <div className="mt-6 md:mt-10">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-3 md:mb-4" style={{ color: palette.textMuted }}>
                  Try a workflow
                </p>
                <div className="flex flex-col gap-2.5 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-3 mx-auto"
                  style={{ maxWidth: assistantConfig.tryOptions.length <= 3 ? '480px' : '640px' }}
                >
                  {assistantConfig.tryOptions.map((opt) => {
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.label}
                        onClick={() => onTryClick?.(opt.message, opt.label)}
                        className="group flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2.5 rounded-2xl border-2 px-4 py-3.5 sm:px-4 sm:py-5 transition-all duration-200 hover:scale-[1.04] active:scale-[0.97] min-h-[52px]"
                        style={{
                          borderColor: 'rgba(29,155,240,0.2)',
                          background: 'rgba(29,155,240,0.03)',
                          color: palette.textPrimary,
                        }}
                      >
                        <div
                          className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl"
                          style={{ background: 'rgba(29,155,240,0.08)' }}
                        >
                          {Icon && <Icon size={20} style={{ color: palette.primary }} />}
                        </div>
                        <span className="text-[13px] font-medium leading-snug" style={{ color: palette.textPrimary }}>
                          {opt.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : showUploadZone ? (
        <div className="flex h-full flex-col items-center justify-center overflow-auto px-4 py-6 md:px-6 md:py-8">
          <div className="text-center max-w-md w-full">
            {(activeWorkflow?.icon || (!hasTryOptions && assistantConfig?.icon)) && (() => {
              const Icon = activeWorkflow?.icon || assistantConfig?.icon
              return (
                <div
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl mb-4"
                  style={{ background: 'rgba(29,155,240,0.1)' }}
                >
                  <Icon size={28} style={{ color: palette.primary }} />
                </div>
              )
            })()}
            <h2 className="text-xl font-semibold tracking-tight md:text-2xl mb-2" style={{ color: palette.textPrimary }}>
              {activeWorkflow?.label || (hasTryOptions ? workflow : assistantConfig?.label) || 'Upload Document'}
            </h2>
            <p className="text-[13px] mb-6" style={{ color: palette.textMuted }}>
              Upload a document to get started. I'll analyze it and answer your questions.
            </p>

            {/* Upload dropzone */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.csv,.pptx,.xlsx,.png,.jpg,.jpeg,.bmp,.tiff,.tif,.webp,.gif"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className="mx-auto max-w-sm rounded-2xl border-2 border-dashed p-8 md:p-10 cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                borderColor: dragOver ? palette.primary : 'rgba(29,155,240,0.3)',
                background: dragOver ? 'rgba(29,155,240,0.08)' : 'rgba(29,155,240,0.03)',
                boxShadow: dragOver ? '0 0 24px rgba(29,155,240,0.15)' : 'none',
              }}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-14 h-14">
                    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                      <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(29,155,240,0.15)" strokeWidth="3" />
                      <circle
                        cx="28" cy="28" r="24" fill="none"
                        stroke={palette.primary} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 24}`}
                        strokeDashoffset={`${2 * Math.PI * 24 * (1 - uploadProgress / 100)}`}
                        className="transition-all duration-300"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold" style={{ color: palette.primary }}>
                      {uploadProgress}%
                    </span>
                  </div>
                  <span className="text-[13px] font-medium" style={{ color: palette.textSecondary }}>
                    {uploadProgress < 90 ? 'Uploading...' : 'Processing document...'}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{ background: 'rgba(29,155,240,0.1)' }}
                  >
                    <FileUp size={26} style={{ color: palette.primary }} />
                  </div>
                  <div>
                    <p className="text-[14px] font-medium" style={{ color: palette.textPrimary }}>
                      Upload your document
                    </p>
                    <p className="text-[12px] mt-1" style={{ color: palette.textMuted }}>
                      Click or drag & drop · PDF, DOCX, PPTX, CSV, Images
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="h-full overflow-auto px-3 pb-4 pt-4 md:px-6 md:pb-6 lg:px-8 scrollbar-thin">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {/* Document Summary Card — shown at top of chat after upload */}
            {documents?.some(d => (d.summary || d.relevanceWarning) && !dismissedSummaries?.has(d.doc_id)) && (
              <DocSummaryCard
                documents={documents.filter(d => !dismissedSummaries?.has(d.doc_id))}
                onQuestionClick={onQuestionClick}
                onDismiss={onDismissSummary}
                onOpenPdf={onOpenPdf}
              />
            )}

            {messages.map((msg, idx) => (
              <div key={msg.id}>
                <Message
                  role={msg.role}
                  text={msg.text}
                  streaming={isBotResponding && msg.role === 'bot' && idx === messages.length - 1}
                  onCitationClick={onCitationClick}
                  sources={msg.sources}
                />
              </div>
            ))}

            {isBotResponding && messages.length > 0 && messages[messages.length - 1]?.text === '' && (
              <div className="flex justify-start">
                <div
                  className="max-w-[88%] md:max-w-[80%] rounded-[20px] px-4 py-2.5 text-base md:text-[15px] leading-[1.6] flex gap-1.5 items-center"
                  style={{ background: palette.panelAlt, border: `1px solid ${palette.border}` }}
                >
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              </div>
            )}

            {/* Inline upload card — shown when workflow is active but no documents uploaded yet */}
            {workflow && !hasDocuments && !isBotResponding && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md,.csv,.pptx,.xlsx,.png,.jpg,.jpeg,.bmp,.tiff,.tif,.webp,.gif"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className="mx-auto w-full max-w-md rounded-2xl border-2 border-dashed p-5 cursor-pointer transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] mt-2"
                  style={{
                    borderColor: dragOver ? palette.primary : 'rgba(29,155,240,0.3)',
                    background: dragOver ? 'rgba(29,155,240,0.08)' : 'rgba(29,155,240,0.03)',
                  }}
                >
                  {uploading ? (
                    <div className="flex items-center justify-center gap-3">
                      <div className="relative w-10 h-10">
                        <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
                          <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(29,155,240,0.15)" strokeWidth="2.5" />
                          <circle
                            cx="20" cy="20" r="16" fill="none"
                            stroke={palette.primary} strokeWidth="2.5" strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 16}`}
                            strokeDashoffset={`${2 * Math.PI * 16 * (1 - uploadProgress / 100)}`}
                            className="transition-all duration-300"
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold" style={{ color: palette.primary }}>
                          {uploadProgress}%
                        </span>
                      </div>
                      <span className="text-[13px] font-medium" style={{ color: palette.textSecondary }}>
                        {uploadProgress < 90 ? 'Uploading...' : 'Processing...'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-3">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: 'rgba(29,155,240,0.1)' }}
                      >
                        <FileUp size={20} style={{ color: palette.primary }} />
                      </div>
                      <div>
                        <p className="text-[13px] font-medium" style={{ color: palette.textPrimary }}>
                          Upload your document
                        </p>
                        <p className="text-[11px]" style={{ color: palette.textMuted }}>
                          Click or drag & drop · PDF, DOCX, PPTX, CSV, Images
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  )
}
