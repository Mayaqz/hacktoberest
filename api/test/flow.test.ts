import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

// Deterministic: no LLM, rule parser only. Uses TEST_MONGO_URL when set,
// otherwise an in-memory MongoDB (downloaded on first run).
process.env.LLM_ENABLED = "false";
process.env.AUTO_PICKUP_CALLS = "false";
// Test files run in parallel, so each gets its own database.
if (process.env.TEST_MONGO_URL) process.env.MONGO_URL = `${process.env.TEST_MONGO_URL}_flow`;

const { connectDb, disconnectDb } = await import("../src/db.ts");
const { seedDemo } = await import("../src/seed.ts");
const { Calls, DayRecords, Guardians, Meetings, SmsMessages, Students } = await import("../src/models.ts");
const calls = await import("../src/services/calls.ts");
const { checkLatePickups } = await import("../src/services/scheduler.ts");
const { markPickedUp } = await import("../src/services/school.ts");
const { today } = await import("../src/time.ts");

const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const studentId = async (firstName: string) => (await Students.findOne({ firstName }).lean())!._id;
const ringingFor = async (id: unknown) => Calls.findOne({ studentId: id, status: "ringing" }).lean();
const pickupOf = async (id: unknown) => (await DayRecords.findOne({ studentId: id, date: today() }).lean())!.pickup!;

describe("call flows", () => {
  before(async () => {
    await connectDb({ memory: !process.env.TEST_MONGO_URL });
  });
  after(async () => {
    await disconnectDb();
  });
  beforeEach(async () => {
    await seedDemo({ reset: true });
  });

  it("escalates to the next guardian, then records the reply", async () => {
    const bold = await studentId("Болд");
    await calls.startFlow({ purpose: "late_pickup", studentId: bold });
    assert.equal((await pickupOf(bold)).status, "contacting");

    const first = await ringingFor(bold);
    assert.equal(first?.attempt, 1);

    await calls.checkCallTimeouts(later(60));
    const second = await ringingFor(bold);
    assert.equal(second?.attempt, 2);
    assert.equal((await Calls.findById(first!._id).lean())?.status, "no_answer");

    await calls.answerCall(String(second!._id));
    const done = await calls.replyToCall(String(second!._id), { text: "Би чадахгүй, эмээ нь 10 минутын дараа авна" });
    assert.equal(done.status, "completed");
    assert.equal(done.intent?.outcome, "someone_else");

    const pickup = await pickupOf(bold);
    assert.equal(pickup.status, "someone_else");
    assert.equal(pickup.pickupPerson, "эмээ");
    assert.equal(pickup.etaMinutes, 10);
    assert.equal(await ringingFor(bold), null);
  });

  it("texts every guardian when nobody answers", async () => {
    const sarnai = await studentId("Сарнай");
    await calls.startFlow({ purpose: "late_pickup", studentId: sarnai });
    await calls.checkCallTimeouts(later(60));
    await calls.checkCallTimeouts(later(120));

    assert.equal((await pickupOf(sarnai)).status, "unreachable");
    const sms = await SmsMessages.find({ studentId: sarnai }).lean();
    assert.equal(sms.length, 2);
    assert.ok(sms.every((m) => m.status === "simulated" && m.text.includes("Сарнай")));
  });

  it("calls the next guardian when the first cannot come", async () => {
    const bold = await studentId("Болд");
    await calls.startFlow({ purpose: "late_pickup", studentId: bold });
    const first = await ringingFor(bold);
    await calls.answerCall(String(first!._id));
    await calls.replyToCall(String(first!._id), { text: "Өнөөдөр очиж чадахгүй" });

    const next = await ringingFor(bold);
    assert.equal(next?.attempt, 2);
    assert.equal((await pickupOf(bold)).status, "contacting");
  });

  it("stops calling once the child is picked up", async () => {
    const bold = await studentId("Болд");
    await calls.startFlow({ purpose: "late_pickup", studentId: bold });
    await markPickedUp(String(bold), "аав");
    assert.equal(await ringingFor(bold), null);
    assert.equal((await pickupOf(bold)).status, "picked_up");
  });

  it("starts late-pickup calls only for present children still waiting", async () => {
    const started = await checkLatePickups(new Date(), { force: true });
    assert.equal(started, 2); // Болд and Сарнай; the others are picked up, absent or unmarked
  });

  it("records an absence reason from the guardian", async () => {
    const nomin = await studentId("Номин");
    await calls.startFlow({ purpose: "absence", studentId: nomin });
    const call = await ringingFor(nomin);
    await calls.answerCall(String(call!._id));
    await calls.replyToCall(String(call!._id), { text: "Ханиад хүрээд гэртээ байгаа" });
    const record = await DayRecords.findOne({ studentId: nomin, date: today() }).lean();
    assert.equal(record?.attendance, "excused");
    assert.equal(record?.attendanceNote, "Өвчтэй");
  });

  it("reads SMS replies: 1 = attending, free text = pickup update", async () => {
    const meeting = await Meetings.findOne().lean();
    const guardian = await Guardians.findById(meeting!.guardianIds[0]).lean();
    const rsvp = await calls.handleInboundSms(guardian!.phone, "1");
    assert.equal(rsvp.matched && rsvp.kind, "meeting");
    const updated = await Meetings.findById(meeting!._id).lean();
    assert.equal(updated?.rsvps[0]?.response, "yes");

    const sarnai = await studentId("Сарнай");
    await calls.startFlow({ purpose: "late_pickup", studentId: sarnai });
    const mother = await Guardians.findOne({ phone: "99001201" }).lean();
    const reply = await calls.handleInboundSms(`+976${mother!.phone}`, "30 минутын дараа очно");
    assert.equal(reply.matched && reply.kind, "late_pickup");
    assert.equal((await pickupOf(sarnai)).status, "coming");
    assert.equal(await ringingFor(sarnai), null);
  });
});
