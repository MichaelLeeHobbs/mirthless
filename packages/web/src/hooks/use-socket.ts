// ===========================================
// Socket Hooks
// ===========================================
// React hooks for Socket.IO event subscriptions.
// Stub — full implementation provided by Unit 4.

import { useEffect } from 'react';
import { getSocket } from '../lib/socket.js';

/** Establishes and manages the socket connection lifecycle. Stub — implemented in Unit 4. */
export function useSocketConnection(): void {
  // Stub - implemented in Unit 4
}

/** Subscribe to a socket event for the lifetime of the component. */
export function useSocketEvent(event: string, handler: (data: unknown) => void): void {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.on(event, handler);
    return () => { s.off(event, handler); };
  }, [event, handler]);
}
