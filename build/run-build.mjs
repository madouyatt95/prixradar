import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const target = process.env.VERCEL === "1" ? "build:vercel" : "build:cloudflare";
const result = spawnSync(command, ["run", target], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
