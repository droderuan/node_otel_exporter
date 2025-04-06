import { Collection, Db, Document, MongoClient } from "mongodb";

const url = "mongodb://localhost:27017";

const dbName = "node_otel_exporter";

const client = new MongoClient(url, {
  auth: { username: "root", password: "example" },
});

let db: Db;

export let mongo: {
  db: Db;
  collections: {
    metrics: Collection<Document>;
    traces: Collection<Document>;
    serviceMap: Collection<Document>;
  };
  end: Function;
};

export async function startMongo() {
  await client.connect();
  db = client.db(dbName);

  mongo = {
    db,
    collections: {
      metrics: db.collection("metrics"),
      traces: db.collection("traces"),
      serviceMap: db.collection("serviceMap"),
    },
    end: async () => {
      await client.close();
    },
  };
  return;
}
