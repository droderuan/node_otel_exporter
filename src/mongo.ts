import { MongoClient } from "mongodb";

const url = "mongodb://localhost:27017";

const dbName = "node_otel_exporter";

const client = new MongoClient(url, {
  auth: { username: "root", password: "example" },
});

export async function startMongo() {
  await client.connect();
  const db = client.db(dbName);

  return {
    db,
    collections: {
      metrics: db.collection("metrics"),
      traces: db.collection("traces"),
    },
    end: async () => {
      await client.close();
    },
  };
}
