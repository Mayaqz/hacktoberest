import {
  CallFlows,
  Calls,
  Classrooms,
  DayRecords,
  Guardians,
  Meetings,
  SmsMessages,
  Students,
} from "./models.ts";
import { today } from "./time.ts";

type SeedGuardian = { name: string; relation: string; phone: string; canPickup?: boolean };
type SeedStudent = {
  firstName: string;
  lastName: string;
  attendance: "present" | "absent" | "unknown";
  pickedUp?: boolean;
  guardians: SeedGuardian[];
};

// Demo class. Phone numbers are fictional.
const STUDENTS: SeedStudent[] = [
  {
    firstName: "Болд",
    lastName: "Г.",
    attendance: "present",
    guardians: [
      { name: "Г. Сарантуяа", relation: "ээж", phone: "99001101" },
      { name: "Б. Ганбаатар", relation: "аав", phone: "99001102" },
      { name: "Д. Должин", relation: "эмээ", phone: "99001103" },
    ],
  },
  {
    firstName: "Сарнай",
    lastName: "Э.",
    attendance: "present",
    guardians: [
      { name: "Э. Энхтуяа", relation: "ээж", phone: "99001201" },
      { name: "Т. Эрдэнэ", relation: "аав", phone: "99001202" },
    ],
  },
  {
    firstName: "Тэмүүлэн",
    lastName: "О.",
    attendance: "present",
    pickedUp: true,
    guardians: [
      { name: "О. Нарантуяа", relation: "ээж", phone: "99001301" },
      { name: "С. Отгонбаяр", relation: "аав", phone: "99001302" },
    ],
  },
  {
    firstName: "Анужин",
    lastName: "Б.",
    attendance: "present",
    pickedUp: true,
    guardians: [{ name: "Б. Мөнхзул", relation: "ээж", phone: "99001401" }],
  },
  {
    firstName: "Билгүүн",
    lastName: "Ц.",
    attendance: "present",
    pickedUp: true,
    guardians: [
      { name: "Ц. Батцэцэг", relation: "ээж", phone: "99001501" },
      { name: "Н. Цогтбаяр", relation: "аав", phone: "99001502" },
    ],
  },
  {
    firstName: "Номин",
    lastName: "Л.",
    attendance: "absent",
    guardians: [
      { name: "Л. Алтанцэцэг", relation: "ээж", phone: "99001601" },
      { name: "Ж. Лхагвасүрэн", relation: "аав", phone: "99001602" },
    ],
  },
  {
    firstName: "Төгөлдөр",
    lastName: "М.",
    attendance: "unknown",
    guardians: [
      { name: "М. Оюунаа", relation: "ээж", phone: "99001701" },
      { name: "П. Мөнх-Эрдэнэ", relation: "аав", phone: "99001702" },
    ],
  },
  {
    firstName: "Мишээл",
    lastName: "А.",
    attendance: "unknown",
    guardians: [
      { name: "А. Ууганбаяр", relation: "аав", phone: "99001801" },
      { name: "Х. Цэцгээ", relation: "эмээ", phone: "99001802" },
    ],
  },
];

export const clearAll = async () => {
  await Promise.all([
    Classrooms.deleteMany({}),
    Guardians.deleteMany({}),
    Students.deleteMany({}),
    DayRecords.deleteMany({}),
    CallFlows.deleteMany({}),
    Calls.deleteMany({}),
    SmsMessages.deleteMany({}),
    Meetings.deleteMany({}),
  ]);
};

export const seedDemo = async ({ reset = true } = {}) => {
  if (reset) await clearAll();
  else if (await Classrooms.countDocuments()) return { seeded: false };

  const classroom = await Classrooms.create({
    name: "2б",
    teacherName: "Д. Оюунчимэг",
    teacherPhone: "99112233",
    classStartTime: "08:00",
    pickupTime: "17:00",
  });

  const date = today();
  const primaryGuardianIds = [];

  for (const s of STUDENTS) {
    const guardians = await Guardians.insertMany(s.guardians);
    primaryGuardianIds.push(guardians[0]!._id);
    const student = await Students.create({
      firstName: s.firstName,
      lastName: s.lastName,
      classroomId: classroom._id,
      guardianIds: guardians.map((g) => g._id),
    });
    await DayRecords.create({
      studentId: student._id,
      classroomId: classroom._id,
      date,
      attendance: s.attendance,
      markedAt: s.attendance === "unknown" ? undefined : new Date(),
      pickup: s.pickedUp
        ? { status: "picked_up", pickedUpAt: new Date(), pickedUpBy: guardians[0]!.relation }
        : { status: "waiting" },
    });
  }

  const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(10, 0, 0, 0); // 18:00 in Ulaanbaatar (UTC+8)
  await Meetings.create({
    title: "Эцэг эхийн хурал",
    startsAt,
    location: "2б анги (204 тоот)",
    note: "Улирлын дүн, сурагчдын ахиц",
    classroomId: classroom._id,
    guardianIds: primaryGuardianIds,
    reminders: [
      { at: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000), label: "1 өдрийн өмнө" },
      { at: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000), label: "2 цагийн өмнө" },
    ],
  });

  return { seeded: true, students: STUDENTS.length };
};
