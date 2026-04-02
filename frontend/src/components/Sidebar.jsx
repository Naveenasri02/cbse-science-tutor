import { HiPlus, HiTrash, HiX } from 'react-icons/hi'

export default function Sidebar({ chats, activeChatId, onNewChat, onSwitchChat, onDeleteChat, open, onClose }) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm" onClick={onClose} />
      )}

      <aside className={`
        fixed md:relative z-50 top-0 bottom-0 left-0 w-[260px]
        bg-[#171717] flex flex-col
        transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚛</span>
            <span className="font-semibold text-sm text-[#ececf1]">Science Tutor</span>
          </div>
          <button onClick={onClose} className="md:hidden text-[#8e8ea0] hover:text-white p-1 rounded-lg hover:bg-[#2f2f2f] transition">
            <HiX size={18} />
          </button>
        </div>

        {/* New Chat */}
        <div className="px-2 py-2">
          <button
            onClick={onNewChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl
                       text-[#ececf1] hover:bg-[#2f2f2f] transition-all text-sm"
          >
            <HiPlus className="text-[#8e8ea0]" size={16} /> New chat
          </button>
        </div>

        {/* Divider */}
        <div className="px-4 pb-1">
          <div className="text-[11px] font-medium text-[#8e8ea0] uppercase tracking-wide">Recent</div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5 scrollbar-thin">
          {chats.map(chat => (
            <div
              key={chat.id}
              onClick={() => onSwitchChat(chat.id)}
              className={`
                group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer text-sm transition-all
                ${chat.id === activeChatId
                  ? 'bg-[#2f2f2f] text-[#ececf1]'
                  : 'text-[#b4b4b4] hover:bg-[#2a2a2a] hover:text-[#ececf1]'}
              `}
            >
              <span className="flex-1 truncate">{chat.title}</span>
              {chats.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id) }}
                  className="opacity-0 group-hover:opacity-100 text-[#8e8ea0] hover:text-red-400 transition p-0.5 rounded"
                >
                  <HiTrash size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 text-[#6b6b6b] text-[11px] leading-relaxed border-t border-[#2f2f2f]">
          Class 10 Science · NCERT
        </div>
      </aside>
    </>
  )
}
