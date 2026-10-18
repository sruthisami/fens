import photoData from './photos.json';
export interface Photo {
  file: string;
  alt: string;
  width: number;
  height: number;
  photographer: string;
  photographerUrl: string;
  photoUrl: string;
}
const photos: Record<string, Photo | undefined> = photoData;
export function getPhoto(key: string): Photo | undefined {
  return photos[key];
}
