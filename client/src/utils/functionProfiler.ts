// Function Profiler - Tracks function calls and memory consumption
// Used for debugging memory leaks and performance issues

interface FunctionMetric {
  name: string;
  callCount: number;
  callsPerSecond: number;
  totalMemoryDelta: number;
  avgMemoryDelta: number;
  lastCallTime: number;
  memoryHistory: number[]; // Last 60 samples (one per second)
  leakScore: number; // 0-100, higher = more likely leak
  lastMemorySnapshot: number; // Last memory value
  operationCounts: {
    objectCreations: number;
    arrayCreations: number;
    functionCalls: number;
    canvasOperations: number;
    mapOperations: number;
    setOperations: number;
  };
  recentMemoryDeltas: number[]; // Last 10 memory deltas for trend analysis
}

const functionMetrics = new Map<string, FunctionMetric>();
const callTimestamps = new Map<string, number[]>(); // Track call times for calls/sec calculation
const memoryHistory = new Map<string, number[]>(); // For leak detection
let lastMemoryUpdate = Date.now();
const MEMORY_UPDATE_INTERVAL = 1000; // Update memory history every second

// Check if performance.memory is available (Chrome/Edge only)
const isMemoryAPIAvailable = (): boolean => {
  return typeof (performance as any).memory !== 'undefined' && 
         typeof (performance as any).memory.usedJSHeapSize === 'number';
};

// Get current memory usage in MB
const getCurrentMemory = (): number => {
  if (!isMemoryAPIAvailable()) return 0;
  return ((performance as any).memory.usedJSHeapSize / 1024 / 1024);
};

// Calculate calls per second for a function
const calculateCallsPerSecond = (name: string): number => {
  const timestamps = callTimestamps.get(name) || [];
  const now = Date.now();
  const oneSecondAgo = now - 1000;
  
  // Filter to only last second
  const recentCalls = timestamps.filter(t => t > oneSecondAgo);
  callTimestamps.set(name, recentCalls);
  
  return recentCalls.length;
};

// Calculate leak score based on memory growth trend
const calculateLeakScore = (name: string, metric: FunctionMetric): number => {
  const history = memoryHistory.get(name) || [];
  if (history.length < 10) return 0; // Need at least 10 samples
  
  // Calculate linear regression slope
  const n = history.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  
  history.forEach((value, index) => {
    const x = index;
    const y = value;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  });
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  
  // Only flag as leak if:
  // 1. Slope is positive (memory growing over time)
  // 2. Total memory delta is positive (net memory increase)
  // 3. Growth rate is significant
  if (slope <= 0 || metric.totalMemoryDelta <= 0) {
    return 0; // Not a leak if memory is decreasing or stable
  }
  
  // Convert slope to leak score (0-100)
  // Positive slope = memory growing = leak
  // Threshold: > 0.1 MB per sample (60 samples = 60 seconds) = > 6 MB per minute = leak
  const mbPerMinute = slope * 60; // Convert to MB per minute
  const leakScore = Math.min(100, Math.max(0, (mbPerMinute / 10) * 100)); // Scale to 0-100
  
  return leakScore;
};

// Update memory history for leak detection
const updateMemoryHistory = () => {
  const now = Date.now();
  if (now - lastMemoryUpdate < MEMORY_UPDATE_INTERVAL) return;
  lastMemoryUpdate = now;
  
  const currentMemory = getCurrentMemory();
  
  // Update history for each tracked function
  functionMetrics.forEach((metric, name) => {
    let history = memoryHistory.get(name) || [];
    history.push(metric.lastMemorySnapshot || currentMemory);
    
    // Keep only last 60 samples (60 seconds)
    if (history.length > 60) {
      history.shift();
    }
    
    memoryHistory.set(name, history);
    
    // Update leak score
    metric.leakScore = calculateLeakScore(name, metric);
  });
};

