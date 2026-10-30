/* eslint-disable @next/next/no-img-element -- photos come from private storage routes or arbitrary admin URLs */

const PALETTE: Record<string, string> = {
  white: "#e9ecec",
  black: "#2b2f31",
  silver: "#b8c0c4",
  grey: "#7d868b",
  gray: "#7d868b",
  red: "#c0392b",
  blue: "#2c5d9e",
  green: "#2f7a4f",
  beige: "#d8c3a0",
  brown: "#7a5236",
  yellow: "#e2b33a",
  orange: "#d9772b",
};

/** Resolves a stored vehicle photo reference to a URL the browser can load. */
export function vehiclePhotoUrl(ref: string): string {
  if (/^https?:\/\//.test(ref) || ref.startsWith("/")) return ref;
  return `/api/files/vehicles/${ref.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Vehicle cover image. Uses the first uploaded photo; otherwise draws a car silhouette in the
 * vehicle's colour so listings never show a broken image.
 */
export function VehicleVisual({
  photos,
  color,
  alt,
  className = "",
}: {
  photos: string[];
  color?: string | null;
  alt: string;
  className?: string;
}) {
  if (photos.length > 0) {
    return <img src={vehiclePhotoUrl(photos[0])} alt={alt} className={`h-full w-full object-cover ${className}`} loading="lazy" />;
  }
  const fill = PALETTE[(color ?? "").toLowerCase().split(/\s+/).pop() ?? ""] ?? "#4a8f86";
  return (
    <div className={`grid h-full w-full place-items-center bg-gradient-to-br from-sand-50 to-brand-50 ${className}`} role="img" aria-label={alt}>
      <svg viewBox="0 0 200 90" className="w-4/5 max-w-64 drop-shadow-md" aria-hidden>
        <path
          d="M18 62c0-8 4-12 12-14l26-6 20-16c4-3 9-5 14-5h40c6 0 11 2 15 6l16 15 16 3c8 2 13 7 13 15v6c0 3-2 5-5 5H23c-3 0-5-2-5-5z"
          fill={fill}
        />
        <path d="M80 28c3-2 6-3 10-3h17v19H64zM113 25h16c4 0 7 1 10 4l14 15h-40z" fill="#dbe9f0" opacity=".85" />
        <circle cx="55" cy="70" r="13" fill="#1f2427" />
        <circle cx="55" cy="70" r="6" fill="#9aa4a8" />
        <circle cx="150" cy="70" r="13" fill="#1f2427" />
        <circle cx="150" cy="70" r="6" fill="#9aa4a8" />
      </svg>
    </div>
  );
}
