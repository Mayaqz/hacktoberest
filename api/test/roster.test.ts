import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

// Uses TEST_MONGO_URL when set, otherwise an in-memory MongoDB.
process.env.LLM_ENABLED = "false";
// Test files run in parallel, so each gets its own database.
if (process.env.TEST_MONGO_URL) process.env.MONGO_URL = `${process.env.TEST_MONGO_URL}_roster`;

const { connectDb, disconnectDb } = await import("../src/db.ts");
const { Classrooms, DayRecords, Guardians, Students } = await import("../src/models.ts");
const roster = await import("../src/services/roster.ts");
const { dayView } = await import("../src/services/school.ts");

const guardianIds = async (studentId: unknown) =>
  ((await Students.findById(studentId).lean())?.guardianIds ?? []).map(String);

describe("normalizePhone", () => {
  it("accepts Mongolian numbers with spaces, dashes and +976", () => {
    assert.equal(roster.normalizePhone("9911 2233"), "99112233");
    assert.equal(roster.normalizePhone("+976 9911-2233"), "99112233");
    assert.equal(roster.normalizePhone("97699112233"), "99112233");
    assert.equal(roster.normalizePhone("+821012345678"), "+821012345678");
  });

  it("rejects malformed numbers", () => {
    assert.throws(() => roster.normalizePhone("1234"), /Утасны дугаар буруу/);
    assert.throws(() => roster.normalizePhone("9911223a"), /Утасны дугаар буруу/);
  });
});

describe("roster", () => {
  before(async () => {
    await connectDb({ memory: !process.env.TEST_MONGO_URL });
  });
  after(async () => {
    await disconnectDb();
  });
  beforeEach(async () => {
    await Promise.all([Classrooms.deleteMany({}), Students.deleteMany({}), Guardians.deleteMany({}), DayRecords.deleteMany({})]);
  });

  it("adds a student with guardians in call order and shows them today", async () => {
    const student = await roster.addStudent({
      firstName: "Тэмүүжин",
      lastName: "Б.",
      guardians: [
        { relation: "ээж", name: "Б. Солонго", phone: "9900 1111" },
        { relation: "аав", name: "Д. Бат", phone: "+97699002222" },
      ],
    });
    const phones = (await Guardians.find({ _id: { $in: student.guardianIds } }).lean()).map((g) => g.phone).sort();
    assert.deepEqual(phones, ["99001111", "99002222"]);

    const view = await dayView();
    assert.equal(view.rows.length, 1);
    assert.deepEqual(view.rows[0]!.guardians.map((g) => g.relation), ["ээж", "аав"]);
  });

  it("links siblings to the same guardian instead of duplicating", async () => {
    const a = await roster.addStudent({ firstName: "Ану", guardians: [{ relation: "ээж", name: "Сараа", phone: "99003333" }] });
    const b = await roster.addStudent({ firstName: "Тэмүүлэн", guardians: [{ relation: "ээж", name: "Сараа", phone: "9900-3333" }] });
    assert.equal(await Guardians.countDocuments(), 1);
    assert.deepEqual(await guardianIds(a._id), await guardianIds(b._id));
  });

  it("rejects a bad phone without writing anything", async () => {
    await assert.rejects(
      roster.addStudent({ firstName: "Номин", guardians: [{ relation: "ээж", name: "Х", phone: "12" }] }),
      /Утасны дугаар буруу/,
    );
    assert.equal(await Students.countDocuments(), 0);
  });

  it("adds, edits, reorders and removes guardians", async () => {
    const student = await roster.addStudent({ firstName: "Болд", guardians: [{ relation: "ээж", name: "Ээж", phone: "99004444" }] });
    const grandma = await roster.addGuardianToStudent(student._id, { relation: "эмээ", name: "Эмээ", phone: "99005555" });
    await assert.rejects(roster.addGuardianToStudent(student._id, { relation: "эмээ", name: "Эмээ", phone: "99005555" }), /аль хэдийн/);

    await roster.moveGuardian(student._id, grandma._id, "up");
    assert.equal((await guardianIds(student._id))[0], String(grandma._id));

    const edited = await roster.updateGuardian(grandma._id, { phone: "99 00 6666", canPickup: false });
    assert.equal(edited.phone, "99006666");
    assert.equal(edited.canPickup, false);
    const mother = await Guardians.findOne({ phone: "99004444" }).lean();
    await assert.rejects(roster.updateGuardian(grandma._id, { phone: mother!.phone }), /бүртгэлтэй/);

    await roster.removeGuardianFromStudent(student._id, grandma._id);
    assert.equal((await guardianIds(student._id)).length, 1);
    assert.equal(await Guardians.exists({ _id: grandma._id }), null);
  });

  it("deleting a student keeps guardians shared with a sibling", async () => {
    const a = await roster.addStudent({ firstName: "Ану", guardians: [{ relation: "ээж", name: "Сараа", phone: "99007777" }] });
    await roster.addStudent({ firstName: "Дэлгэр", guardians: [{ relation: "ээж", name: "Сараа", phone: "99007777" }] });
    await dayView();
    await roster.deleteStudent(a._id);
    assert.equal(await Guardians.countDocuments(), 1);
    assert.equal(await DayRecords.countDocuments({ studentId: a._id }), 0);
  });

  it("imports pasted Excel rows and reports bad lines", async () => {
    const text = [
      "Нэр\tОвог\tХэн\tАсран хамгаалагч\tУтас",
      "Болд\tГ.\tээж\tГ. Сарантуяа\t9900 1101",
      "Болд\tГ.\tаав\tБ. Ганбаатар\t99001102",
      "Сарнай, Э., ээж, Э. Энхтуяа, 99001201",
      "Мишээл\tА.\tаав\tА. Ууганбаяр\t123",
      "",
    ].join("\n");
    const result = await roster.importRoster(text);
    assert.equal(result.studentsCreated, 2);
    assert.equal(result.guardiansAdded, 3);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.line, 5);

    // Importing the same rows again adds nothing.
    const again = await roster.importRoster(text);
    assert.equal(again.studentsCreated, 0);
    assert.equal(again.guardiansAdded, 0);
  });

  it("clears the roster but keeps the class settings", async () => {
    await roster.addStudent({ firstName: "Болд", guardians: [{ relation: "ээж", name: "Ээж", phone: "99008888" }] });
    await roster.clearRoster();
    assert.equal(await Students.countDocuments(), 0);
    assert.equal(await Guardians.countDocuments(), 0);
    assert.equal(await Classrooms.countDocuments(), 1);
  });
});
