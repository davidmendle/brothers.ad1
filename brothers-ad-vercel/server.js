const { loadLocalEnv } = require("./loadEnv");
const { createApp } = require("./createApp");

loadLocalEnv();

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4174);
const app = createApp();

app.listen(port, host, () => {
  console.log(`Brothers OS available at http://${host}:${port}`);
});
