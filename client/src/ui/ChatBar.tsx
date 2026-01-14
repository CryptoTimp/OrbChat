import { useState, useRef, useEffect, useMemo } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useGameStore } from '../state/gameStore';
import { ItemRarity, RARITY_COLORS } from '../types';

// Get name color based on orb count (matches renderer logic)
function getNameColor(orbs: number, cheapestPrices: Record<ItemRarity, number>): string {
  if (orbs >= cheapestPrices.legendary) return '#fbbf24'; // Gold
  if (orbs >= cheapestPrices.epic) return '#a855f7'; // Purple
  if (orbs >= cheapestPrices.rare) return '#3b82f6'; // Blue
  if (orbs >= cheapestPrices.uncommon) return '#22c55e'; // Green
  if (orbs >= cheapestPrices.common) return '#ffffff'; // White
  return '#6b7280'; // Gray
}

export function ChatBar() {
  const [message, setMessage] = useState('');
  const [isExpanded, setIsExpanded] = useState(true); // Expanded by default
  const inputRef = useRef<HTMLInputElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const { sendChat } = useSocket();
  
  const chatMessages = useGameStore(state => state.chatMessages);
  const players = useGameStore(state => state.players);
  const shopItems = useGameStore(state => state.shopItems);
  
  // Calculate cheapest prices per rarity for name coloring
  const cheapestPrices = useMemo(() => {
    const prices: Record<ItemRarity, number> = {
      common: Infinity,
      uncommon: Infinity,
      rare: Infinity,
      epic: Infinity,
      legendary: Infinity,
    };
    for (const item of shopItems) {
      if (item.price < prices[item.rarity]) {
        prices[item.rarity] = item.price;
      }
    }
    return prices;
  }, [shopItems]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      console.log('Sending chat message:', message.trim());
      sendChat(message.trim());
      setMessage('');
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      inputRef.current?.blur();
    }
  };
  
  // Auto-scroll chat log
  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chatMessages]);
  
  // Get player info by ID
  const getPlayerInfo = (playerId: string): { name: string; orbs: number } => {
    const player = players.get(playerId);
    return {
      name: player?.name || 'Unknown',
      orbs: player?.orbs || 0
    };
  };
  
  return (
    <div className="fixed bottom-4 left-4 z-40 w-96">
      {/* Chat log (expandable) */}
      <div 
        className={`
          transition-all duration-300 ease-out overflow-hidden
          ${isExpanded ? 'mb-2' : 'max-h-0'}
        `}
      >
        <div 
          ref={chatLogRef}
          className="bg-gray-900/70 backdrop-blur-sm rounded-lg p-3 overflow-y-auto overflow-x-visible chat-scroll border border-gray-700/50"
          style={{ maxHeight: '160px' }} // ~8 messages worth
        >
          {chatMessages.length === 0 ? (
            <p className="text-gray-500 text-xs font-pixel">No messages yet</p>
          ) : (
            chatMessages.map((msg, index) => {
              const playerInfo = getPlayerInfo(msg.playerId);
              const nameColor = getNameColor(playerInfo.orbs, cheapestPrices);
              
              // Parse message for [ITEM:rarity][itemName][/ITEM] tags and render with colors
              const renderMessage = (text: string) => {
                const parts: (string | { text: string; color: string; rarity?: ItemRarity })[] = [];
                let lastIndex = 0;
                // Updated regex to handle [ITEM:rarity][itemName][/ITEM] format (with square brackets around item name)
                const itemRegex = /\[ITEM:([^\]]+)\]\[([^\]]+)\]\[\/ITEM\]/g;
                let match;
                
                while ((match = itemRegex.exec(text)) !== null) {
                  // Add text before the match
                  if (match.index > lastIndex) {
                    parts.push(text.substring(lastIndex, match.index));
                  }
                  
                  // Add the item name with rarity color
                  const rarity = match[1] as ItemRarity;
                  const itemName = match[2];
                  const rarityColor = RARITY_COLORS[rarity] || RARITY_COLORS.common;
                  // Extract hex color from Tailwind class or use the text color
                  // RARITY_COLORS.text is a Tailwind class, we need the actual color value
                  const colorMap: Record<ItemRarity, string> = {
                    common: '#d1d5db',      // gray-300
                    uncommon: '#86efac',   // green-300
                    rare: '#93c5fd',        // blue-300
                    epic: '#c084fc',       // purple-300
                    legendary: '#fcd34d',  // amber-300
                  };
                  parts.push({ text: itemName, color: colorMap[rarity] || colorMap.common, rarity });
                  
                  lastIndex = match.index + match[0].length;
                }
                
                // Add remaining text
                if (lastIndex < text.length) {
                  parts.push(text.substring(lastIndex));
                }
                
                // If no matches, return original text
                if (parts.length === 0) {
                  return <span>{text}</span>;
                }
                
                return (
                  <>
                    {parts.map((part, i) => 
                      typeof part === 'string' ? (
                        <span key={i}>{part}</span>
                      ) : (
                        <span key={i} style={{ color: part.color, fontWeight: 'bold' }} className="relative inline-block">
                          {part.text}
                          {part.rarity === 'legendary' && (
                            <>
                              {/* Gold particle effects for legendary items */}
                              {[...Array(6)].map((_, particleIndex) => (
                                <span
                                  key={particleIndex}
                                  className="absolute rounded-full pointer-events-none"
                                  style={{
                                    width: '3px',
                                    height: '3px',
                                    backgroundColor: '#fcd34d',
                                    left: `${20 + (particleIndex * 15)}%`,
                                    bottom: '-8px',
                                    animation: `particle-rise-chat ${1.5 + (particleIndex * 0.15)}s ease-out infinite`,
                                    animationDelay: `${particleIndex * 0.1}s`,
                                    boxShadow: '0 0 4px #fcd34d, 0 0 8px #fcd34d',
                                    zIndex: 50,
                                  }}
                                />
                              ))}
                            </>
                          )}
                        </span>
                      )
                    )}
                  </>
                );
              };
              
              return (
                <div key={index} className="mb-1.5 last:mb-0 relative" style={{ overflow: 'visible' }}>
                  <span className="text-xs font-pixel" style={{ color: nameColor }}>
                    {playerInfo.name}:
                  </span>
                  <span className="text-xs ml-2 relative inline-block" style={{ color: nameColor, overflow: 'visible' }}>
                    {renderMessage(msg.text)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
      
      {/* Chat input bar */}
      <form 
        onSubmit={handleSubmit}
        className="flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm rounded-lg p-1.5 border border-gray-700/50"
      >
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-gray-700/50 rounded transition-colors text-gray-400 hover:text-gray-200 shrink-0"
          title={isExpanded ? 'Hide chat' : 'Show chat'}
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        
        <div className="flex-1 flex items-center bg-gray-800/60 rounded border border-gray-600/50 focus-within:ring-1 focus-within:ring-emerald-500 focus-within:border-transparent">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            maxLength={280}
            className="flex-1 bg-transparent text-gray-100 px-3 py-1.5 text-xs 
                       placeholder-gray-500 focus:outline-none font-pixel min-w-0"
          />
          
          <button
            type="submit"
            disabled={!message.trim()}
            className="px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 disabled:bg-transparent
                       disabled:text-gray-600 text-white rounded-r transition-colors
                       text-xs font-pixel shrink-0"
          >
            ↵
          </button>
        </div>
      </form>
    </div>
  );
}
