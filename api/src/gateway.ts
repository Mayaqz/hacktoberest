import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env, manifest, redisConnection } from "./config.ts";

// Mirrors erxes-api-shared `joinErxesGateway`. The gateway and core-api read
// these keys; keep their names and the config JSON shape unchanged.
const configKey = `erxesservice:config:${manifest.name}`;
const addressKey = `erxes-service-${manifest.name}`;
const ROUTER_UPDATE_LOCK_KEY = "gateway:update-apollo-router:pending";
const ROUTER_UPDATE_QUEUE = "gateway-update-apollo-router";

type ServiceConfig = { meta?: Record<string, unknown> };

/** Announces the API address and UI entry so erxes routes to this plugin. */
export const joinErxesGateway = async (meta: Record<string, unknown> = {}) => {
  const redis = new Redis(redisConnection);

  try {
    const existingJson = await redis.get(configKey);
    const existing: ServiceConfig = existingJson ? JSON.parse(existingJson) : {};

    await redis.set(
      configKey,
      JSON.stringify({
        dbConnectionString: env.MONGO_URL,
        hasSubscriptions: false,
        meta: { ...existing.meta, ...meta },
        releaseVersion: env.RELEASE_VERSION?.startsWith("3.") ? env.RELEASE_VERSION : "latest",
        uiEntry: env.UI_ENTRY_URL,
      }),
    );

    const host = env.NODE_ENV === "development" ? "localhost" : `plugin-${manifest.name}-api`;
    const address = env.LOAD_BALANCER_ADDRESS ?? `http://${host}:${env.PORT}`;
    await redis.set(addressKey, address);

    // A production gateway only recomposes the supergraph when this job runs.
    if (env.NODE_ENV === "production") {
      const acquired = await redis.set(ROUTER_UPDATE_LOCK_KEY, "1", "EX", 30, "NX");
      if (acquired) {
        const queue = new Queue(ROUTER_UPDATE_QUEUE, { connection: redisConnection });
        await queue.add(
          "service-discovery-updated",
          { pluginName: manifest.name },
          {
            delay: 10_000,
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        );
        await queue.close();
      }
    }

    return address;
  } finally {
    redis.disconnect();
  }
};
