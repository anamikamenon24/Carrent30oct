import { fileResponse, notFoundResponse } from "@/server/files";

// Vehicle photos are public marketing images stored under the "vehicles/" prefix only.
export async function GET(_req: Request, ctx: RouteContext<"/api/files/vehicles/[...key]">) {
  const { key } = await ctx.params;
  const path = ["vehicles", ...key].join("/");
  if (key.some((p) => p === ".." || p === "." || p === "")) return notFoundResponse();
  try {
    return await fileResponse(path, { cache: "public, max-age=3600" });
  } catch {
    return notFoundResponse();
  }
}
