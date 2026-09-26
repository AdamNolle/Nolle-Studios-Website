import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildVariants, variantKeys } from './media.ts';
import type { Staging, Storage } from './media.ts';

const run = promisify(execFile);
const timeout = 15 * 60 * 1000;

async function command(executable: string, args: string[]) {
  try {
    return await run(executable, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === 'ENOENT') throw new Error('Video processing requires FFmpeg and FFprobe on the CMS host');
    throw new Error('Video processing failed: ' + String(failure.stderr || failure.message).slice(-900));
  }
}

interface Probe {
  streams?: { codec_type?: string; width?: number; height?: number }[];
  format?: { duration?: string };
}

export async function buildVideoVariants(inputPath: string, id: string, staging: Staging, storage: Storage) {
  const { stdout } = await command('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', inputPath,
  ]);
  const probe = JSON.parse(stdout) as Probe;
  const stream = probe.streams?.find(entry => entry.codec_type === 'video');
  const duration = Number(probe.format?.duration);
  if (!stream?.width || !stream.height || !Number.isFinite(duration) || duration <= 0 || duration > 60 * 60) {
    throw new Error('Upload a video shorter than one hour with a readable video track');
  }
  if (stream.width < 300 || stream.height < 300 || stream.width * stream.height > 80_000_000) {
    throw new Error('Video frame size must be at least 300 pixels on each side and under 80 megapixels');
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nolle-video-'));
  let poster: Awaited<ReturnType<typeof buildVariants>> | undefined;
  const videoKeys: string[] = [];
  try {
    const posterPath = path.join(temporary, 'poster.jpg');
    await command('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-i', inputPath,
      '-ss', String(Math.min(2, duration / 2)), '-map', '0:v:0', '-frames:v', '1',
      '-map_metadata', '-1', '-q:v', '3', posterPath]);
    poster = await buildVariants(posterPath, id, staging, storage);
    const threads = String(Math.max(2, Math.min(8, os.availableParallelism() - 1)));
    for (const [height, format, filename] of [[720, 'mp4', '720.mp4'], [1080, 'mp4', '1080.mp4'], [720, 'webm', '720.webm']] as const) {
      const output = path.join(temporary, filename);
      const widthLimit = height === 720 ? 1280 : 1920;
      const filter = `scale=${Math.min(widthLimit, stream.width)}:${Math.min(height, stream.height)}` +
        ':force_original_aspect_ratio=decrease:force_divisible_by=2';
      const args = ['-nostdin', '-y', '-v', 'error', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?',
        '-map_metadata', '-1', '-map_chapters', '-1', '-vf', filter, '-threads', threads];
      if (format === 'mp4') args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
      else args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
        '-c:a', 'libopus', '-b:a', '96k');
      args.push(output);
      await command('ffmpeg', args);
      const key = `videos/${id}/${filename}`;
      await staging.putFile(key, output);
      videoKeys.push(key);
    }
    return {
      width: poster.width, height: poster.height, duration: Math.round(duration * 10) / 10,
      assets: poster.assets,
      videoAssets: {
        mp4: storage.url(`videos/${id}/1080.mp4`),
        mp4_720: storage.url(`videos/${id}/720.mp4`),
        webm: storage.url(`videos/${id}/720.webm`),
      },
      keys: [...poster.keys, ...videoKeys],
    };
  } catch (error) {
    await Promise.allSettled([...(poster?.keys ?? variantKeys(id)), ...videoKeys].map(key => staging.delete(key)));
    throw error;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
