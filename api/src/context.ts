import { z } from "zod";

// The gateway forwards the signed-in user as base64 JSON in the `user` header
// and the request host in `hostname` (or `nginx-hostname` behind nginx).
// These are unsigned identity assertions, NOT independent authentication.
// Only expose this API on a private network reachable by the trusted erxes
// gateway. The public ingress must strip/overwrite client-supplied identity
// and tenant headers. Never authorize a public direct request using them.
const userSchema = z
  .object({
    _id: z.string(),
    email: z.string().optional(),
    username: z.string().optional(),
    isOwner: z.boolean().optional(),
  })
  .loose();

export type ErxesUser = z.infer<typeof userSchema>;

export type Context = {
  /** Tenant: first label of the erxes host (`acme` in acme.app.erxes.io). */
  subdomain: string;
  /** Signed-in erxes user, or null for anonymous requests. */
  user: ErxesUser | null;
};

/** Fetch `Headers` (Hono, Elysia, Yoga) or Node's plain-object headers. */
export type HeaderSource = Headers | Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const parseUser = (header: string | undefined): ErxesUser | null => {
  if (!header) return null;
  try {
    const result = userSchema.safeParse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const parseSubdomain = (host: string) => host.replace(/^\w+:\/\//, "").split(/[.:]/)[0] ?? "";

export const createContext = (headers: HeaderSource): Context => {
  const read = (name: string) =>
    headers instanceof Headers ? (headers.get(name) ?? undefined) : single(headers[name]);
  return {
    subdomain: parseSubdomain(
      read("nginx-hostname") ?? read("hostname") ?? read("host") ?? "",
    ),
    user: parseUser(read("user")),
  };
};
