const MAX_AGE_MS = 60 * 60 * 1000;

async function cleanupExpiredEntries(entries, { nowMs = Date.now(), deleteFiles }) {
  const expired = (entries || []).filter((entry) => (
    Number.isFinite(entry.createdAtMs) && nowMs - entry.createdAtMs > MAX_AGE_MS
  ));
  const fileIDs = expired.map((entry) => entry.fileID).filter(Boolean);
  const result = {
    expiredIds: expired.map((entry) => entry._id),
    deletedFileIDs: [],
    failedFileIDs: []
  };
  if (fileIDs.length === 0) {
    return result;
  }
  for (const fileID of fileIDs) {
    try {
      await deleteFiles([fileID]);
      result.deletedFileIDs.push(fileID);
    } catch (_) {
      result.failedFileIDs.push(fileID);
    }
  }
  return result;
}

module.exports = { MAX_AGE_MS, cleanupExpiredEntries };
