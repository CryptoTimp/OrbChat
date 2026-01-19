import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useSocket } from '../hooks/useSocket';
import { playClickSound } from '../utils/sounds';
import { getCurrentUser } from '../firebase/auth';

const ALLOWED_KICK_UID = 'mCY7QgXzKwRJA8YRzP90qJppE1y2';

export function PlayerContextMenu() {
  const { playerContextMenu, hidePlayerContextMenu, openTrade } = useGameStore();
  const { requestTrade, kickPlayer } = useSocket();
  const menuRef = useRef<HTMLDivElement>(null);
  const [canKick, setCanKick] = useState(false);
  
  // Check if current user has permission to kick by getting Firebase UID directly
  useEffect(() => {
    const currentUser = getCurrentUser();
    const currentUid = currentUser?.uid || null;
    setCanKick(currentUid === ALLOWED_KICK_UID);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hidePlayerContextMenu();
      }
    };

    if (playerContextMenu.isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [playerContextMenu.isOpen, hidePlayerContextMenu]);

  if (!playerContextMenu.isOpen || !playerContextMenu.playerId) return null;

  const handleTrade = () => {
    playClickSound();
    if (playerContextMenu.playerId && playerContextMenu.playerName) {
      // Open trade immediately (server will confirm)
      openTrade(playerContextMenu.playerId, playerContextMenu.playerName);
      requestTrade(playerContextMenu.playerId);
      hidePlayerContextMenu();
    }
  };

  const handleKick = () => {
    playClickSound();
    if (playerContextMenu.playerId) {
      if (window.confirm(`Are you sure you want to kick ${playerContextMenu.playerName || 'this player'}?`)) {
        kickPlayer(playerContextMenu.playerId);
        hidePlayerContextMenu();
      }
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed bg-gray-900 border-2 border-gray-700 rounded-lg shadow-xl z-50 min-w-[150px]"
      style={{
        left: `${playerContextMenu.x}px`,
        top: `${playerContextMenu.y}px`,
      }}
    >
      <div className="p-1">
        <div className="px-3 py-2 text-gray-400 text-sm border-b border-gray-700">
          {playerContextMenu.playerName}
        </div>
        <button
          onClick={handleTrade}
          className="w-full text-left px-3 py-2 text-white hover:bg-gray-800 rounded transition-colors"
        >
          Trade
        </button>
        {canKick && (
          <button
            onClick={handleKick}
            className="w-full text-left px-3 py-2 text-red-400 hover:bg-gray-800 rounded transition-colors"
          >
            Kick Player
          </button>
        )}
      </div>
    </div>
  );
}
