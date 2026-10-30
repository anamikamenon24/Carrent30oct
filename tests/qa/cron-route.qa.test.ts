import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/[job]/route";

// Brief: "Protect scheduled cleanup endpoints" / "protect the route with CRON_SECRET".
const call = (job: string, auth?: string) =>
  GET(
    new NextRequest(`http://localhost/api/cron/${job}`, { headers: auth ? { authorization: auth } : {} }),
    { params: Promise.resolve({ job }) } as never,
  );

describe("GET /api/cron/[job]", () => {
  it("rejects requests without the cron secret", async () => {
    expect((await call("release-expired-holds")).status).toBe(401);
  });

  it("rejects a wrong secret and a secret without the Bearer prefix", async () => {
    expect((await call("release-expired-holds", "Bearer nope")).status).toBe(401);
    expect((await call("release-expired-holds", process.env.CRON_SECRET)).status).toBe(401);
  });

  it("returns 404 for an unknown job even with the right secret", async () => {
    expect((await call("drop-everything", `Bearer ${process.env.CRON_SECRET}`)).status).toBe(404);
  });

  it("runs release-expired-holds with the right secret and is safe to repeat", async () => {
    const auth = `Bearer ${process.env.CRON_SECRET}`;
    const first = await call("release-expired-holds", auth);
    expect(first.status).toBe(200);
    expect(await first.json()).toHaveProperty("released");
    const second = await call("release-expired-holds", auth);
    expect(await second.json()).toMatchObject({ released: 0 });
  });
});
