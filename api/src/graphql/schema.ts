import type { GraphQLResolverMap } from "@apollo/subgraph";
import { GraphQLError } from "graphql";
import { gql } from "graphql-tag";
import { env, manifest } from "../config.ts";
import type { Context } from "../context.ts";
import { ATTENDANCE, type Attendance, Calls, type GuardianDoc, Guardians, PURPOSES, type Purpose, SmsMessages } from "../models.ts";
import { startFlow } from "../services/calls.ts";
import { llmStatus } from "../services/llm.ts";
import { checkLatePickups } from "../services/scheduler.ts";
import { dayView, markAttendance, markPickedUp } from "../services/school.ts";
import { sendBulkSms, smsStatus } from "../services/sms.ts";
import { speechStatus } from "../services/speech.ts";

// Every type and operation is prefixed with the plugin name: the gateway
// composes all plugins into one supergraph, so names must be unique across it.
export const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])

  type SubedeiStatus {
    plugin: String!
    version: String!
    subdomain: String!
    userId: String
    userEmail: String
    school: String!
    llmModel: String!
    llmReachable: Boolean!
    tts: String!
    stt: String!
    sms: String!
    erxesSync: Boolean!
  }

  type SubedeiGuardian {
    _id: String!
    name: String!
    relation: String!
    phone: String!
    canPickup: Boolean!
    erxesCustomerId: String
  }

  type SubedeiIntent {
    outcome: String!
    etaMinutes: Int
    pickupPerson: String
    reason: String
    summary: String
    engine: String
    model: String
  }

  type SubedeiCall {
    _id: String!
    purpose: String!
    status: String!
    attempt: Int!
    script: String!
    transcript: String
    ringingAt: String!
    endedAt: String
    studentId: String
    guardian: SubedeiGuardian
    intent: SubedeiIntent
  }

  type SubedeiPickup {
    status: String!
    etaMinutes: Int
    expectedAt: String
    pickupPerson: String
    note: String
    pickedUpAt: String
    pickedUpBy: String
  }

  type SubedeiStudentDay {
    studentId: String!
    firstName: String!
    lastName: String!
    attendance: String!
    attendanceNote: String
    pickup: SubedeiPickup!
    guardians: [SubedeiGuardian!]!
    lastCall: SubedeiCall
  }

  type SubedeiCounts {
    total: Int!
    present: Int!
    absent: Int!
    excused: Int!
    late: Int!
    unknown: Int!
    pickedUp: Int!
    waiting: Int!
    contacting: Int!
    coming: Int!
    unreachable: Int!
  }

  type SubedeiToday {
    date: String!
    classroomName: String
    pickupTime: String
    counts: SubedeiCounts!
    students: [SubedeiStudentDay!]!
  }

  type SubedeiSms {
    _id: String!
    phone: String!
    text: String!
    purpose: String!
    direction: String!
    status: String!
    createdAt: String!
  }

  type Query {
    subedeiStatus: SubedeiStatus!
    subedeiToday(date: String): SubedeiToday!
    subedeiCalls(limit: Int): [SubedeiCall!]!
    subedeiSmsMessages(limit: Int): [SubedeiSms!]!
  }

  type Mutation {
    subedeiMarkAttendance(studentId: String!, status: String!): Boolean!
    subedeiMarkPickedUp(studentId: String!, by: String): Boolean!
    subedeiCallGuardians(studentId: String!, purpose: String!): Boolean!
    subedeiCheckLatePickups: Int!
    subedeiSendSms(guardianIds: [String!]!, text: String!): Int!
  }
