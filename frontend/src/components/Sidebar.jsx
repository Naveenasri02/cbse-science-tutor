import { HiPlus, HiTrash, HiX } from 'react-icons/hi'

export default function Sidebar({ chats, activeChatId, onNewChat, onSwitchChat, onDeleteChat, open, onClose }) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed md:relative z-50 top-0 bottom-0 left-0 w-[260px]
        bg-[#171717] border-r border-[#2f2f2f] flex flex-col
        transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between p-4">
          <h2 className="text-lg font-semibold">💬 CBSE Tutor</h2>
          <button onClick={onClose} className="md:hidden text-lg text-[#9b9b9b] hover:text-white">
            <HiX />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-3 mb-2">
          <button
            onClick={onNewChat}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#424242]
                       hover:bg-[#2f2f2f] hover:border-[#10a37f] transition-all text-sm"
          >
            <HiPlus className="text-[#10a37f]" /> New Chat
          </button>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1">
          {chats.map(chat => (
            <div
              key={chat.id}
              onClick={() => onSwitchChat(chat.id)}
              className={`
                group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm
                ${chat.id === activeChatId
                  ? 'bg-[#2f2f2f] text-white'
                  : 'text-[#9b9b9b] hover:bg-[#2f2f2f] hover:text-white'}
              `}
            >
              <span className="flex-1 truncate">{chat.title}</span>
              {chats.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id) }}
                  className="opacity-0 group-hover:opacity-100 text-[#9b9b9b] hover:text-red-400 transition"
                >
                  <HiTrash size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 text-[#6b6b6b] text-xs leading-relaxed border-t border-[#2f2f2f]">
          CBSE Class 10 Science<br />
          Powered by Local AI
        </div>
      </aside>
    </>
  )
}
