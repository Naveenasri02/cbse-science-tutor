import { palette } from '../palette'

export default function NewChatModal({ onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative z-10 w-[90%] max-w-[480px] p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-center text-lg font-semibold mb-1" style={{ color: palette.textPrimary }}>Start a new chat</h2>
        <p className="text-center text-sm mb-6" style={{ color: palette.textMuted }}>Choose how you'd like to interact</p>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onSelect('doc')}
            className="group flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all duration-200"
            style={{ background: palette.panelAlt, borderColor: palette.borderStrong }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(29,155,240,0.5)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = palette.borderStrong}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all"
              style={{ background: 'rgba(29,155,240,0.08)', border: '1px solid rgba(29,155,240,0.2)' }}
            >
              📁
            </div>
            <div className="text-center">
              <div className="font-semibold text-sm" style={{ color: palette.textPrimary }}>Chat with Docs</div>
              <div className="text-[11px] mt-1 leading-snug" style={{ color: palette.textMuted }}>
                Upload files &amp; ask questions about them
              </div>
            </div>
          </button>

          <button
            onClick={() => onSelect('smart')}
            className="group flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all duration-200"
            style={{ background: palette.panelAlt, borderColor: palette.borderStrong }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(29,155,240,0.5)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = palette.borderStrong}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all"
              style={{ background: 'rgba(29,155,240,0.08)', border: '1px solid rgba(29,155,240,0.2)' }}
            >
              🧠
            </div>
            <div className="text-center">
              <div className="font-semibold text-sm" style={{ color: palette.textPrimary }}>Chat with AI</div>
              <div className="text-[11px] mt-1 leading-snug" style={{ color: palette.textMuted }}>
                AI assistant with voice &amp; text chat
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
