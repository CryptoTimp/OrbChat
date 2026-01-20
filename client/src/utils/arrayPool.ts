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

// Global array pools for common types
export const orbArrayPool = new ArrayPool<any>(5);
export const playerArrayPool = new ArrayPool<{ player: any; isLocal: boolean; renderY: number }>(5);
export const particleArrayPool = new ArrayPool<any>(10);
export const numberArrayPool = new ArrayPool<number>(10);
export const stringArrayPool = new ArrayPool<string>(10);
