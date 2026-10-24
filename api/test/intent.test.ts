import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractEtaMinutes, parseReplyRules, type ReplyContext } from "../src/services/intent.ts";
import { toLatin } from "../src/services/sms.ts";

const ctx = (purpose: ReplyContext["purpose"], guardianRelation = "ээж"): ReplyContext => ({
  purpose,
  studentName: "Болд",
  guardianRelation,
  nowTime: "17:10",
});

describe("extractEtaMinutes", () => {
  it("reads digits and Mongolian number words", () => {
    assert.equal(extractEtaMinutes("10 минутын дараа очно", "17:10"), 10);
    assert.equal(extractEtaMinutes("хорин тав минутын дараа", "17:10"), 25);
    assert.equal(extractEtaMinutes("арван минут", "17:10"), 10);
    assert.equal(extractEtaMinutes("хагас цагийн дараа", "17:10"), 30);
  });

  it("converts clock times to minutes from now", () => {
    assert.equal(extractEtaMinutes("17:40-д очно", "17:10"), 30);
    assert.equal(extractEtaMinutes("5:30-д очно", "17:10"), 20);
    assert.equal(extractEtaMinutes("6 цагт очно", "17:10"), 50);
  });

  it("returns undefined without a time", () => {
    assert.equal(extractEtaMinutes("очно", "17:10"), undefined);
  });
});

describe("parseReplyRules — late pickup", () => {
  it("detects the guardian coming", () => {
    const intent = parseReplyRules("Би одоо гарлаа, хорин минутын дараа очно", ctx("late_pickup"));
    assert.equal(intent.outcome, "coming");
    assert.equal(intent.etaMinutes, 20);
    assert.equal(intent.engine, "rules");
  });

  it("detects someone else picking up", () => {
    const intent = parseReplyRules("Би очиж чадахгүй, эмээ нь 15 минутын дараа авна", ctx("late_pickup"));
    assert.equal(intent.outcome, "someone_else");
    assert.equal(intent.pickupPerson, "эмээ");
    assert.equal(intent.etaMinutes, 15);
  });

  it("does not treat the caller's own relation as someone else", () => {
    const intent = parseReplyRules("Ээж нь удахгүй очно", ctx("late_pickup", "ээж"));
    assert.equal(intent.outcome, "coming");
  });

  it("detects that nobody can come", () => {
    assert.equal(parseReplyRules("Өнөөдөр очиж чадахгүй нээ", ctx("late_pickup")).outcome, "cannot_come");
  });

  it("detects an already picked-up child", () => {
    assert.equal(parseReplyRules("Аав нь аль хэдийн авчихсан", ctx("late_pickup")).outcome, "already_picked");
  });
});

describe("parseReplyRules — absence and meetings", () => {
  it("extracts an absence reason", () => {
    const intent = parseReplyRules("Хүүхэд маань халуураад гэртээ байгаа", ctx("absence"));
    assert.equal(intent.outcome, "absent_reason");
    assert.equal(intent.reason, "Өвчтэй");
  });

  it("detects a late arrival", () => {
    assert.equal(parseReplyRules("Хоцорч ирнэ, замдаа явж байна", ctx("absence")).outcome, "coming");
  });

  it("reads meeting RSVPs, negation first", () => {
    assert.equal(parseReplyRules("Ирнэ ээ", ctx("meeting")).outcome, "attending");
    assert.equal(parseReplyRules("Ирж чадахгүй", ctx("meeting")).outcome, "not_attending");
    assert.equal(parseReplyRules("ирэхгүй", ctx("meeting")).outcome, "not_attending");
  });
});

describe("toLatin", () => {
  it("transliterates Mongolian Cyrillic the way SMS users write it", () => {
    assert.equal(toLatin("Сайн байна уу"), "Sain baina uu");
    assert.equal(toLatin("Хүүхэд"), "Huuhed");
  });
});
