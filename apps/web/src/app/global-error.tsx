"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <section className="hero">
          <h1>Something went wrong.</h1>
          <button className="btn" type="button" onClick={reset}>Try again</button>
        </section>
      </body>
    </html>
  );
}
