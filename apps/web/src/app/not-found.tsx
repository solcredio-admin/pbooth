import Link from "next/link";

export default function NotFound() {
  return (
    <section className="hero">
      <h1>Nothing here.</h1>
      <Link className="btn ghost" href="/dashboard">Back to the dashboard</Link>
    </section>
  );
}
