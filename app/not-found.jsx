export default function NotFound() {
  return (
    <main className="page-shell">
      <section>
        <div className="wrap legal">
          <p className="eyebrow">404</p>
          <h1 className="page-title">Page Not Found</h1>
          <p>The page you are looking for is not available.</p>
          <a className="btn primary" href="/">
            Back to Home
          </a>
        </div>
      </section>
    </main>
  );
}
