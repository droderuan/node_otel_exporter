import express from "express";
import { routes } from "./api";
import { startMongo } from "./mongo";

async function bootstrap() {
  const host = "0.0.0.0";
  const port = 8000;
  const apiUrl = `${host}:${port}`;

  await startMongo();

  const server = express();

  server.use(routes);

  server.listen(port, host, () => {
    console.info(`Server started at ${apiUrl}`);
  });
}

bootstrap();
