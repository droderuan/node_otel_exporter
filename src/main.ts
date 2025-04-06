import express from "express";
import { routes } from "./api";
import { startMongo } from "./mongo";
import { ServiceMapWebSocket } from "./websocket";
import { ServiceMap } from "./serviceMap";

async function bootstrap() {
  const host = "0.0.0.0";
  const port = 8000;
  const apiUrl = `${host}:${port}`;

  await startMongo();

  const app = express();
  app.use(routes);

  // Create HTTP server
  const server = app.listen(port, host, () => {
    console.info(`Server started at ${apiUrl}`);
  });

  // Initialize WebSocket server
  const wsHandler = ServiceMapWebSocket.getInstance(server);
  ServiceMap.setWebSocketHandler(wsHandler);
}

bootstrap();
