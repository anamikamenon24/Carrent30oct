"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/server/auth";
import { checkLimit, clearLimit, clientIp, hitLimit } from "@/server/rate-limit";
import { safeNext } from "@/server/session";

export interface AuthFormState {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password" | "confirm", string>>;
  values?: { name?: string; email?: string };
}

const signInSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password"),
});

const signUpSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name").max(100),
    email: z.email("Enter a valid email address").trim().toLowerCase(),
    password: z.string().min(8, "Use at least 8 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

function fieldErrors(error: z.ZodError): AuthFormState["fieldErrors"] {
  const out: AuthFormState["fieldErrors"] = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof NonNullable<AuthFormState["fieldErrors"]>;
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// Failed sign-ins are limited per IP+email and per IP; sign-ups per IP. Counters live in Postgres.
const SIGN_IN_WINDOW = 15 * 60;
const SIGN_IN_MAX_PER_ACCOUNT = 5;
const SIGN_IN_MAX_PER_IP = 30;
const SIGN_UP_WINDOW = 60 * 60;
const SIGN_UP_MAX_PER_IP = 100;

function tooMany(seconds: number) {
  const mins = Math.ceil(seconds / 60);
  return `Too many attempts. Try again in ${seconds < 120 ? `${seconds} seconds` : `${mins} minutes`}.`;
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") };
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: { email: raw.email } };

  const ip = await clientIp();
  const accountKey = `action:sign-in:${ip}:${parsed.data.email}`;
  const ipKey = `action:sign-in:${ip}`;
  const [byAccount, byIp] = await Promise.all([
    checkLimit(accountKey, SIGN_IN_MAX_PER_ACCOUNT, SIGN_IN_WINDOW),
    checkLimit(ipKey, SIGN_IN_MAX_PER_IP, SIGN_IN_WINDOW),
  ]);
  if (!byAccount.allowed || !byIp.allowed) {
    return { error: tooMany(Math.max(byAccount.retryAfterSeconds, byIp.retryAfterSeconds)), values: { email: raw.email } };
  }

  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (err) {
    if (err instanceof APIError) {
      await Promise.all([hitLimit(accountKey, SIGN_IN_WINDOW), hitLimit(ipKey, SIGN_IN_WINDOW)]);
      return { error: "Incorrect email or password.", values: { email: raw.email } };
    }
    console.error(JSON.stringify({ level: "error", msg: "sign-in failed", err: String(err) }));
    return { error: "We couldn't sign you in right now. Please try again.", values: { email: raw.email } };
  }
  await clearLimit(accountKey);
  redirect(safeNext(formData.get("next"), "/"));
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  };
  const values = { name: raw.name, email: raw.email };
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const ipKey = `action:sign-up:${await clientIp()}`;
  const limit = await checkLimit(ipKey, SIGN_UP_MAX_PER_IP, SIGN_UP_WINDOW);
  if (!limit.allowed) return { error: tooMany(limit.retryAfterSeconds), values };
  await hitLimit(ipKey, SIGN_UP_WINDOW);

  try {
    await auth.api.signUpEmail({
      body: { name: parsed.data.name, email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (err) {
    if (err instanceof APIError) {
      const msg = String(err.body?.message ?? err.message ?? "");
      if (/exist/i.test(msg)) {
        return { fieldErrors: { email: "An account with this email already exists." }, values };
      }
      return { error: msg || "We couldn't create your account.", values };
    }
    console.error(JSON.stringify({ level: "error", msg: "sign-up failed", err: String(err) }));
    return { error: "We couldn't create your account right now. Please try again.", values };
  }
  redirect(safeNext(formData.get("next"), "/"));
}

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}
