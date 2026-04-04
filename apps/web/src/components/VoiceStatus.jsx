export default function VoiceStatus({ status }) {
  if (!status.visible) return null

  const styles = {
    listening: 'bg-[#10a37f]/15 border-[#10a37f]/40 text-[#10a37f]',
    thinking: 'bg-[#10a37f]/15 border-[#10a37f]/40 text-[#10a37f]',
    processing: 'bg-[#f0b429]/10 border-[#f0b429]/30 text-[#f0b429]',
    speaking: 'bg-[#7c3aed]/10 border-[#7c3aed]/30 text-[#a78bfa]',
    error: 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#f87171]',
  }

  return (
    <div className="absolute bottom-[88px] left-0 right-0 text-center pointer-events-none z-10">
      <span className={`
        inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium
        border backdrop-blur-sm shadow-lg
        ${styles[status.cls] || styles.listening}
      `}>
        {status.cls === 'listening' && <span className="w-2 h-2 rounded-full bg-[#10a37f] animate-pulse" />}
        {status.cls === 'speaking' && <span className="w-2 h-2 rounded-full bg-[#7c3aed] animate-pulse" />}
        {status.text}
      </span>
    </div>
  )
}
