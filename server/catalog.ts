import type { CollectionRow, Db, PhotoRow, ShootRow } from './db.ts';
import type { AdminContent, CollectionDto, PhotoDto, PublicCatalog, PublishRecord, ShootDto } from '../shared/api.ts';

// Rows keep two copies of every editable field: the working copy the Content
// Room edits, and the live_* copy the last Publish released. The public
// catalog reads only the live copy.

const parse = <T>(json: string | null | undefined, fallback: T): T => {
  try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; }
};

function photoDto(row: PhotoRow, publicOnly = false): PhotoDto {
  const assets = parse<{ thumb?: string; mid?: string; full?: string; formats?: PhotoDto['formats'] }>(row.assets_json, {});
  return {
    id: row.id, shootId: publicOnly ? row.live_shoot_id : row.shoot_id,
    title: publicOnly ? '' : row.title,
    alt: (publicOnly ? row.live_alt : row.alt) ?? '', caption: publicOnly ? '' : row.caption,
    width: row.width, height: row.height,
    sortOrder: (publicOnly ? row.live_sort_order : row.sort_order) ?? 0,
    published: !!row.published, approved: !!row.approved,
    isCover: !!(publicOnly ? row.live_is_cover : row.is_cover),
    ...(!publicOnly ? {
      liveAlt: row.live_alt ?? '', liveShootId: row.live_shoot_id, liveSortOrder: row.live_sort_order ?? 0,
      liveIsCover: !!row.live_is_cover, fileName: row.file_name ?? '', altSuggestion: row.alt_suggestion ?? '',
    } : {}),
    curated: !row.storage_prefix, kind: row.kind === 'video' ? 'video' : 'image', duration: row.duration || 0,
    video: parse(row.video_assets_json, {}),
    thumb: assets.thumb ?? '', mid: assets.mid ?? '', full: assets.full ?? '',
    formats: assets.formats ?? {}, createdAt: row.created_at,
  };
}

function shootDto(row: ShootRow, publicOnly: boolean): Omit<ShootDto, 'photos' | 'curated' | 'coverUrl'> {
  const live = publicOnly;
  return {
    id: row.id,
    title: (live ? row.live_title : row.title) ?? '',
    slug: (live ? row.live_slug : row.slug) ?? '',
    date: (live ? row.live_shot_date : row.shot_date) ?? '',
    description: (live ? row.live_description : row.description) ?? '',
    location: (live ? row.live_location : row.location) ?? '',
    sortOrder: (live ? row.live_sort_order : row.sort_order) ?? 0,
    published: !!row.published, approved: !!row.approved,
    ...(!live ? {
      liveTitle: row.live_title ?? '', liveSlug: row.live_slug ?? '', liveDate: row.live_shot_date ?? '',
      liveDescription: row.live_description ?? '', liveLocation: row.live_location ?? '', liveSortOrder: row.live_sort_order ?? 0,
    } : {}),
  };
}

function collectionDto(row: CollectionRow, publicOnly: boolean): Omit<CollectionDto, 'photoIds' | 'photos' | 'coverUrl'> {
  const live = publicOnly;
  return {
    id: row.id,
    title: (live ? row.live_title : row.title) ?? '',
    slug: (live ? row.live_slug : row.slug) ?? '',
    description: (live ? row.live_description : row.description) ?? '',
    sortOrder: (live ? row.live_sort_order : row.sort_order) ?? 0,
    published: !!row.published, approved: !!row.approved,
    ...(!live ? {
      liveTitle: row.live_title ?? '', liveSlug: row.live_slug ?? '', liveDescription: row.live_description ?? '',
      liveSortOrder: row.live_sort_order ?? 0, livePhotoIds: parse<string[]>(row.live_photo_ids_json, []),
    } : {}),
  };
}

