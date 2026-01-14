import { useEffect, useRef, useCallback } from 'react';

interface KeyState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export function useKeyboard() {
  const keysRef = useRef<KeyState>({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keysRef.current.up = true;
        e.preventDefault();
        break;
      case 'KeyS':
      case 'ArrowDown':
        keysRef.current.down = true;
        e.preventDefault();
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keysRef.current.left = true;
        e.preventDefault();
        break;
      case 'KeyD':
      case 'ArrowRight':
        keysRef.current.right = true;
        e.preventDefault();
        break;
    }
  }, []);
  
  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        keysRef.current.up = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keysRef.current.down = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keysRef.current.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keysRef.current.right = false;
        break;
    }
  }, []);
  
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);
  
  const getKeys = useCallback(() => ({ ...keysRef.current }), []);
  
  const isAnyKeyPressed = useCallback(() => {
    return keysRef.current.up || keysRef.current.down || 
           keysRef.current.left || keysRef.current.right;
  }, []);
  
  return { getKeys, isAnyKeyPressed };
}
