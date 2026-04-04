import { Mic, X } from 'lucide-react'

const STATUS_MAP = {
  listening:  { label: 'Listening',   color: '#1D9BF0', hint: 'Start speaking...' },
  recording:  { label: 'Recording',   color: '#10b981', hint: '' },
  thinking:   { label: 'Thinking',    color: '#f59e0b', hint: '' },
  processing: { label: 'Processing',  color: '#f59e0b', hint: '' },
  speaking:   { label: 'Speaking',    color: '#8b5cf6', hint: 'Tap to interrupt' },
  error:      { label: 'Error',       color: '#ef4444', hint: 'Something went wrong' },
}

export default function VoiceOverlay({ status, onClose }) {
  const cfg = STATUS_MAP[status.cls] || STATUS_MAP.listening

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center voice-overlay-bg animate-overlay-in"
         onClick={status.cls === 'speaking' ? onClose : undefined}
         style={{ padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)', cursor: status.cls === 'speaking' ? 'pointer' : 'default' }}>
      {/* Animated rings */}
      <div className="relative flex items-center justify-center" style={{ width: 'min(75vw, 320px)', height: 'min(75vw, 320px)' }}>
        <div className={`voice-ring ring-outer ${status.cls}`} style={{ borderColor: cfg.color }} />
        <div className={`voice-ring ring-mid ${status.cls}`} style={{ borderColor: cfg.color }} />
        <div className={`voice-ring ring-inner ${status.cls}`} style={{ borderColor: cfg.color }} />

        {/* Main orb */}
        <div
          className={`voice-orb ${status.cls}`}
          style={{
            background: `radial-gradient(circle at 35% 35%, ${cfg.color}50, ${cfg.color}18)`,
            boxShadow: `0 0 80px ${cfg.color}25, 0 0 160px ${cfg.color}08`,
          }}
        >
          <Mic className="w-8 h-8 sm:w-12 sm:h-12" style={{ color: cfg.color }} />
        </div>
      </div>

      {/* Status label */}
      <p className="mt-6 sm:mt-8 text-lg sm:text-xl font-medium tracking-wide" style={{ color: cfg.color }}>
        {cfg.label}
      </p>
      {cfg.hint && <p className="mt-2 text-sm text-[#666]">{cfg.hint}</p>}

      {/* End button */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="mt-6 sm:mt-14 w-14 h-14 rounded-full bg-[#ef4444]/15 hover:bg-[#ef4444]/30
                   border border-[#ef4444]/30 flex items-center justify-center
                   transition-all duration-200 group active:scale-90"
      >
        <X className="w-6 h-6 text-red-400 group-hover:text-red-300" />
      </button>
      <p className="mt-2 text-xs text-[#666]">End voice</p>
    </div>
  )
}
