const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  fullyParallel: true,
  timeout: 60000,
  testDir: "tests/frontend",
  use: { headless: true, timezoneId: "Europe/Berlin", viewport: { width: 390, height: 1000 } },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  reporter: "list",
});
