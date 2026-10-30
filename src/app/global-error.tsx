"use client";

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }} role="alert">
          <title>Something went wrong · DriveEasy</title>
          <h1>Something went wrong</h1>
          <p>DriveEasy is having trouble right now. Please try again.</p>
          <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", borderRadius: 8 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
