import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import { Redis } from "ioredis";
import { env, redisConnection } from "../config.ts";
import { type GuardianDoc, Guardians } from "../models.ts";

// erxes core integration over its internal tRPC API, the same channel
// erxes-api-shared `sendTRPCMessage` uses: core-api's address comes from
// Redis service discovery (`erxes-service-core`) and the tenant travels in the
// base64 `x-trpc-context` header. Only enabled with ERXES_ENABLED=true, and
// only reachable from inside the erxes network (core-api is not public).

let redis: Redis | undefined;

const coreAddress = async () => {
  redis ??= new Redis({ ...redisConnection, lazyConnect: true, maxRetriesPerRequest: 1 });
  if (redis.status === "wait") await redis.connect();
  const address = await redis.get("erxes-service-core");
  if (!address) throw new Error("erxes core-api is not registered in Redis (erxes-service-core)");
  return address;
};

const call = async <T>(method: "query" | "mutation", path: string, input: unknown): Promise<T> => {
  const address = await coreAddress();
  const context = Buffer.from(
    JSON.stringify({
      subdomain: env.ERXES_SUBDOMAIN,
      method,
      ...(env.ERXES_USER_ID ? { userId: env.ERXES_USER_ID } : {}),
    }),
    "utf8",
  ).toString("base64");

  const client = createTRPCUntypedClient({
    links: [httpBatchLink({ url: `${address}/trpc`, headers: () => ({ "x-trpc-context": context }) })],
  });
  return (await client[method](path, input)) as T;
};

type ErxesCustomer = { _id: string } | null | Record<string, never>;

const splitName = (name: string) => {
  // "Б. Сарнай" -> lastName "Б.", firstName "Сарнай"
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: name.trim(), lastName: "" };
  return { firstName: parts.slice(1).join(" "), lastName: parts[0] ?? "" };
};

export const erxesStatus = () => ({ enabled: env.ERXES_ENABLED, notes: Boolean(env.ERXES_USER_ID) });

/** Finds the guardian in erxes Contacts by phone, or creates the customer. */
export const syncGuardian = async (guardian: GuardianDoc, childNames: string[] = []) => {
  if (!env.ERXES_ENABLED) return { synced: false, reason: "ERXES_ENABLED=false" };

  const existing = await call<ErxesCustomer>("query", "customers.findOne", {
    customerPrimaryPhone: guardian.phone,
  });

  let customerId = existing && "_id" in existing ? existing._id : undefined;

  if (!customerId) {
    const created = await call<{ _id: string }>("mutation", "customers.createCustomer", {
      doc: {
        ...splitName(guardian.name),
        primaryPhone: guardian.phone,
        phones: [guardian.phone],
        state: "customer",
        description: `Subedei: ${guardian.relation}${childNames.length ? ` — ${childNames.join(", ")}` : ""}`,
      },
    });
    customerId = created._id;
  }

  await Guardians.updateOne({ _id: guardian._id }, { erxesCustomerId: customerId });
  return { synced: true, customerId };
};

/**
 * Adds an internal note to the guardian's erxes customer timeline. Needs
 * ERXES_USER_ID (erxes only accepts notes written by an active user).
 * Best-effort: failures are logged, never thrown.
 */
export const logToErxes = async (guardian: GuardianDoc, content: string) => {
  if (!env.ERXES_ENABLED || !env.ERXES_USER_ID || !guardian.erxesCustomerId) return;
  try {
    await call("mutation", "internalNotes.add", {
      contentType: "core:customer",
      contentTypeId: guardian.erxesCustomerId,
      content: content.slice(0, 5000),
    });
  } catch (error) {
    console.warn("[erxes] note failed:", (error as Error).message);
  }
};
