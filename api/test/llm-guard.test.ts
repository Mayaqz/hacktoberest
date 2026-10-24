import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

// A fake OpenAI-compatible endpoint that answers with whatever `reply` holds,
// to check how model output is validated before it reaches the teacher.
let reply = "";
const server = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  });
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
after(() => server.close());

const load = async () => {
  process.env.LLM_ENABLED = "true";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return import("../src/services/intent.ts");
};

const ctx = { purpose: "late_pickup" as const, studentName: "Болд", guardianRelation: "ээж", nowTime: "17:10" };

describe("interpretReply with a model", () => {
  it("uses the model when the rules are unsure", async () => {
    const { interpretReply } = await load();
    reply = JSON.stringify({ outcome: "coming", etaMinutes: 15, pickupPerson: null, reason: null, summary: "Ээж нь 15 минутын дараа ирнэ" });
    const intent = await interpretReply("Ажлаасаа гараад шууд тийшээ", ctx);
    assert.equal(intent.engine, "gemma");
    assert.equal(intent.outcome, "coming");
    assert.equal(intent.etaMinutes, 15);
  });

  it("lets explicit rules win over a disagreeing model", async () => {
    const { interpretReply } = await load();
    reply = JSON.stringify({ outcome: "coming", etaMinutes: null, pickupPerson: "Ээж", reason: "x", summary: "Ээж нь ирнэ" });
    const intent = await interpretReply("Эмээ нь авна", ctx);
    assert.equal(intent.outcome, "someone_else");
    assert.equal(intent.pickupPerson, "эмээ");
    assert.equal(intent.engine, "rules");
  });

  it("drops fields that do not belong to the outcome and echoed summaries", async () => {
    const { interpretReply } = await load();
    reply = `Sure! {"outcome": "coming", "etaMinutes": null, "pickupPerson": "Ээж", "reason": "Buld is coming.", "summary": "One short Mongolian sentence for the teacher"}`;
    const intent = await interpretReply("20 минутын дараа очно", ctx);
    assert.equal(intent.engine, "gemma");
    assert.equal(intent.etaMinutes, 20);
    assert.equal(intent.pickupPerson, undefined);
    assert.equal(intent.reason, undefined);
    assert.match(intent.summary, /20 минутын дараа/);
  });

  it("falls back to rules on invalid JSON", async () => {
    const { interpretReply } = await load();
    reply = "I am not sure";
    const intent = await interpretReply("Өнөөдөр очиж чадахгүй", ctx);
    assert.equal(intent.engine, "rules");
    assert.equal(intent.outcome, "cannot_come");
  });
});
