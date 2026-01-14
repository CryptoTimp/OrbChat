import { useState, useEffect } from 'react';

interface Notification {
  id: string;
  message: string;
  type: 'join' | 'leave' | 'error' | 'success';
  timestamp: number;
}

// Global notification state (outside component to persist across renders)
let notificationListeners: ((notifications: Notification[]) => void)[] = [];
let notifications: Notification[] = [];
let recentMessages = new Set<string>(); // Deduplication

export function addNotification(message: string, type: 'join' | 'leave' | 'error' | 'success' = 'join') {
  // Deduplicate: don't show same message within 2 seconds
  const dedupeKey = `${type}:${message}`;
  if (recentMessages.has(dedupeKey)) {
    return; // Skip duplicate
  }
  
  recentMessages.add(dedupeKey);
  setTimeout(() => recentMessages.delete(dedupeKey), 2000);
  
  const notification: Notification = {
    id: `${Date.now()}-${Math.random()}`,
    message,
    type,
    timestamp: Date.now(),
  };
  
  notifications = [...notifications, notification];
  notificationListeners.forEach(listener => listener(notifications));
  
  // Auto-remove after 4 seconds
  setTimeout(() => {
    removeNotification(notification.id);
  }, 4000);
}

function removeNotification(id: string) {
  notifications = notifications.filter(n => n.id !== id);
  notificationListeners.forEach(listener => listener(notifications));
}

export function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  
  useEffect(() => {
    // Subscribe to notifications
    const listener = (newNotifications: Notification[]) => {
      setItems([...newNotifications]);
    };
    
    notificationListeners.push(listener);
    
    return () => {
      notificationListeners = notificationListeners.filter(l => l !== listener);
    };
  }, []);
  
  if (items.length === 0) return null;
  
  return (
    <div className="fixed top-20 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map((notification) => (
        <div
          key={notification.id}
          className={`
            px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm
            animate-slide-in-right
            ${notification.type === 'join' 
              ? 'bg-emerald-900/80 border border-emerald-500/50 text-emerald-200' 
              : notification.type === 'error'
              ? 'bg-red-900/80 border border-red-500/50 text-red-200'
              : notification.type === 'success'
              ? 'bg-emerald-900/80 border border-emerald-500/50 text-emerald-200'
              : 'bg-slate-900/80 border border-slate-500/50 text-slate-200'
            }
          `}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">
              {notification.type === 'join' ? '👋' : notification.type === 'error' ? '⚠️' : notification.type === 'success' ? '✅' : '🚪'}
            </span>
            <span className="text-sm font-pixel">
              {notification.message}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Clear state on HMR
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    notifications = [];
    recentMessages.clear();
    notificationListeners = [];
  });
}