export async function getContent(db: Db, publicOnly: true): Promise<PublicCatalog>;
export async function getContent(db: Db, publicOnly: false): Promise<AdminContent>;
export async function getContent(db: Db, publicOnly: boolean): Promise<PublicCatalog | AdminContent> {
  const filter = publicOnly ? 'WHERE published = 1' : '';
  const order = publicOnly ? 'live_sort_order' : 'sort_order';
  const [shootRows, photoRows, collectionRows, linkRows, manifestRows] = await Promise.all([
    db.query<ShootRow>(`SELECT * FROM shoots ${filter} ORDER BY ${order} ASC, created_at DESC`),
    db.query<PhotoRow>(publicOnly
      ? `SELECT photos.* FROM photos JOIN shoots ON shoots.id = photos.live_shoot_id
         WHERE photos.published = 1 AND shoots.published = 1
         ORDER BY photos.live_sort_order ASC, photos.created_at ASC`
      : 'SELECT * FROM photos ORDER BY sort_order ASC, created_at ASC'),
    db.query<CollectionRow>(`SELECT * FROM collections ${filter} ORDER BY ${order} ASC, created_at DESC`),
    db.query<{ collection_id: string; photo_id: string }>('SELECT collection_id, photo_id FROM collection_photos ORDER BY sort_order ASC'),
    db.query<{ shoot_id: string }>('SELECT shoot_id FROM manifest_shoots'),
  ]);
  const manifestShootIds = new Set(manifestRows.map(row => row.shoot_id));
  const photos = photoRows.map(row => photoDto(row, publicOnly));
  const byId = new Map(photos.map(photo => [photo.id, photo]));
  const byShoot = new Map<string, PhotoDto[]>();
  for (const photo of photos) {
    if (!photo.shootId) continue;
    const list = byShoot.get(photo.shootId);
    if (list) list.push(photo); else byShoot.set(photo.shootId, [photo]);
  }
  const shoots: ShootDto[] = shootRows.map(row => {
    const shootPhotos = byShoot.get(row.id) ?? [];
    const cover = shootPhotos.find(photo => photo.isCover) ?? shootPhotos[0];
    return {
      ...shootDto(row, publicOnly),
      photos: shootPhotos,
      curated: manifestShootIds.has(row.id) || shootPhotos.some(photo => photo.curated),
      coverUrl: !publicOnly && cover && !cover.published ? `/api/admin/photos/${cover.id}/preview` : cover?.mid ?? '',
    };
  });
  const links = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = links.get(link.collection_id);
    if (list) list.push(link.photo_id); else links.set(link.collection_id, [link.photo_id]);
  }
  const collections: CollectionDto[] = collectionRows.map(row => {
    const photoIds = (publicOnly ? parse<string[]>(row.live_photo_ids_json, []) : links.get(row.id) ?? []).filter(id => byId.has(id));
    const members = photoIds.map(id => byId.get(id)!);
    return { ...collectionDto(row, publicOnly), photoIds, photos: members, coverUrl: members[0]?.mid ?? '' };
  });
  if (publicOnly) return { shoots, collections };
  const history = (await db.query<Record<string, string | number>>('SELECT * FROM publish_log ORDER BY created_at DESC LIMIT 12'))
    .map((row): PublishRecord => ({
      id: String(row.id), createdAt: String(row.created_at), changes: Number(row.changes),
      added: Number(row.added), removed: Number(row.removed), note: String(row.note),
    }));
  return { shoots, photos, collections, history };
}

/** The Content Room's private preview: working copies, with staged media behind the session. */
export async function getPreviewContent(db: Db): Promise<PublicCatalog> {
  const content = await getContent(db, false);
  return {
    collections: [],
    shoots: content.shoots.map(shoot => {
      const photos = shoot.photos.map(photo => {
        if (photo.curated) return photo;
        const image = `/api/admin/photos/${encodeURIComponent(photo.id)}/preview`;
        return {
          ...photo, thumb: image, mid: `${image}?width=1600`, full: `${image}?width=3200`, formats: {},
          video: photo.kind === 'video' ? { mp4: `/api/admin/videos/${encodeURIComponent(photo.id)}/preview` } : {},
        };
      });
      return { ...shoot, photos, coverUrl: (photos.find(photo => photo.isCover) ?? photos[0])?.mid ?? '' };
    }),
  };
}
