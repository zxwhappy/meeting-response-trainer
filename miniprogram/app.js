const config = require('./config/env');

App({
  globalData: {
    config,
    cloudReady: false
  },

  onLaunch() {
    if (!wx.cloud) {
      return;
    }
    const options = { traceUser: false };
    if (config.cloudEnvId) {
      options.env = config.cloudEnvId;
    }
    wx.cloud.init(options);
    this.globalData.cloudReady = true;
  }
});
