// services/hlsService.js
// FFmpeg → HLS (multi-bitrate) + MP4 fallback → upload to R2.
// Uses ffmpeg-static (bundled binary) so Render needs no system FFmpeg.
//
// ─── HD PIPELINE ───────────────────────────────────────────
// • MP4 fallback: 1080p, CRF 20 (sharp; plays before HLS is ready)
// • Poster:      1080p, q=2
// • HLS ladder:  240p / 360p / 720p / 1080p, scaled by HEIGHT
//                with -vf scale=-2:H so portrait stays portrait
// • Probe:       orientation-aware { width, height, isPortrait, shortSide }

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const {
  uploadStream,
  uploadBuffer,
  publicUrl,
} = require('../config/r2');

// ═════════════════════════════════════════════════════════════
// HLS LADDER
// Each profile scales by HEIGHT so portrait videos preserve
// their orientation. Width is computed as -2 (even, auto).
//
// ✅ 240p @ 300kbps is included so the FIRST SEGMENT downloaded
//    by an ABR player (ExoPlayer / AVPlayer) is ~80 KB instead of
//    ~2 MB. This cuts first-frame time from ~2400 ms to ~500 ms
//    on cold-cache plays, without affecting quality once the
//    player upgrades to 720p/1080p mid-stream.
// ═════════════════════════════════════════════════════════════
const HLS_BITRATE_PROFILES = [
  { name: '240p',  height: 240,  bitrate: '300k',  audio: '64k'  },
  { name: '360p',  height: 360,  bitrate: '800k',  audio: '96k'  },
  { name: '720p',  height: 720,  bitrate: '2500k', audio: '128k' },
  { name: '1080p', height: 1080, bitrate: '5000k', audio: '128k' },
];

// MP4 fallback — HD and sharp. This is the file that plays for
// the ~55s window after upload before HLS packaging completes.
const MP4_FALLBACK = {
  height: 1080,
  crf: 20,
  preset: 'fast',
  audio: '128k',
};

// Poster settings — 1080p, near-lossless JPEG quality
const POSTER = {
  height: 1080,
  quality: 2,
};

