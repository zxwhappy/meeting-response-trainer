function decideUsage({ existingRequest, count, limit }) {
  const currentCount = Number.isFinite(count) ? count : 0;
  if (existingRequest) {
    return {
      allowed: false,
      charged: false,
      nextCount: currentCount,
      code: 'DUPLICATE_REQUEST'
    };
  }
  if (currentCount >= limit) {
    return {
      allowed: false,
      charged: false,
      nextCount: currentCount,
      code: 'DAILY_LIMIT'
    };
  }
  return {
    allowed: true,
    charged: true,
    nextCount: currentCount + 1,
    code: null
  };
}

module.exports = { decideUsage };