// Instrument a function to track calls and memory
export function instrumentFunction<T extends (...args: any[]) => any>(
  fn: T,
  name: string
): T {
  if (!isMemoryAPIAvailable()) {
    console.warn('[FunctionProfiler] performance.memory not available, profiling disabled');
    return fn;
  }
  
  const wrapped = ((...args: any[]) => {
    // Get memory before
    const memoryBefore = getCurrentMemory();
    
    // Call original function
    const result = fn(...args);
    
    // Get memory after
    const memoryAfter = getCurrentMemory();
    const memoryDelta = memoryAfter - memoryBefore;
    
    // Update metrics
    let metric = functionMetrics.get(name);
    if (!metric) {
      metric = {
        name,
        callCount: 0,
        callsPerSecond: 0,
        totalMemoryDelta: 0,
        avgMemoryDelta: 0,
        lastCallTime: Date.now(),
        memoryHistory: [],
        leakScore: 0,
        lastMemorySnapshot: memoryAfter,
        operationCounts: {
          objectCreations: 0,
          arrayCreations: 0,
          functionCalls: 0,
          canvasOperations: 0,
          mapOperations: 0,
          setOperations: 0,
        },
        recentMemoryDeltas: [],
      };
      functionMetrics.set(name, metric);
    }
    
    metric.callCount++;
    metric.totalMemoryDelta += memoryDelta;
    metric.avgMemoryDelta = metric.totalMemoryDelta / metric.callCount;
    metric.lastCallTime = Date.now();
    metric.lastMemorySnapshot = memoryAfter;
    
    // Track recent memory deltas for trend analysis
    metric.recentMemoryDeltas.push(memoryDelta);
    if (metric.recentMemoryDeltas.length > 10) {
      metric.recentMemoryDeltas.shift();
    }
    
    // Analyze memory delta to infer operations (heuristic)
    if (memoryDelta > 0.001) { // > 1KB
      // Likely object/array creation
      if (memoryDelta < 0.1) {
        metric.operationCounts.objectCreations++;
      } else {
        metric.operationCounts.arrayCreations++;
      }
    }
    
    // Check if result is a canvas context or canvas-related
    if (result && (result instanceof CanvasRenderingContext2D || result instanceof HTMLCanvasElement)) {
      metric.operationCounts.canvasOperations++;
    }
    
    // Track call timestamp for calls/sec calculation
    let timestamps = callTimestamps.get(name) || [];
    timestamps.push(Date.now());
    callTimestamps.set(name, timestamps);
    
    // Update calls per second
    metric.callsPerSecond = calculateCallsPerSecond(name);
    
    // Update memory history periodically
    updateMemoryHistory();
    
    return result;
  }) as T;
  
  return wrapped;
}

// Instrument all functions in a module
export function instrumentModule(module: any, prefix: string = ''): void {
  if (!isMemoryAPIAvailable()) return;
  
  for (const key in module) {
    if (typeof module[key] === 'function' && key !== 'default') {
      const originalFn = module[key];
      const fullName = prefix ? `${prefix}.${key}` : key;
      module[key] = instrumentFunction(originalFn, fullName);
    }
  }
}

// Get all function metrics for display
export function getFunctionMetrics(): FunctionMetric[] {
  updateMemoryHistory(); // Ensure history is up to date
  
  return Array.from(functionMetrics.values())
    .map(metric => ({
      ...metric,
      // Recalculate calls per second
      callsPerSecond: calculateCallsPerSecond(metric.name),
      // Ensure operationCounts exists
      operationCounts: metric.operationCounts || {
        objectCreations: 0,
        arrayCreations: 0,
        functionCalls: 0,
        canvasOperations: 0,
        mapOperations: 0,
        setOperations: 0,
      },
      // Ensure recentMemoryDeltas exists
      recentMemoryDeltas: metric.recentMemoryDeltas || [],
    }))
    .sort((a, b) => {
      // Sort by leak score first, then by total memory delta
      if (Math.abs(a.leakScore - b.leakScore) > 1) {
        return b.leakScore - a.leakScore;
      }
      return Math.abs(b.totalMemoryDelta) - Math.abs(a.totalMemoryDelta);
    });
}

// Clear metrics for a specific function
export function clearFunctionMetrics(name: string): void {
  functionMetrics.delete(name);
  callTimestamps.delete(name);
  memoryHistory.delete(name);
}

// Clear all metrics
export function clearAllMetrics(): void {
  functionMetrics.clear();
  callTimestamps.clear();
  memoryHistory.clear();
}

// Get current total memory usage
export function getTotalMemoryUsage(): number {
  return getCurrentMemory();
}

