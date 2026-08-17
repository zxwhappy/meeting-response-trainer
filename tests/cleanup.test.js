const test = require('node:test');
const assert = require('node:assert/strict');

let subject = {};
try {
  subject = require('../cloudfunctions/cleanupTempAudio/lib/cleanup');
} catch (_) {}

test('deletes only temporary audio entries older than one hour', async () => {
  assert.equal(typeof subject.cleanupExpiredEntries, 'function');
  const now = Date.parse('2026-08-17T10:00:00.000Z');
  const deleted = [];
  const result = await subject.cleanupExpiredEntries(
    [
      { _id: 'old', fileID: 'cloud://old.mp3', createdAtMs: now - 3600001 },
      { _id: 'new', fileID: 'cloud://new.mp3', createdAtMs: now - 3599999 }
    ],
    {
      nowMs: now,
      deleteFiles: async (fileIDs) => deleted.push(...fileIDs)
    }
  );
  assert.deepEqual(deleted, ['cloud://old.mp3']);
  assert.deepEqual(result, {
    expiredIds: ['old'],
    deletedFileIDs: ['cloud://old.mp3'],
    failedFileIDs: []
  });
});

test('reports deletion failures without losing the expired entry ids', async () => {
  assert.equal(typeof subject.cleanupExpiredEntries, 'function');
  const now = Date.parse('2026-08-17T10:00:00.000Z');
  const result = await subject.cleanupExpiredEntries(
    [{ _id: 'old', fileID: 'cloud://old.mp3', createdAtMs: now - 7200000 }],
    {
      nowMs: now,
      deleteFiles: async () => {
        throw new Error('cloud deletion failed');
      }
    }
  );
  assert.deepEqual(result, {
    expiredIds: ['old'],
    deletedFileIDs: [],
    failedFileIDs: ['cloud://old.mp3']
  });
});

test('keeps only the failed file when a cleanup batch partially succeeds', async () => {
  assert.equal(typeof subject.cleanupExpiredEntries, 'function');
  const now = Date.parse('2026-08-17T10:00:00.000Z');
  const result = await subject.cleanupExpiredEntries(
    [
      { _id: 'good', fileID: 'cloud://good.mp3', createdAtMs: now - 7200000 },
      { _id: 'bad', fileID: 'cloud://bad.mp3', createdAtMs: now - 7200000 }
    ],
    {
      nowMs: now,
      deleteFiles: async (fileIDs) => {
        if (fileIDs.includes('cloud://bad.mp3')) throw new Error('one failed');
      }
    }
  );
  assert.deepEqual(result, {
    expiredIds: ['good', 'bad'],
    deletedFileIDs: ['cloud://good.mp3'],
    failedFileIDs: ['cloud://bad.mp3']
  });
});
