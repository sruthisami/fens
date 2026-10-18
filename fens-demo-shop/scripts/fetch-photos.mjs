import { mkdir, writeFile } from 'node:fs/promises';
const KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!KEY) {
  console.error('UNSPLASH_ACCESS_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
const API = 'https://api.unsplash.com';
const UTM = 'utm_source=fence_demo_shop&utm_medium=referral';
const headers = { Authorization: `Client-ID ${KEY}`, 'Accept-Version': 'v1' };
const SHOTS = [
  {
    key: 'hero',
    query: 'sneakers blue sky background',
    orientation: 'landscape',
    w: 1600,
    h: 1000,
  },
  {
    key: 'shoe-1',
    query: 'white sneaker pink background',
    orientation: 'portrait',
    w: 900,
    h: 1200,
  },
  {
    key: 'shoe-2',
    query: 'leather boots studio colorful background',
    orientation: 'portrait',
    w: 900,
    h: 1200,
  },
  { key: 'bag-1', query: 'tote bag colorful background', orientation: 'portrait', w: 900, h: 1200 },
  {
    key: 'bag-2',
    query: 'leather bag pastel background',
    orientation: 'portrait',
    w: 900,
    h: 1200,
  },
  { key: 'acc-1', query: 'knit scarf colorful', orientation: 'portrait', w: 900, h: 1200 },
  { key: 'acc-2', query: 'leather belt studio', orientation: 'portrait', w: 900, h: 1200 },
];
async function api(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Unsplash ${res.status} for ${url.split('?')[0]}: ${await res.text()}`);
  }
  console.log(`  rate limit remaining: ${res.headers.get('x-ratelimit-remaining')}`);
  return res.json();
}
const used = new Set();
const out = {};
await mkdir(new URL('../public/images/', import.meta.url), { recursive: true });
for (const shot of SHOTS) {
  const queries = [
    ...new Set([
      shot.query,
      shot.query
        .replace(/\b(studio|colorful|pastel|background)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      shot.query.split(' ').slice(0, 2).join(' '),
    ]),
  ];
  let photo;
  for (const query of queries) {
    console.log(`${shot.key}: "${query}"`);
    const params = new URLSearchParams({
      query,
      per_page: '20',
      orientation: shot.orientation,
      content_filter: 'high',
    });
    const { results } = await api(`${API}/search/photos?${params}`);
    photo = results.find((p) => !used.has(p.id));
    if (photo) break;
  }
  if (!photo) throw new Error(`No unused photo found for "${shot.query}" or its broader searches`);
  used.add(photo.id);
  await api(photo.links.download_location);
  const imageUrl = `${photo.urls.raw}&w=${shot.w}&h=${shot.h}&fit=crop&q=75&fm=jpg`;
  const image = await fetch(imageUrl);
  if (!image.ok) throw new Error(`Image download failed (${image.status}) for ${shot.key}`);
  await writeFile(
    new URL(`../public/images/${shot.key}.jpg`, import.meta.url),
    Buffer.from(await image.arrayBuffer()),
  );
  out[shot.key] = {
    file: `/images/${shot.key}.jpg`,
    alt: photo.alt_description ?? photo.description ?? shot.query,
    width: shot.w,
    height: shot.h,
    photographer: photo.user.name,
    photographerUrl: `${photo.user.links.html}?${UTM}`,
    photoUrl: `${photo.links.html}?${UTM}`,
  };
}
await writeFile(
  new URL('../src/data/photos.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`Done: ${SHOTS.length} photos in public/images, credits in src/data/photos.json`);
