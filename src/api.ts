import { Router, Request } from "express";
import { otelProto } from "./otel";
import zlib from "zlib";
import { mongo } from "./mongo";
import { Message } from "protobufjs";
import { ServiceMap } from "./serviceMap";

// Extend Express Request type to include rawBody
declare module 'express' {
  interface Request {
    rawBody?: Buffer;
  }
}

export const routes = Router();

// Middleware to capture raw body
routes.use((request: Request, response, next) => {
  const chunks: Array<Uint8Array> = [];

  request.on('data', (chunk: Uint8Array) => {
    chunks.push(chunk);
  });

  request.on('end', () => {
    request.rawBody = Buffer.concat(chunks);
    next();
  });
});

// Middleware to handle compression
routes.use((request: Request, response, next) => {
  const contentEncoding = request.headers["content-encoding"];

  // If no content encoding or not gzip, pass through
  if (!contentEncoding || contentEncoding !== "gzip") {
    request.body = request.rawBody;
    return next();
  }

  // Handle gzipped content
  const gunzip = zlib.createGunzip();

  // Create a stream from the raw body
  const stream = require('stream');
  const rawBodyStream = new stream.Readable();
  rawBodyStream.push(request.rawBody);
  rawBodyStream.push(null);

  rawBodyStream.pipe(gunzip);

  const chunks: Array<Uint8Array> = [];
  gunzip.on("data", (data: Uint8Array) => {
    chunks.push(data);
  });

  gunzip.on("end", () => {
    const buffer = Buffer.concat(chunks);
    request.body = buffer;
    return next();
  });

  gunzip.on("error", (error) => {
    console.error("Error decompressing request:", error);
    response.statusCode = 400;
    response.end(JSON.stringify({ error: "Failed to decompress request" }));
  });
});

routes.all(["", "/v1/metrics", "/v1/traces"], async (request, response) => {
  const buff = request.body as Buffer;

  if (buff.length <= 0) {
    response.statusCode = 200;
    response.end("recebido");
    return;
  }
  if (request.url === "/v1/metrics") {
    const message = otelProto.ExportMetricsServiceRequest.decode(buff);
    await mongo.collections.metrics.insertOne({
      ...message,
      timestamp: Date.now(),
    });
  } else if (request.url === "/v1/traces") {
    console.log("Receiving traces");
    const message = otelProto.ExportTraceServiceRequest.decode(buff) as any;

    message.resourceSpans.forEach((resourceSpan: { scopeSpans: any[] }) => {
      resourceSpan.scopeSpans.forEach((scopeSpan: { spans: any[] }) => {
        scopeSpan.spans.forEach(
          (span: {
            traceId: string;
            spanId: string;
            parentSpanId: string | any[] | null;
          }) => {
            span.traceId = Buffer.from(span.traceId).toString("hex");
            span.spanId = Buffer.from(span.spanId).toString("hex");
            if (span.parentSpanId && span.parentSpanId.length > 0) {
              span.parentSpanId = Buffer.from(span.parentSpanId).toString(
                "hex"
              );
            } else {
              span.parentSpanId = null;
            }
          }
        );
      });
    });

    // Process service map updates
    const serviceMapUpdates = new Map<string, Set<string>>();
    await Promise.all(message.resourceSpans.map(async (resourceSpan: any) => {
      const updates = await ServiceMap.processResourceSpan(resourceSpan);
      updates.forEach((targets: Set<string>, source: string) => {
        if (!serviceMapUpdates.has(source)) {
          serviceMapUpdates.set(source, new Set());
        }
        targets.forEach((target: string) => serviceMapUpdates.get(source)?.add(target));
      });
    }));

    // Update service map in MongoDB
    await ServiceMap.updateServiceMap(serviceMapUpdates);

    await Promise.all(
      message.resourceSpans.map(async (resourceSpan: any) => {
        await mongo.collections.traces.insertOne({
          ...resourceSpan,
          timestamp: Date.now(),
        });
      })
    );
  }

  response.statusCode = 200;
  response.end("recebido");
  return;
});

// New endpoint to get service map
routes.get("/v1/service-map", async (request, response) => {
  try {
    const serviceMap = await ServiceMap.getServiceMap();

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({data: serviceMap}));
  } catch (error) {
    console.error("Error retrieving service map:", error);
    response.statusCode = 500;
    response.end(JSON.stringify({ error: "Failed to retrieve service map" }));
  }
});
