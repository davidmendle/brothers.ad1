const { loadLocalEnv } = require("../../loadEnv");
const { createApp } = require("../../createApp");

loadLocalEnv();

const app = createApp();

module.exports = function handler(request, response) {
  return app(request, response);
};

module.exports.config = {
  api: {
    bodyParser: false,
    externalResolver: true
  }
};
