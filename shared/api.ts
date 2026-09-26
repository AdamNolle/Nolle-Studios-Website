// Shapes exchanged between the CMS server, the Content Room and the public
// site. The server builds them; both front ends only read them.

export type MediaKind = "image" | "video";

export interface MediaSizes {
  thumb?: string;
  mid?: string;
  full?: string;
  widths?: Record<string, string>;
}

export interface VideoAssets {
  mp4?: string;
  mp4_720?: string;
  webm?: string;
}

export interface PhotoDto {
  id: string;
  shootId: string | null;
  title: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
  sortOrder: number;
  published: boolean;
  approved: boolean;
  isCover: boolean;
  curated: boolean;
  kind: MediaKind;
  duration: number;
  video: VideoAssets;
  thumb: string;
  mid: string;
  full: string;
  formats: Record<string, MediaSizes>;
  createdAt: string;
  // Content Room only.
  liveAlt?: string;
  liveShootId?: string | null;
  liveSortOrder?: number;
  liveIsCover?: boolean;
  fileName?: string;
  altSuggestion?: string;
}

export interface ShootDto {
  id: string;
  title: string;
  slug: string;
  date: string;
  description: string;
  location: string;
  sortOrder: number;
  published: boolean;
  approved: boolean;
  curated: boolean;
  coverUrl: string;
  photos: PhotoDto[];
  liveTitle?: string;
  liveSlug?: string;
  liveDate?: string;
  liveDescription?: string;
  liveLocation?: string;
  liveSortOrder?: number;
}

export interface CollectionDto {
  id: string;
  title: string;
  slug: string;
  description: string;
  sortOrder: number;
  published: boolean;
  approved: boolean;
  photoIds: string[];
  photos: PhotoDto[];
  coverUrl: string;
  liveTitle?: string;
  liveSlug?: string;
  liveDescription?: string;
  liveSortOrder?: number;
  livePhotoIds?: string[];
}

export interface PublishRecord {
  id: string;
  createdAt: string;
  changes: number;
  added: number;
  removed: number;
  note: string;
}

export interface PublicCatalog {
  shoots: ShootDto[];
  collections: CollectionDto[];
}

export interface AdminContent extends PublicCatalog {
  photos: PhotoDto[];
  history: PublishRecord[];
}

export interface AdminConfig {
  siteUrl: string;
  /** Whether a local vision model is set up, and whether it drafts alt text after uploads. */
  altText: { configured: boolean; auto: boolean };
}

export interface AltTextStatus {
  available: boolean;
  model: string;
}
