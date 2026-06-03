const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const index = trimmed.indexOf("=");
      if (index === -1) return acc;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      acc[key] = value;
      return acc;
    }, {});
}

const fileEnv = readDotEnv(envPath);
const config = {
  SUPABASE_URL: process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "https://ceqdjnljlfrybjyjqgse.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || fileEnv.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_YTOBM7PpJ5lq7rWBcby14Q_T1-PtSj6"
};

const output = `window.THINKCLOZE_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
const configPath = path.join(root, "config.js");
if (fs.existsSync(configPath) && fs.readFileSync(configPath, "utf8") === output) {
  console.log("config.js is already up to date.");
} else {
  fs.writeFileSync(configPath, output, "utf8");
  console.log("Generated config.js for Thinkcloze.");
}
