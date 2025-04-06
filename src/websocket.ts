import { WebSocket, WebSocketServer } from 'ws';
import { ServiceMap } from './serviceMap';

export class ServiceMapWebSocket {
  private static instance: ServiceMapWebSocket;
  private wss: WebSocketServer;
  private clients: Set<WebSocket>;

  private constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.clients = new Set();
    this.setupWebSocketServer();
  }

  static getInstance(server: any): ServiceMapWebSocket {
    if (!ServiceMapWebSocket.instance) {
      ServiceMapWebSocket.instance = new ServiceMapWebSocket(server);
    }
    return ServiceMapWebSocket.instance;
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.debug('[WS] New connection established');
      this.clients.add(ws);

      // Send initial service map state
      ServiceMap.getServiceMap().then(serviceMap => {
        const message = JSON.stringify({ type: 'initial', data: serviceMap });
        console.debug(`[WS] Sending initial state to client: ${message}`);
        ws.send(message);
      });

      // Handle client disconnect
      ws.on('close', () => {
        console.debug('[WS] Client disconnected');
        this.clients.delete(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error('[WS] Connection error:', error);
        this.clients.delete(ws);
      });
    });
  }

  public broadcastUpdate(updates: Map<string, Set<string>>): void {
    const message = JSON.stringify({
      type: 'update',
      data: Array.from(updates.entries()).map(([source, targets]) => ({
        source,
        dependencies: Array.from(targets)
      }))
    });

    console.debug(`[WS] Broadcasting update to ${this.clients.size} clients: ${message}`);

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        console.debug(`[WS] Skipping client in state ${client.readyState}`);
      }
    });
  }
}
