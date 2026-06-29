const { loadLocalEnv } = require("../loadEnv");
const { createApp } = require("../createApp");

loadLocalEnv();

module.exports = createApp();
