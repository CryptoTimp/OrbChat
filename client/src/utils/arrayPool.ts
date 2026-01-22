// Array Pool - Reusable arrays to reduce allocations
// Used to prevent memory leaks from frequent array creations

class ArrayPool<T> {
  private pools: T[][] = [];
  private maxPoolSize: number;
  
  constructor(maxPoolSize: number = 10) {
    this.maxPoolSize = maxPoolSize;
  }
  
  // Get an array from the pool (or create new if pool is empty)
  acquire(): T[] {
    return this.pools.pop() || [];
  }
  
  // Return an array to the pool (clears it first)
  release(arr: T[]): void {
    if (arr.length > 0) {
      arr.length = 0; // Clear array
    }
    if (this.pools.length < this.maxPoolSize) {
      this.pools.push(arr);
    }
  }
}

// Object pool for player wrapper objects to avoid allocations
class ObjectPool<T> {
  private pools: T[] = [];
  private maxPoolSize: number;
  private factory: () => T;
  private reset: (obj: T) => void;
  
  constructor(maxPoolSize: number, factory: () => T, reset: (obj: T) => void) {
    this.maxPoolSize = maxPoolSize;
    this.factory = factory;
    this.reset = reset;
  }
  
  acquire(): T {
    const obj = this.pools.pop() || this.factory();
    this.reset(obj);
    return obj;
  }
  
  release(obj: T): void {
    if (this.pools.length < this.maxPoolSize) {
      this.pools.push(obj);
    }
  }
}

// Global array pools for common types
export const orbArrayPool = new ArrayPool<any>(5);
export const playerArrayPool = new ArrayPool<{ player: any; isLocal: boolean; renderY: number }>(5);
export const playerWithChatArrayPool = new ArrayPool<any>(5); // For PlayerWithChat[] arrays (used by updateCenturionPlayers, updateVillagers)
export const particleArrayPool = new ArrayPool<any>(10);
export const numberArrayPool = new ArrayPool<number>(10);
export const stringArrayPool = new ArrayPool<string>(10);

// Object pool for player wrapper objects
export interface PlayerWrapper {
  player: any;
  isLocal: boolean;
  renderY: number;
  _restoreX?: number;
  _restoreY?: number;
}

export const playerWrapperPool = new ObjectPool<PlayerWrapper>(
  20, // Pool size
  () => ({ player: null, isLocal: false, renderY: 0 }),
  (obj) => {
    obj.player = null;
    obj.isLocal = false;
    obj.renderY = 0;
    obj._restoreX = undefined;
    obj._restoreY = undefined;
  }
);
