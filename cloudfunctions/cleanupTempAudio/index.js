const cloud = require('wx-server-sdk');
const { cleanupExpiredEntries, MAX_AGE_MS } = require('./lib/cleanup');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const cutoff = Date.now() - MAX_AGE_MS;
  const response = await db.collection('temp_audio_files')
    .where({ createdAtMs: db.command.lt(cutoff) })
    .limit(100)
    .get();
  const result = await cleanupExpiredEntries(response.data, {
    nowMs: Date.now(),
    deleteFiles: async (fileIDs) => {
      const deletion = await cloud.deleteFile({ fileList: fileIDs });
      const failed = (deletion.fileList || []).filter((item) => item.status !== 0);
      if (failed.length) throw new Error(`Failed to delete ${failed.length} temp files`);
    }
  });

  await Promise.all(result.deletedFileIDs.map((fileID) => {
    const entry = response.data.find((item) => item.fileID === fileID);
    return entry
      ? db.collection('temp_audio_files').doc(entry._id).remove().catch(() => {})
      : Promise.resolve();
  }));
  await Promise.all(result.failedFileIDs.map((fileID) => {
    const entry = response.data.find((item) => item.fileID === fileID);
    return entry
      ? db.collection('temp_audio_files').doc(entry._id).update({
        data: {
          cleanupAttempts: db.command.inc(1),
          lastCleanupErrorAt: db.serverDate()
        }
      }).catch(() => {})
      : Promise.resolve();
  }));

  console.log('temporary audio cleanup', {
    expired: result.expiredIds.length,
    deleted: result.deletedFileIDs.length,
    failed: result.failedFileIDs.length
  });
  return result;
};
