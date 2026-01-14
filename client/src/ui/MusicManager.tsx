import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../state/gameStore';

// Automatically import all MP3 files from the soundtracks folder
const soundtrackModules = import.meta.glob('/public/soundtracks/*.mp3', { eager: true, query: '?url', import: 'default' });

// Extract the URLs from the glob import
const SOUNDTRACKS: string[] = Object.keys(soundtrackModules).map(path => {
  // Convert /public/soundtracks/file.mp3 to /soundtracks/file.mp3
  return path.replace('/public', '');
});

console.log('Loaded soundtracks:', SOUNDTRACKS);

// Singleton audio instance to prevent duplicates
let globalAudio: HTMLAudioElement | null = null;
let currentTrackIndex: number = -1;
let shuffledPlaylist: string[] = [];
let isInRoom: boolean = false;

// Music is background, so scale it down relative to SFX
const MUSIC_VOLUME_SCALE = 0.3;

// Shuffle array using Fisher-Yates algorithm
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Initialize or reshuffle playlist
function initializePlaylist() {
  shuffledPlaylist = shuffleArray(SOUNDTRACKS);
  currentTrackIndex = 0;
}

// Get next track (cycles through shuffled playlist, reshuffles when done)
function getNextTrack(): string {
  if (shuffledPlaylist.length === 0 || currentTrackIndex >= shuffledPlaylist.length) {
    initializePlaylist();
  }
  const track = shuffledPlaylist[currentTrackIndex];
  currentTrackIndex++;
  return track;
}

function stopGlobalAudio() {
  if (globalAudio) {
    globalAudio.pause();
    globalAudio.src = '';
    globalAudio.remove();
    globalAudio = null;
  }
}

export function MusicManager() {
  const roomId = useGameStore(state => state.roomId);
  const musicEnabled = useGameStore(state => state.musicEnabled);
  const musicVolume = useGameStore(state => state.musicVolume);
  
  const interactionHandlerRef = useRef<(() => void) | null>(null);
  
  // Cleanup interaction listeners
  const cleanupListeners = useCallback(() => {
    if (interactionHandlerRef.current) {
      document.removeEventListener('click', interactionHandlerRef.current);
      document.removeEventListener('keydown', interactionHandlerRef.current);
      interactionHandlerRef.current = null;
    }
  }, []);
  
  // Play a specific track
  const playTrack = useCallback((trackUrl: string) => {
    const volume = (useGameStore.getState().musicVolume / 100) * MUSIC_VOLUME_SCALE;
    
    // Create new audio instance
    const audio = new Audio(trackUrl);
    audio.loop = false; // Don't loop single track, we'll play next when it ends
    audio.volume = volume;
    
    // When track ends, play next shuffled track
    audio.onended = () => {
      if (isInRoom && useGameStore.getState().musicEnabled) {
        const nextTrack = getNextTrack();
        playTrack(nextTrack);
      }
    };
    
    globalAudio = audio;
    
    // Try to play
    audio.play().catch(err => {
      console.log('Music autoplay blocked, waiting for interaction:', err.message);
    });
  }, []);
  
  // Handle music playback based on room state
  useEffect(() => {
    const wasInRoom = isInRoom;
    isInRoom = !!roomId;
    
    // If we left the room, stop music
    if (!roomId) {
      stopGlobalAudio();
      cleanupListeners();
      return;
    }
    
    // If we just joined a room (wasn't in room before), start fresh playlist
    if (!wasInRoom && roomId) {
      stopGlobalAudio();
      cleanupListeners();
      
      // Initialize fresh shuffled playlist
      initializePlaylist();
      
      if (!musicEnabled) {
        return;
      }
      
      // Start playing first random track
      const firstTrack = getNextTrack();
      playTrack(firstTrack);
      
      // Setup interaction handler for autoplay policy
      const handleInteraction = () => {
        if (globalAudio && globalAudio.paused && useGameStore.getState().musicEnabled) {
          globalAudio.play().catch(() => {});
        }
        cleanupListeners();
      };
      
      interactionHandlerRef.current = handleInteraction;
      document.addEventListener('click', handleInteraction, { once: true });
      document.addEventListener('keydown', handleInteraction, { once: true });
    }
    
    // Cleanup on unmount
    return () => {
      cleanupListeners();
    };
  }, [roomId, musicEnabled, cleanupListeners, playTrack]);
  
  // Handle volume changes separately
  useEffect(() => {
    if (globalAudio) {
      globalAudio.volume = (musicVolume / 100) * MUSIC_VOLUME_SCALE;
    }
  }, [musicVolume]);
  
  // Handle music enable/disable toggle
  useEffect(() => {
    if (!globalAudio) return;
    
    if (musicEnabled) {
      globalAudio.play().catch(() => {});
    } else {
      globalAudio.pause();
    }
  }, [musicEnabled]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopGlobalAudio();
      cleanupListeners();
      isInRoom = false;
    };
  }, [cleanupListeners]);
  
  return null;
}
