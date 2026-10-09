// ===========================================
// Socket Client Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';

const fakeSocket = vi.hoisted(() => {
  const s = {
    connected: false,
    auth: {} as Record<string, unknown>,
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  s.disconnect.mockImplementation(() => s);
  return s;
});

vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));

const { connectSocket, disconnectSocket } = await import('../socket.js');
const { useAuthStore } = await import('../../stores/auth.store.js');

afterEach(() => {
  disconnectSocket();
  vi.clearAllMocks();
  fakeSocket.disconnect.mockImplementation(() => fakeSocket);
});

describe('connectSocket token refresh', () => {
  it('connects a socket the server refused once a new token arrives', () => {
    connectSocket('old-token');
    fakeSocket.connected = false; // e.g. refused while a password change was required

    useAuthStore.getState().setAccessToken('new-token');

    expect(fakeSocket.auth).toEqual({ token: 'new-token' });
    expect(fakeSocket.connect).toHaveBeenCalled();
  });

  it('reconnects a connected socket with the new token', () => {
    connectSocket('old-token');
    fakeSocket.connected = true;

    useAuthStore.getState().setAccessToken('newer-token');

    expect(fakeSocket.disconnect).toHaveBeenCalled();
    expect(fakeSocket.connect).toHaveBeenCalled();
  });
});
