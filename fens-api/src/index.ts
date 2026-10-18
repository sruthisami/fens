import { createApp } from './app.js';
const PORT = 4000;
createApp().listen(PORT, () => {
  console.log(`fens-api listening on http://localhost:${PORT}`);
});
