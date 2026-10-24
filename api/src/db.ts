import mongoose from "mongoose";
import { env } from "./config.ts";

type Stoppable = { stop: () => Promise<unknown> };
let memoryServer: Stoppable | undefined;

/** Connects to MONGO_URL, or to a throwaway in-memory MongoDB when asked. */
export const connectDb = async ({ memory = env.MONGO_MEMORY } = {}) => {
  let url = env.MONGO_URL;

  if (memory) {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const server = await MongoMemoryServer.create();
    memoryServer = server;
    url = server.getUri("subedei");
  }

  await mongoose.connect(url);
  return { url, memory };
};

export const disconnectDb = async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
  memoryServer = undefined;
};
