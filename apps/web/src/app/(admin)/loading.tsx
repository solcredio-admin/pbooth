// Shaped like a real admin page (compact hero, then a glass section) so nothing jumps when it swaps in.
export default function Loading() {
  return (
    <>
      <section className="hero compact" aria-hidden="true">
        <span className="sk sk-cap" />
        <span className="sk sk-title" />
      </section>
      <main aria-busy="true" aria-label="Loading">
        <section className="host">
          <div className="host-head">
            <span className="sk sk-cap" />
            <span className="sk sk-h2" />
          </div>
          <div className="panel sk-panel">
            <span className="sk sk-row" />
            <span className="sk sk-row" />
            <span className="sk sk-row" />
          </div>
        </section>
      </main>
    </>
  );
}
