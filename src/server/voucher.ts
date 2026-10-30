import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { getEnv } from "@/server/config";

/**
 * Pick-up voucher QR codes carry `DRIVEEASY:<reference>:<reservationId>:<signature>`.
 * The HMAC (QR_SIGNING_SECRET) lets branch staff detect forged or edited codes.
 */
function sign(reference: string, reservationId: string): string {
  return createHmac("sha256", getEnv().QR_SIGNING_SECRET)
    .update(`${reference}:${reservationId}`)
    .digest("base64url")
    .slice(0, 22);
}

export function voucherPayload(reference: string, reservationId: string): string {
  return `DRIVEEASY:${reference}:${reservationId}:${sign(reference, reservationId)}`;
}

/** Returns the reservation id if the scanned payload is genuine, otherwise null. */
export function verifyVoucherPayload(payload: string): { reference: string; reservationId: string } | null {
  const parts = payload.trim().split(":");
  if (parts.length !== 4 || parts[0] !== "DRIVEEASY") return null;
  const [, reference, reservationId, sig] = parts;
  const expected = Buffer.from(sign(reference, reservationId));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { reference, reservationId };
}

export async function voucherQrDataUrl(reference: string, reservationId: string): Promise<string> {
  return QRCode.toDataURL(voucherPayload(reference, reservationId), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#0f1d1c", light: "#ffffff" },
  });
}
