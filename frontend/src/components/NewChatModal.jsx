import { HiDocumentText } from 'react-icons/hi2'
import { HiLightningBolt } from 'react-icons/hi'

export default function NewChatModal({ onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative z-10 w-[90%] max-w-[480px] p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-center text-lg font-semibold text-[#ececf1] mb-1">Start a new chat</h2>
        <p className="text-center text-sm text-[#8e8ea0] mb-6">Choose how you'd like to interact</p>

        <div className="grid grid-cols-2 gap-3">
          {/* Doc Chat */}
          <button
            onClick={() => onSelect('doc')}
            className="group flex flex-col items-center gap-3 p-5 rounded-2xl
                       bg-[#2a2a2a] border border-[#383838] hover:border-[#10a37f]/50
                       hover:bg-[#2f2f2f] transition-all duration-200"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#10a37f]/10 border border-[#10a37f]/20
                            flex items-center justify-center text-2xl
                            group-hover:bg-[#10a37f]/20 group-hover:border-[#10a37f]/40 transition-all">
              📁
            </div>
            <div className="text-center">
              <div className="font-semibold text-[#ececf1] text-sm">Chat with Docs</div>
              <div className="text-[11px] text-[#8e8ea0] mt-1 leading-snug">
                Upload files &amp; ask questions about them
              </div>
            </div>
          </button>

          {/* Smart Chat */}
          <button
            onClick={() => onSelect('smart')}
            className="group flex flex-col items-center gap-3 p-5 rounded-2xl
                       bg-[#2a2a2a] border border-[#383838] hover:border-[#8b5cf6]/50
                       hover:bg-[#2f2f2f] transition-all duration-200"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20
                            flex items-center justify-center text-2xl
                            group-hover:bg-[#8b5cf6]/20 group-hover:border-[#8b5cf6]/40 transition-all">
              🧠
            </div>
            <div className="text-center">
              <div className="font-semibold text-[#ececf1] text-sm">Chat with AI</div>
              <div className="text-[11px] text-[#8e8ea0] mt-1 leading-snug">
                AI assistant with voice &amp; text chat
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
