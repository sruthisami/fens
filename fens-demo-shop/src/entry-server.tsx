import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { Shell } from './Shell';
export function render(path: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={path}>
        <Shell />
      </StaticRouter>
    </StrictMode>,
  );
}
