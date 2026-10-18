import { Link } from 'react-router-dom';
export function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <p>We could not find that page.</p>
      <Link to="/">Back to home</Link>
    </section>
  );
}
