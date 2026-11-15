async function processJob(job) {
  const {
    jobId,
    kind,
    adId,
    storyId,
    sourceUrl,
    folder,
    keepUserPoster,
    keepUserThumb,
  } = job;

  console.log(
    `🧵 [worker:${threadId}] job ${jobId} start kind=${kind} target=${adId || storyId}`
  );

  let tmpDir = null;
  let localPath = sourceUrl;

  try {
    if (/^https?:\/\//i.test(sourceUrl)) {
      const dl = await downloadToTemp(sourceUrl);
      tmpDir = dl.dir;
      localPath = dl.file;
    }

    const result = await processVideoFromFile(localPath, folder);

    const updates = {
      video: result.videoUrl || undefined,
      hlsUrl: result.hlsUrl || '',
      hlsStatus: result.hlsUrl ? 'ready' : 'failed',
      mediaType: 'video',
    };

    // Only overwrite poster if the user didn't supply one
    if (!keepUserPoster && result.posterUrl) {
      updates.image = result.posterUrl;
      updates.thumbnail = result.posterUrl;
    }

    // Only overwrite thumbSmall if the user didn't supply one
    if (!keepUserThumb) {
      const thumb = result.smallThumbUrl || result.posterUrl || '';
      if (thumb) updates.thumbnailSmall = thumb;
    }

    Object.keys(updates).forEach(
      (k) => updates[k] === undefined && delete updates[k]
    );

    await connectMongo();

    if (kind === 'ad') {
      await Ad.findByIdAndUpdate(adId, { $set: updates });
    } else if (kind === 'story') {
      await Story.findByIdAndUpdate(storyId, {
        $set: {
          media: result.videoUrl || undefined,
          hlsUrl: result.hlsUrl || '',
        },
      });
    }

    console.log(`🧵 [worker:${threadId}] job ${jobId} ✅ done`);

    return {
      ok: true,
      jobId,
      kind,
      adId,
      storyId,
      hlsUrl: result.hlsUrl,
      videoUrl: result.videoUrl,
      posterUrl: result.posterUrl,
      smallThumbUrl: result.smallThumbUrl,
    };
  } finally {
    if (tmpDir) {
      await fs.promises
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => {});
    }
  }
}