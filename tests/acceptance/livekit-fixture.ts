import { useEffect } from 'react';

export const sent: any[] = [];
const listeners = new Map<string, (message: any) => void>();
const byteHandlers = new Map<string, (reader: any) => Promise<void>>();
export const room = {
  state: 'connected',
  localParticipant: {
    async sendText(text: string, options: any) {
      sent.push({ ...JSON.parse(text), topic: options.topic });
    },
  },
  registerByteStreamHandler(topic: string, handler: any) { byteHandlers.set(topic, handler); },
  unregisterByteStreamHandler(topic: string) { byteHandlers.delete(topic); },
};
const session = { room, isConnected: true };
export function useSessionContext() { return session; }
export function useDataChannel(topic: string, callback: (message: any) => void) {
  useEffect(() => {
    listeners.set(topic, callback);
    return () => { if (listeners.get(topic) === callback) listeners.delete(topic); };
  }, [topic, callback]);
  return {};
}
export function emit(op: any) {
  const listener = listeners.get('nova-board');
  if (!listener) throw new Error('Board data listener is not mounted');
  listener({ payload: new TextEncoder().encode(JSON.stringify(op)) });
}
export async function media(id: string) {
  const handler = byteHandlers.get('nova-media');
  if (!handler) throw new Error('Media handler not mounted');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#d4e8cc"/><circle cx="150" cy="100" r="50" fill="#55994a"/></svg>';
  await handler({ info: { attributes: { id }, mimeType: 'image/svg+xml' }, readAll: async () => [new TextEncoder().encode(svg)] });
}
