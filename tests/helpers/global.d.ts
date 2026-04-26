import type { WebsocketProvider } from 'y-websocket';

declare global {
  interface Window {
    __yProvider?: WebsocketProvider;
  }
}