// Check if memory API is available
export function isMemoryAvailable(): boolean {
  return isMemoryAPIAvailable();
}

// Leak analysis report
interface LeakReport {
  functionName: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  leakScore: number;
  totalMemoryLeaked: number; // MB
  growthRate: number; // MB per minute
  callsPerSecond: number;
  avgMemoryDelta: number;
  likelyCauses: string[];
  recommendations: string[];
  operationBreakdown: {
    objectCreations: number;
    arrayCreations: number;
    canvasOperations: number;
    functionCalls: number;
  };
}

// Analyze and generate leak reports
export function analyzeLeaks(): LeakReport[] {
  const reports: LeakReport[] = [];
  const metrics = getFunctionMetrics();
  
  for (const metric of metrics) {
    // Skip if leak score is low OR if total memory delta is negative (memory is being released, not leaked)
    if (metric.leakScore < 10 || metric.totalMemoryDelta <= 0) continue;
    
    const growthRate = metric.recentMemoryDeltas && metric.recentMemoryDeltas.length > 0
      ? metric.recentMemoryDeltas.reduce((a, b) => a + Math.max(0, b), 0) / metric.recentMemoryDeltas.length * 60
      : 0;
    
    // Determine severity
    let severity: 'critical' | 'high' | 'medium' | 'low';
    if (metric.leakScore > 70 || metric.totalMemoryDelta > 100 || growthRate > 10) {
      severity = 'critical';
    } else if (metric.leakScore > 50 || metric.totalMemoryDelta > 50 || growthRate > 5) {
      severity = 'high';
    } else if (metric.leakScore > 30 || metric.totalMemoryDelta > 20 || growthRate > 2) {
      severity = 'medium';
    } else {
      severity = 'low';
    }
    
    // Analyze likely causes based on patterns
    const likelyCauses: string[] = [];
    const recommendations: string[] = [];
    
    // High call frequency + memory growth = likely repeated allocations
    if (metric.callsPerSecond > 100 && metric.avgMemoryDelta > 0.001) {
      likelyCauses.push(`High call frequency (${metric.callsPerSecond.toFixed(0)}/s) with memory growth per call`);
      recommendations.push(`Consider caching or object pooling to avoid repeated allocations in ${metric.name}`);
    }
    
    // Large average delta = likely creating large objects/arrays
    if (metric.avgMemoryDelta > 0.1) {
      likelyCauses.push(`Large memory allocation per call (${metric.avgMemoryDelta.toFixed(2)}MB)`);
      recommendations.push(`Review ${metric.name} for large object/array creations that could be cached or reused`);
    }
    
    // Canvas operations = potential canvas context leaks
    if (metric.operationCounts.canvasOperations > 0) {
      likelyCauses.push(`Canvas operations detected (${metric.operationCounts.canvasOperations} operations)`);
      recommendations.push(`Check ${metric.name} for canvas context leaks - ensure contexts are properly released`);
    }
    
    // Many object creations = potential object leak
    if (metric.operationCounts.objectCreations > 100) {
      likelyCauses.push(`Many object creations (${metric.operationCounts.objectCreations} objects)`);
      recommendations.push(`Implement object pooling or reuse objects in ${metric.name} instead of creating new ones`);
    }
    
    // Many array creations = potential array leak
    if (metric.operationCounts.arrayCreations > 10) {
      likelyCauses.push(`Many array creations (${metric.operationCounts.arrayCreations} arrays)`);
      recommendations.push(`Reuse arrays or use typed arrays in ${metric.name} to reduce allocations`);
    }
    
    // Game loop specific analysis
    if (metric.name.includes('gameLoop')) {
      likelyCauses.push('Main game loop - leaks here affect entire application');
      recommendations.push('Review game loop for: event listeners not removed, closures holding references, cached data not cleared');
    }
    
    // Renderer specific analysis
    if (metric.name.includes('draw') || metric.name.includes('render')) {
      likelyCauses.push('Rendering function - may be creating graphics resources');
      recommendations.push('Check for: uncached canvas operations, gradient/pattern creations, image data not released');
    }
    
    // High total memory = accumulated leak
    if (metric.totalMemoryDelta > 50) {
      likelyCauses.push(`Accumulated ${metric.totalMemoryDelta.toFixed(2)}MB of leaked memory`);
      recommendations.push(`URGENT: ${metric.name} has leaked significant memory - immediate investigation required`);
    }
    
    // If no specific causes found, provide generic advice
    if (likelyCauses.length === 0) {
      likelyCauses.push('Memory growth pattern detected but specific cause unclear');
      recommendations.push(`Profile ${metric.name} with Chrome DevTools Memory Profiler to identify retained objects`);
    }
    
    reports.push({
      functionName: metric.name,
      severity,
      leakScore: metric.leakScore,
      totalMemoryLeaked: metric.totalMemoryDelta,
      growthRate,
      callsPerSecond: metric.callsPerSecond,
      avgMemoryDelta: metric.avgMemoryDelta,
      likelyCauses,
      recommendations,
      operationBreakdown: {
        objectCreations: metric.operationCounts.objectCreations,
        arrayCreations: metric.operationCounts.arrayCreations,
        canvasOperations: metric.operationCounts.canvasOperations,
        functionCalls: metric.operationCounts.functionCalls,
      },
    });
  }
  
  // Sort by severity and leak score
  reports.sort((a, b) => {
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[b.severity] - severityOrder[a.severity];
    }
    return b.leakScore - a.leakScore;
  });
  
  return reports;
}

