const app = require("./src/app");
const config = require("./src/config/env");

require("./src/db/redis");

app.listen(config.port, () => {
  console.log(`🚀 Server running on port ${config.port}`);
});