import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getEnv } from "@/server/config";
import { db } from "@/server/db";
import { accounts, rateLimits, sessions, users, verifications } from "@/server/db/schema";

const env = getEnv();

/**
 * Better Auth (email + password). Sessions are database-backed cookies.
 * `role` is server-controlled (input: false), so users can't make themselves admins.
 */
export const auth = betterAuth({
  appName: "DriveEasy",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications, rateLimits },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "CUSTOMER", input: false },
      phone: { type: "string", required: false, input: true },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: env.NODE_ENV === "production",
  },
  // HTTP endpoints (/api/auth/*). Stored in Postgres so limits hold across serverless instances.
  // The form server actions use their own limiter (src/server/rate-limit.ts) on the same table.
  rateLimit: {
    enabled: env.NODE_ENV === "production",
    storage: "database",
    modelName: "rateLimits",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 10 },
    },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