// Log leak warnings to console
let lastLeakWarningTime = 0;
const LEAK_WARNING_INTERVAL = 10000; // Warn every 10 seconds max

export function checkAndWarnAboutLeaks(): void {
  const now = Date.now();
  if (now - lastLeakWarningTime < LEAK_WARNING_INTERVAL) return;
  lastLeakWarningTime = now;
  
  const reports = analyzeLeaks();
  const criticalLeaks = reports.filter(r => r.severity === 'critical');
  const highLeaks = reports.filter(r => r.severity === 'high');
  
  if (criticalLeaks.length > 0 || highLeaks.length > 0) {
    console.group('🚨 MEMORY LEAK DETECTED');
    
    if (criticalLeaks.length > 0) {
      console.error(`%cCRITICAL: ${criticalLeaks.length} function(s) with severe memory leaks`, 'color: red; font-weight: bold; font-size: 14px;');
      criticalLeaks.forEach(report => {
        console.group(`%c${report.functionName}`, 'color: red; font-weight: bold;');
        console.error(`Leak Score: ${report.leakScore.toFixed(1)}/100`);
        console.error(`Total Leaked: ${report.totalMemoryLeaked.toFixed(2)} MB`);
        console.error(`Growth Rate: ${report.growthRate.toFixed(2)} MB/min`);
        console.error(`Calls/sec: ${report.callsPerSecond.toFixed(1)}`);
        console.warn('Likely Causes:', report.likelyCauses);
        console.info('Recommendations:', report.recommendations);
        console.groupEnd();
      });
    }
    
    if (highLeaks.length > 0) {
      console.warn(`%cHIGH: ${highLeaks.length} function(s) with significant memory leaks`, 'color: orange; font-weight: bold;');
      highLeaks.forEach(report => {
        console.group(`%c${report.functionName}`, 'color: orange; font-weight: bold;');
        console.warn(`Leak Score: ${report.leakScore.toFixed(1)}/100`);
        console.warn(`Total Leaked: ${report.totalMemoryLeaked.toFixed(2)} MB`);
        console.warn(`Growth Rate: ${report.growthRate.toFixed(2)} MB/min`);
        console.info('Likely Causes:', report.likelyCauses);
        console.info('Recommendations:', report.recommendations);
        console.groupEnd();
      });
    }
    
    console.groupEnd();
  }
}

// Auto-check for leaks periodically
let leakCheckInterval: number | null = null;

export function startLeakMonitoring(intervalMs: number = 5000): void {
  if (leakCheckInterval !== null) {
    clearInterval(leakCheckInterval);
  }
  leakCheckInterval = window.setInterval(() => {
    checkAndWarnAboutLeaks();
  }, intervalMs);
}

export function stopLeakMonitoring(): void {
  if (leakCheckInterval !== null) {
    clearInterval(leakCheckInterval);
    leakCheckInterval = null;
  }
}
