import { env } from "../config.ts";
import { Classrooms, DayRecords, Guardians, type GuardianDoc, Meetings, type MeetingDoc } from "../models.ts";
import { localMinutes, parseHHmm, today } from "../time.ts";
import { checkCallTimeouts, meetingReminderText, startFlow } from "./calls.ts";
import { notifyConsole } from "./events.ts";
import { sendBulkSms } from "./sms.ts";

/**
 * Starts late-pickup calls for children still waiting after the class pickup
 * time (+ PICKUP_GRACE_MIN). `force` skips the clock check ("check now").
 */
export const checkLatePickups = async (now = new Date(), { force = false } = {}) => {
  const date = today(now);
  const minutes = localMinutes(now);
  let started = 0;

  for (const classroom of await Classrooms.find().lean()) {
    const pickup = parseHHmm(classroom.pickupTime);
    if (pickup === null) continue;
    if (!force && minutes < pickup + env.PICKUP_GRACE_MIN) continue;

    const waiting = await DayRecords.find({
      classroomId: classroom._id,
      date,
      attendance: { $in: ["present", "late"] },
      "pickup.status": "waiting",
    }).lean();

    for (const record of waiting) {
      try {
        await startFlow({ purpose: "late_pickup", studentId: record.studentId, date });
        started++;
      } catch (error) {
        console.warn("[scheduler] late pickup:", (error as Error).message);
      }
    }
  }
  if (started) notifyConsole("today", {});
  return started;
};

/** Sends meeting reminder SMS whose time has come. */
export const sendDueReminders = async (now = new Date()) => {
  const meetings = await Meetings.find({
    reminders: { $elemMatch: { at: { $lte: now }, sentAt: null } },
  }).lean<MeetingDoc[]>();

  let sent = 0;
  for (const meeting of meetings) {
    const due = meeting.reminders.filter((r) => r.at <= now && !r.sentAt);
    if (!due.length) continue;

    // Mark first so a slow gateway never sends the same reminder twice.
    for (const reminder of due) {
      await Meetings.updateOne(
        { _id: meeting._id },
        { $set: { "reminders.$[r].sentAt": now } },
        { arrayFilters: [{ "r._id": reminder._id }] },
      );
    }
    if (meeting.startsAt < now) continue;

    const guardians = await Guardians.find({ _id: { $in: meeting.guardianIds } }).lean<GuardianDoc[]>();
    await sendBulkSms(guardians, meetingReminderText(meeting), "meeting_reminder", { meetingId: meeting._id });
    sent += guardians.length;
  }
  if (sent) notifyConsole("meeting", {});
  return sent;
};

export const tick = async (now = new Date()) => {
  await checkCallTimeouts(now);
  if (env.AUTO_PICKUP_CALLS) await checkLatePickups(now);
  await sendDueReminders(now);
};

let timer: NodeJS.Timeout | undefined;
let running = false;

export const startScheduler = () => {
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (error) {
      console.error("[scheduler]", error);
    } finally {
      running = false;
    }
  }, env.SCHEDULER_INTERVAL_MS);
};

export const stopScheduler = () => clearInterval(timer);
