import type { Photo } from '../data/photos';
const UNSPLASH_URL = 'https://unsplash.com/?utm_source=fence_demo_shop&utm_medium=referral';
export function PhotoCredit({ photo }: { photo: Photo }) {
  return (
    <p className="photo-credit" data-component="PhotoCredit">
      Photo by{' '}
      <a href={photo.photographerUrl} target="_blank" rel="noreferrer">
        {photo.photographer}
      </a>{' '}
      on{' '}
      <a href={UNSPLASH_URL} target="_blank" rel="noreferrer">
        Unsplash
      </a>
    </p>
  );
}
