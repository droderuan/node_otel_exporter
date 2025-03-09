import { Router } from "express";
import { otelProto } from "./otel";
import zlib from "zlib";
import { mongo } from "./mongo";
import { Message } from "protobufjs";

export const routes = Router();

routes.use((request, response, next) => {
  console.log(request.url);
  console.log(request.headers);

  response.setHeader("Accept-Encoding", "none");
  const chunks = [] as Array<Uint8Array>;
  var gunzip = zlib.createGunzip();

  request.pipe(gunzip);

  gunzip.on("data", (data: Uint8Array) => {
    chunks.push(data);
  });

  gunzip.on("end", () => {
    const buffer = Buffer.concat(chunks.slice(0));

    zlib.unzip(buffer, (err, buff) => {
      request.body = buffer;
      return next();

      // const message = otelProto.ExportMetricsServiceRequest.decode(buff);
      // console.dir(message || undefined, { depth: null });

      // response.statusCode = 200;
      // response.end("recebido");
      // return;
    });
  });
});

routes.all(["", "/v1/metrics", "/v1/traces"], async (request, response) => {
  const buff = request.body as Buffer;
  console.log(buff);

  if (buff.length <= 0) {
    response.statusCode = 200;
    response.end("recebido");
    return;
  }
  if (request.url === "/v1/metrics") {
    const message = otelProto.ExportMetricsServiceRequest.decode(buff);
    console.log(message);
    await mongo.collections.metrics.insertOne(message);
  } else if (request.url === "/v1/traces") {
    const message = otelProto.ExportTraceServiceRequest.decode(buff);
    console.log(message);
    await mongo.collections.traces.insertOne(message);
  }

  response.statusCode = 200;
  response.end("recebido");
  return;
});

// .createServer((request, response) => {
//   response.setHeader("Accept-Encoding", "none");
//   const chunks = [] as Array<Uint8Array>;
//   var gunzip = zlib.createGunzip();

//   request.pipe(gunzip);

//   console.log(request.url);
//   console.log(request.headers);

//   request.on("data", (data: Uint8Array) => {
//     chunks.push(data);
//   });

//   request.on("end", () => {
//     const buffer = Buffer.concat(chunks.slice(0));

//     zlib.unzip(buffer, (err, buff) => {
//       console.log(buff.toJSON());

//       if (buffer.length <= 1) {
//         console.log("caiu aqui");
//         response.statusCode = 200;
//         response.end("recebido");
//         return;
//       }

//       const message = otelProto.ExportMetricsServiceRequest.decode(buff);
//       console.dir(message || undefined, { depth: null });

//       response.statusCode = 200;
//       response.end("recebido");
//       return;
//     });
//   });
// });