`;

// Inside erxes the gateway forwards the signed-in user; refuse anonymous
// access there. Standalone (no gateway) runs are trusted-local.
const requireUser = ({ user }: Context) => {
  if (env.ERXES_ENABLED && !user) {
    throw new GraphQLError("Login required", { extensions: { code: "UNAUTHENTICATED" } });
  }
};

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);
const clampLimit = (limit: number | null | undefined, max: number) => Math.min(Math.max(limit ?? 20, 1), max);

const guardianOut = (g: GuardianDoc) => ({
  _id: String(g._id),
  name: g.name,
  relation: g.relation ?? "",
  phone: g.phone,
  canPickup: g.canPickup ?? true,
  erxesCustomerId: g.erxesCustomerId ?? null,
});

type CallLike = {
  _id: unknown;
  purpose: string;
  status: string;
  attempt?: number | null;
  script: string;
  transcript?: string | null;
  ringingAt: Date;
  endedAt?: Date | null;
  studentId?: unknown;
  guardianId: unknown;
  intent?: Record<string, unknown> | null;
};

const callOut = (call: CallLike, guardians: Map<string, GuardianDoc>) => {
  const guardian = guardians.get(String(call.guardianId));
  return {
    _id: String(call._id),
    purpose: call.purpose,
    status: call.status,
    attempt: call.attempt ?? 1,
    script: call.script,
    transcript: call.transcript ?? null,
    ringingAt: call.ringingAt.toISOString(),
    endedAt: iso(call.endedAt),
    studentId: call.studentId ? String(call.studentId) : null,
    guardian: guardian ? guardianOut(guardian) : null,
    intent: call.intent ?? null,
  };
};

const ensureEnum = <T extends string>(values: readonly T[], value: string, label: string): T => {
  if (!values.includes(value as T)) throw new GraphQLError(`Invalid ${label}: ${value}`);
  return value as T;
};

export const resolvers: GraphQLResolverMap<Context> = {
  Query: {
    subedeiStatus: async (_parent, _args, { subdomain, user }) => {
      const llm = await llmStatus();
      const speech = speechStatus();
      return {
        plugin: manifest.name,
        version: manifest.version,
        subdomain,
        userId: user?._id ?? null,
        userEmail: user?.email ?? null,
        school: env.SCHOOL_NAME,
        llmModel: llm.model,
        llmReachable: llm.reachable && llm.modelFound,
        tts: speech.tts,
        stt: speech.stt,
        sms: smsStatus().provider,
        erxesSync: env.ERXES_ENABLED,
      };
    },

    subedeiToday: async (_parent, { date }: { date?: string | null }, context) => {
      requireUser(context);
      const view = await dayView(date ?? undefined);
      const guardians = new Map<string, GuardianDoc>();
      for (const row of view.rows) for (const g of row.guardians) guardians.set(String(g._id), g);
      const classroom = view.classrooms[0];
      return {
        date: view.date,
        classroomName: classroom?.name ?? null,
        pickupTime: classroom?.pickupTime ?? null,
        counts: view.counts,
        students: view.rows.map(({ student, guardians: list, record, lastCall }) => ({
          studentId: String(student._id),
          firstName: student.firstName,
          lastName: student.lastName ?? "",
          attendance: record.attendance,
          attendanceNote: record.attendanceNote || null,
          pickup: {
            status: record.pickup?.status ?? "waiting",
            etaMinutes: record.pickup?.etaMinutes ?? null,
            expectedAt: iso(record.pickup?.expectedAt),
            pickupPerson: record.pickup?.pickupPerson ?? null,
            note: record.pickup?.note ?? null,
            pickedUpAt: iso(record.pickup?.pickedUpAt),
            pickedUpBy: record.pickup?.pickedUpBy ?? null,
          },
          guardians: list.map(guardianOut),
          lastCall: lastCall ? callOut(lastCall, guardians) : null,
        })),
      };
    },

    subedeiCalls: async (_parent, { limit }: { limit?: number | null }, context) => {
      requireUser(context);
      const calls = await Calls.find().sort({ ringingAt: -1 }).limit(clampLimit(limit, 100)).lean();
      const guardians = new Map(
        (await Guardians.find({ _id: { $in: calls.map((c) => c.guardianId) } }).lean<GuardianDoc[]>()).map((g) => [String(g._id), g]),
      );
      return calls.map((call) => callOut(call, guardians));
    },

    subedeiSmsMessages: async (_parent, { limit }: { limit?: number | null }, context) => {
      requireUser(context);
      const messages = await SmsMessages.find().sort({ createdAt: -1 }).limit(clampLimit(limit, 200)).lean();
      return messages.map((m) => ({
        _id: String(m._id),
        phone: m.phone,
        text: m.text,
        purpose: m.purpose,
        direction: m.direction ?? "outbound",
        status: m.status,
        createdAt: iso(m.createdAt) ?? "",
      }));
    },
  },

  Mutation: {
    subedeiMarkAttendance: async (_parent, { studentId, status }: { studentId: string; status: string }, context) => {
      requireUser(context);
      await markAttendance(studentId, ensureEnum<Attendance>(ATTENDANCE, status, "status"));
      return true;
    },
    subedeiMarkPickedUp: async (_parent, { studentId, by }: { studentId: string; by?: string | null }, context) => {
      requireUser(context);
      await markPickedUp(studentId, by ?? undefined);
      return true;
    },
    subedeiCallGuardians: async (_parent, { studentId, purpose }: { studentId: string; purpose: string }, context) => {
      requireUser(context);
      await startFlow({ purpose: ensureEnum<Purpose>(PURPOSES, purpose, "purpose"), studentId });
      return true;
    },
    subedeiCheckLatePickups: async (_parent, _args, context) => {
      requireUser(context);
      return checkLatePickups(new Date(), { force: true });
    },
    subedeiSendSms: async (_parent, { guardianIds, text }: { guardianIds: string[]; text: string }, context) => {
      requireUser(context);
      if (!text.trim() || text.length > 600) throw new GraphQLError("SMS text must be 1-600 characters");
      const guardians = await Guardians.find({ _id: { $in: guardianIds.slice(0, 500) } }).lean<GuardianDoc[]>();
      const { results } = await sendBulkSms(guardians, text.trim());
      return results.filter((r) => r.status !== "failed").length;
    },
  },
};