// ═════════════════════════════════════════════════════════════
// RUN FFMPEG
// ═════════════════════════════════════════════════════════════
const runFfmpeg = (args, label) =>
  new Promise((resolve, reject) => {
    console.log(`🎬 [hls:${label}] ffmpeg ${args.join(' ').slice(0, 200)}`);
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on('error', (e) => {
      console.error(`❌ [hls:${label}] spawn failed:`, e?.message);
      reject(e);
    });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ [hls:${label}] done`);
        resolve();
      } else {
        console.error(`❌ [hls:${label}] exit ${code}`);
        console.error(stderr.slice(-1500));
        reject(new Error(`ffmpeg ${label} exited ${code}`));
      }
    });
  });

// ═════════════════════════════════════════════════════════════
// DOWNLOAD A REMOTE URL TO A TEMP FILE
// ═════════════════════════════════════════════════════════════
const downloadToTemp = async (url, tmpDir, filename) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const filePath = path.join(tmpDir, filename);
  const arrayBuffer = await res.arrayBuffer();
  await fs.promises.writeFile(filePath, Buffer.from(arrayBuffer));
  return filePath;
};

// ═════════════════════════════════════════════════════════════
// ORIENTATION-AWARE PROBE
// Returns { width, height, isPortrait, shortSide, longSide }
// ═════════════════════════════════════════════════════════════
const probeVideo = (inputPath) =>
  new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-i', inputPath, '-hide_banner'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', () => {
      const m = stderr.match(/,\s(\d{2,4})x(\d{2,4})[\s,]/);
      if (!m) return reject(new Error('could not probe dimensions'));
      const w = parseInt(m[1], 10);
      const h = parseInt(m[2], 10);
      const isPortrait = h > w;
      resolve({
        width: w,
        height: h,
        isPortrait,
        shortSide: isPortrait ? w : h,
        longSide: isPortrait ? h : w,
      });
    });
    proc.on('error', reject);
  });

// ═════════════════════════════════════════════════════════════
// BUILD HLS ARGS
// Uses -vf:${i} scale=-2:${height} so portrait videos stay
// portrait (no 607x1080 letterboxing inside a 1920x1080 box).
// ═════════════════════════════════════════════════════════════
const buildHlsArgs = (inputPath, hlsDir, profiles) => {
  const hlsArgs = ['-y', '-i', inputPath];
  const filterParts = [];

  profiles.forEach((p, i) => {
    hlsArgs.push(
      '-map', '0:v:0',
      '-map', '0:a:0?',
      `-c:v:${i}`, 'libx264',
      `-b:v:${i}`, p.bitrate,
      `-vf:${i}`, `scale=-2:${p.height}`,
      `-c:a:${i}`, 'aac',
      `-b:a:${i}`, p.audio
    );
    filterParts.push(`v:${i},a:${i},name:${p.name}`);
  });

  hlsArgs.push(
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'mpegts',
    '-hls_flags', 'independent_segments',
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', filterParts.join(' '),
    '-hls_segment_filename', path.join(hlsDir, '%v_%03d.ts'),
    path.join(hlsDir, '%v.m3u8')
  );

  return hlsArgs;
};

// ═════════════════════════════════════════════════════════════
// UPLOAD AN HLS TREE (.m3u8 + .ts) TO R2
// ═════════════════════════════════════════════════════════════
const uploadHlsTree = async (hlsDir, baseKey) => {
  if (!fs.existsSync(path.join(hlsDir, 'master.m3u8'))) return '';
  const files = await fs.promises.readdir(hlsDir);
  for (const f of files) {
    const full = path.join(hlsDir, f);
    const stat = await fs.promises.stat(full);
    if (!stat.isFile()) continue;
    const stream = fs.createReadStream(full);
    const contentType = f.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : 'video/mp2t';
    await uploadStream(`${baseKey}-hls/${f}`, stream, contentType);
  }
  return publicUrl(`${baseKey}-hls/master.m3u8`);
};

// ═════════════════════════════════════════════════════════════
// CORE PIPELINE — takes a local file path
// Both `processVideo` (URL) and `processVideoFromFile` (buffer)
// route through here, so there is exactly one implementation.
// ═════════════════════════════════════════════════════════════
const processVideoFromLocalDirect = async (localPath, folder) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-'));
  const hlsDir = path.join(tmpDir, 'hls');
  const mp4Path = path.join(tmpDir, 'output.mp4');
  const posterPath = path.join(tmpDir, 'poster.jpg');
  const baseKey = `${folder}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  try {
    await fs.promises.mkdir(hlsDir, { recursive: true });

    // ── Probe dimensions (orientation-aware) ──
    const dims = await probeVideo(localPath).catch(() => ({
      width: 1080,
      height: 1920,
      isPortrait: true,
      shortSide: 1080,
      longSide: 1920,
    }));

    console.log(
      `📐 [hls] source: ${dims.width}x${dims.height} ` +
        `(${dims.isPortrait ? 'portrait' : 'landscape'}, short=${dims.shortSide})`
    );

    // For portrait, filter by SHORT side (width). For landscape, by height.
    // This is what makes a 1080x1920 source correctly include the 1080p profile.
    const sourceHeight = dims.isPortrait ? dims.shortSide : dims.height;
    const profiles = HLS_BITRATE_PROFILES.filter(
      (p) => p.height <= sourceHeight + 20
    );
    if (profiles.length === 0) profiles.push(HLS_BITRATE_PROFILES[0]);

    // ✅ Ensure the 240p fast-start profile is ALWAYS present, even
    // for very small sources. Otherwise a 240p-native video wouldn't
    // get the fast-start benefit for smaller uploads.
    const hasFastStart = profiles.some((p) => p.height <= 240);
    if (!hasFastStart) {
      profiles.unshift(HLS_BITRATE_PROFILES[0]);
    }

    console.log(`📐 [hls] profiles: ${profiles.map((p) => p.name).join(', ')}`);

    // ── Poster (1080p, q=2) ──
    await runFfmpeg(
      [
        '-y',
        '-ss', '00:00:00.5',
        '-i', localPath,
        '-frames:v', '1',
        '-vf', `scale=-2:${POSTER.height}`,
        '-q:v', String(POSTER.quality),
        posterPath,
      ],
      'poster'
    ).catch(() => {});

    // ── Progressive MP4 fallback (1080p, CRF 20 — sharp) ──
    await runFfmpeg(
      [
        '-y',
        '-i', localPath,
        '-c:v', 'libx264',
        '-preset', MP4_FALLBACK.preset,
        '-crf', String(MP4_FALLBACK.crf),
        '-vf', `scale=-2:${MP4_FALLBACK.height}`,
        '-c:a', 'aac',
        '-b:a', MP4_FALLBACK.audio,
        '-movflags', '+faststart',
        mp4Path,
      ],
      'mp4'
    );

    const videoKey = `${baseKey}-video.mp4`;
    const videoUrl = await uploadStream(
      videoKey,
      fs.createReadStream(mp4Path),
      'video/mp4'
    );

    let posterUrl = '';
    if (fs.existsSync(posterPath)) {
      const buf = await fs.promises.readFile(posterPath);
      posterUrl = await uploadBuffer(
        `${baseKey}-poster.jpg`,
        buf,
        'image/jpeg'
      );
    }

    // ── HLS ──
    let hlsUrl = '';
    try {
      const hlsArgs = buildHlsArgs(localPath, hlsDir, profiles);
      await runFfmpeg(hlsArgs, 'hls-local');
      hlsUrl = await uploadHlsTree(hlsDir, baseKey);
    } catch (e) {
      console.warn('⚠️ [hls-local] HLS failed, MP4-only:', e?.message);
    }

    return { hlsUrl, videoUrl, posterUrl };
  } finally {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
};

// ═════════════════════════════════════════════════════════════
// PROCESS A REMOTE URL (downloads first, then runs the core)
// ═════════════════════════════════════════════════════════════
const processVideo = async (sourceUrl, folder) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-'));
  try {
    console.log('📥 [hls] downloading source');
    const downloaded = await downloadToTemp(sourceUrl, tmpDir, 'input.mp4');
    return await processVideoFromLocalDirect(downloaded, folder);
  } finally {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
};

// ═════════════════════════════════════════════════════════════
// PUBLIC EXPORTS
// `processVideoFromFile` is what adController.js calls after
// writing the multer buffer to /tmp. It routes to the core.
// ═════════════════════════════════════════════════════════════
const processVideoFromFile = async (localPath, folder) => {
  return processVideoFromLocalDirect(localPath, folder);
};

module.exports = {
  processVideo,
  processVideoFromFile,
  processVideoFromUrl: processVideo,
};