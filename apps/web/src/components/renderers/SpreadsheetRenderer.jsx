import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { palette } from '@cbse/shared'
import { ViewerToolbar } from './highlightUtils'

export default function SpreadsheetRenderer({ fileUrl, filename, onClose }) {
  const [sheets, setSheets] = useState([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)

  const isCsv = /\.csv$/i.test(filename || '')

  // Fetch and parse spreadsheet
  useEffect(() => {
    if (!fileUrl) return
    setLoading(true)
    setError(null)

    fetch(fileUrl)
      .then(r => r.arrayBuffer())
      .then(buffer => {
        const wb = XLSX.read(buffer, { type: 'array' })
        const parsed = wb.SheetNames.map(name => ({
          name,
          data: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }),
        }))
        setSheets(parsed)
        setActiveSheet(0)
        setLoading(false)
      })
      .catch(err => {
        console.error('Spreadsheet parse error:', err)
        setError('Failed to parse spreadsheet.')
        setLoading(false)
      })
  }, [fileUrl])

  const currentSheet = sheets[activeSheet]

  return (
    <div className={`h-full flex flex-col ${expanded ? 'fixed inset-0 z-50' : ''}`} style={{ background: palette.panel }}>
      <ViewerToolbar filename={filename} onClose={onClose} expanded={expanded} onToggleExpand={() => setExpanded(!expanded)}>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(29,155,240,0.1)', color: palette.primary }}>
          {isCsv ? 'CSV' : 'Excel'}
        </span>
      </ViewerToolbar>

      {/* Sheet tabs (for multi-sheet Excel files) */}
      {sheets.length > 1 && (
        <div className="flex gap-0 border-b overflow-x-auto shrink-0" style={{ borderColor: palette.border, background: palette.bg }}>
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              className="px-3 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap"
              style={{
                color: i === activeSheet ? palette.primary : palette.textMuted,
                borderBottom: i === activeSheet ? `2px solid ${palette.primary}` : '2px solid transparent',
                background: i === activeSheet ? 'rgba(29,155,240,0.06)' : 'transparent',
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto" style={{ background: palette.bg }}>
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-t-transparent" style={{ borderColor: palette.primary, borderTopColor: 'transparent' }} />
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32">
            <p className="text-[13px]" style={{ color: palette.textMuted }}>{error}</p>
          </div>
        )}
        {currentSheet && (
          <div className="p-2" ref={tableRef}>
            <table className="w-full border-collapse text-[11px]" style={{ color: palette.textSecondary }}>
              <tbody>
                {currentSheet.data.map((row, ri) => (
                  <tr key={ri} className={ri === 0 ? 'sticky top-0 z-10' : ''}>
                    {/* Row number */}
                    <td
                      className="select-none text-center px-2 py-1 border-r"
                      style={{
                        color: palette.textMuted,
                        opacity: 0.5,
                        borderColor: palette.border,
                        background: palette.bg,
                        minWidth: '32px',
                        fontSize: '10px',
                      }}
                    >
                      {ri + 1}
                    </td>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-2.5 py-1.5 border whitespace-pre-wrap break-words"
                        style={{
                          borderColor: palette.border,
                          background: ri === 0 ? 'rgba(29,155,240,0.06)' : 'transparent',
                          color: ri === 0 ? palette.textPrimary : palette.textSecondary,
                          fontWeight: ri === 0 ? 600 : 400,
                          maxWidth: '250px',
                        }}
                      >
                        {String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
