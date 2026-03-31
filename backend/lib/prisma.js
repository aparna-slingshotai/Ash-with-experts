import pkg from "@prisma/client";
const { PrismaClient } = pkg;

// In-memory store for demo mode (no DATABASE_URL)
const memStore = {
  debriefs: new Map(),
  sessions: new Map(),
  messages: new Map(),
};

function makeId() {
  return crypto.randomUUID();
}

const memPrisma = {
  debrief: {
    create({ data }) {
      const id = makeId();
      const record = { id, ...data, createdAt: new Date(), completedAt: null };
      memStore.debriefs.set(id, record);
      return record;
    },
    findUnique({ where }) {
      return memStore.debriefs.get(where.id) || null;
    },
    update({ where, data }) {
      const existing = memStore.debriefs.get(where.id);
      if (!existing) throw new Error("Not found");
      const updated = { ...existing, ...data };
      memStore.debriefs.set(where.id, updated);
      return updated;
    },
    findMany({ orderBy, select } = {}) {
      return [...memStore.debriefs.values()].sort(
        (a, b) => b.createdAt - a.createdAt
      );
    },
  },
  session: {
    create({ data }) {
      const id = makeId();
      const record = { id, ...data, createdAt: new Date() };
      memStore.sessions.set(id, record);
      return record;
    },
    findUnique({ where, include } = {}) {
      const session = memStore.sessions.get(where.id);
      if (!session) return null;
      if (include?.messages) {
        session.messages = [...memStore.messages.values()]
          .filter((m) => m.sessionId === session.id)
          .sort((a, b) => a.createdAt - b.createdAt);
      }
      return session;
    },
    update({ where, data }) {
      const existing = memStore.sessions.get(where.id);
      if (!existing) throw new Error("Not found");
      const updated = { ...existing, ...data };
      memStore.sessions.set(where.id, updated);
      return updated;
    },
    findMany({ orderBy, select } = {}) {
      return [...memStore.sessions.values()].sort(
        (a, b) => b.recordedAt - a.recordedAt
      );
    },
  },
  threadMessage: {
    create({ data }) {
      const id = makeId();
      const record = { id, ...data, createdAt: new Date() };
      memStore.messages.set(id, record);
      return record;
    },
  },
};

const hasDB = !!process.env.DATABASE_URL;

export const prisma = hasDB ? new PrismaClient() : memPrisma;
