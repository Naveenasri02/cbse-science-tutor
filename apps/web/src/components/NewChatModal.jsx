import { palette } from '@cbse/shared'

export default function NewChatModal({ onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative z-10 w-[90%] max-w-[480px] p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-center text-lg font-semibold mb-1" style={{ color: palette.textPrimary }}>Start a new chat</h2>
        <p className="text-center text-sm mb-6" style={{ color: palette.textMuted }}>Choose how you'd like to interact</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            onClick={() => onSelect('doc')}
            className="group flex items-center gap-4 p-4 sm:flex-col sm:items-center sm:gap-3 sm:p-5 rounded-2xl border transition-all duration-200 active:scale-[0.97] min-h-[64px]"
            style={{ background: palette.panelAlt, borderColor: palette.borderStrong }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(29,155,240,0.5)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = palette.borderStrong}
          >
            <div
              className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-2xl flex items-center justify-center text-2xl transition-all"
              style={{ background: 'rgba(29,155,240,0.08)', border: '1px solid rgba(29,155,240,0.2)' }}
            >
              📁
            </div>
            <div className="text-left sm:text-center">
              <div className="font-semibold text-sm" style={{ color: palette.textPrimary }}>Chat with Docs</div>
              <div className="text-[12px] sm:text-[11px] mt-0.5 sm:mt-1 leading-snug" style={{ color: palette.textMuted }}>
                Upload files &amp; ask questions about them
              </div>
            </div>
          </button>

          <button
            onClick={() => onSelect('smart')}
            className="group flex items-center gap-4 p-4 sm:flex-col sm:items-center sm:gap-3 sm:p-5 rounded-2xl border transition-all duration-200 active:scale-[0.97] min-h-[64px]"
            style={{ background: palette.panelAlt, borderColor: palette.borderStrong }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(29,155,240,0.5)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = palette.borderStrong}
          >
            <div
              className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-2xl flex items-center justify-center text-2xl transition-all"
              style={{ background: 'rgba(29,155,240,0.08)', border: '1px solid rgba(29,155,240,0.2)' }}
            >
              🧠
            </div>
            <div className="text-left sm:text-center">
              <div className="font-semibold text-sm" style={{ color: palette.textPrimary }}>Chat with AI</div>
              <div className="text-[12px] sm:text-[11px] mt-0.5 sm:mt-1 leading-snug" style={{ color: palette.textMuted }}>
                AI assistant with voice &amp; text chat
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
