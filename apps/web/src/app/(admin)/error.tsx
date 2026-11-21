"use client";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="hero compact">
      <h1>That didn't load.</h1>
      <p className="cap">The server may be restarting. Your data is safe.</p>
      <button className="btn" type="button" onClick={reset}>Try again</button>
    </section>
  );
}
