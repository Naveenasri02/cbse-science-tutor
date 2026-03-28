export default function VoiceStatus({ status }) {
  if (!status.visible) return null

  const colorMap = {
    listening: 'text-[#10a37f]',
    thinking: 'text-[#10a37f]',
    processing: 'text-[#f0b429]',
    speaking: 'text-[#e06c75]',
    error: 'text-[#e06c75] bg-[#3a1a1a] border-[#e06c75]',
  }

  return (
    <div className="absolute bottom-20 left-0 right-0 text-center pointer-events-none z-10">
      <span className={`
        inline-block px-4 py-1.5 rounded-full text-sm
        bg-[#2f2f2f] border border-[#424242]
        ${colorMap[status.cls] || 'text-[#10a37f]'}
      `}>
        {status.text}
      </span>
    </div>
  )
}
