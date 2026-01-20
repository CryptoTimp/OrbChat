import { useRef, useEffect, useCallback } from 'react';

type GameLoopCallback = (deltaTime: number) => void;

export function useGameLoop(callback: GameLoopCallback, isRunning: boolean = true) {
  const requestRef = useRef<number>();
  const previousTimeRef = useRef<number>();
  const callbackRef = useRef<GameLoopCallback>(callback);
  
  // Smooth deltaTime using exponential moving average to prevent jitter at high speeds
  // This reduces micro-stutters from variable frame timing while maintaining responsiveness
  const smoothedDeltaTimeRef = useRef<number | null>(null);
  const SMOOTHING_FACTOR = 0.3; // Higher = more responsive, lower = smoother (0.3 is a good balance)
  
  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  
  const animate = useCallback((time: number) => {
    if (previousTimeRef.current !== undefined) {
      let deltaTime = time - previousTimeRef.current;
      
      // Cap deltaTime to prevent huge jumps (e.g., tab switching, browser lag)
      // This ensures consistent movement speed even with frame drops
      const MAX_DELTA_TIME = 100; // Cap at 100ms (10 FPS minimum)
      if (deltaTime > MAX_DELTA_TIME) {
        deltaTime = MAX_DELTA_TIME;
      }
      
      // Ensure minimum deltaTime to prevent division by zero or extremely fast movement
      const MIN_DELTA_TIME = 1; // Minimum 1ms
      if (deltaTime < MIN_DELTA_TIME) {
        deltaTime = MIN_DELTA_TIME;
      }
      
      // Smooth deltaTime using exponential moving average
      // This reduces jitter from variable frame timing (especially noticeable at high speeds)
      // while still being responsive to actual frame rate changes
      if (smoothedDeltaTimeRef.current === null) {
        // First frame - use actual deltaTime
        smoothedDeltaTimeRef.current = deltaTime;
      } else {
        // Smooth: new = old * (1 - factor) + actual * factor
        smoothedDeltaTimeRef.current = smoothedDeltaTimeRef.current * (1 - SMOOTHING_FACTOR) + deltaTime * SMOOTHING_FACTOR;
      }
      
      callbackRef.current(smoothedDeltaTimeRef.current);
    }
    previousTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  }, []);
  
  useEffect(() => {
    if (isRunning) {
      requestRef.current = requestAnimationFrame(animate);
    }
    
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isRunning, animate]);
}
