import { useGameStore } from '../state/gameStore';
import { playCloseSound } from '../utils/sounds';

export function SettingsModal() {
  const settingsOpen = useGameStore(state => state.settingsOpen);
  const toggleSettings = useGameStore(state => state.toggleSettings);
  const musicVolume = useGameStore(state => state.musicVolume);
  const setMusicVolume = useGameStore(state => state.setMusicVolume);
  const musicEnabled = useGameStore(state => state.musicEnabled);
  const setMusicEnabled = useGameStore(state => state.setMusicEnabled);
  const sfxVolume = useGameStore(state => state.sfxVolume);
  const setSfxVolume = useGameStore(state => state.setSfxVolume);
  const sfxEnabled = useGameStore(state => state.sfxEnabled);
  const setSfxEnabled = useGameStore(state => state.setSfxEnabled);
  
  if (!settingsOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div 
        className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl border-2 border-gray-600 shadow-2xl overflow-hidden"
        style={{ width: '400px' }}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-gray-700 to-gray-800 px-6 py-4 border-b border-gray-600 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h2 className="text-xl font-pixel text-white">Settings</h2>
          </div>
          <button
            onClick={() => { playCloseSound(); toggleSettings(); }}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Music Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🎵</span>
                <span className="font-pixel text-gray-200 text-sm">Music</span>
              </div>
              <button
                onClick={() => setMusicEnabled(!musicEnabled)}
                className={`px-3 py-1 rounded font-pixel text-xs transition-all ${
                  musicEnabled 
                    ? 'bg-emerald-500 text-white' 
                    : 'bg-gray-600 text-gray-300'
                }`}
              >
                {musicEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-xs">🔈</span>
              <input
                type="range"
                min="0"
                max="100"
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
                disabled={!musicEnabled}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-700 
                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 
                          [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full 
                          [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:cursor-pointer
                          disabled:opacity-50"
              />
              <span className="text-gray-400 text-xs">🔊</span>
              <span className="text-gray-300 font-pixel text-xs w-10 text-right">{musicVolume}%</span>
            </div>
          </div>
          
          {/* SFX Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔔</span>
                <span className="font-pixel text-gray-200 text-sm">Sound Effects</span>
              </div>
              <button
                onClick={() => setSfxEnabled(!sfxEnabled)}
                className={`px-3 py-1 rounded font-pixel text-xs transition-all ${
                  sfxEnabled 
                    ? 'bg-emerald-500 text-white' 
                    : 'bg-gray-600 text-gray-300'
                }`}
              >
                {sfxEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-xs">🔈</span>
              <input
                type="range"
                min="0"
                max="100"
                value={sfxVolume}
                onChange={(e) => setSfxVolume(Number(e.target.value))}
                disabled={!sfxEnabled}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-700 
                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 
                          [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full 
                          [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:cursor-pointer
                          disabled:opacity-50"
              />
              <span className="text-gray-400 text-xs">🔊</span>
              <span className="text-gray-300 font-pixel text-xs w-10 text-right">{sfxVolume}%</span>
            </div>
          </div>
          
          {/* Info */}
          <div className="pt-4 border-t border-gray-700">
            <p className="text-gray-500 text-xs text-center font-pixel">
              🌲 Forest map has ambient music
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
