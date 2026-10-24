import type { Response } from "express";

// Server-sent events: the teacher console listens on "console", each phone
// simulator on "phone:<guardianId>".
const topics = new Map<string, Set<Response>>();

export const subscribe = (topic: string, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: ready\ndata: {}\n\n`);

  const clients = topics.get(topic) ?? new Set<Response>();
  clients.add(res);
  topics.set(topic, clients);

  const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
  res.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
};

export const publish = (topic: string, event: string, data: unknown) => {
  const clients = topics.get(topic);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
};

export const notifyConsole = (event: string, data: unknown = {}) => publish("console", event, data);

export const notifyPhone = (guardianId: unknown, event: string, data: unknown) =>
  publish(`phone:${String(guardianId)}`, event, data);
