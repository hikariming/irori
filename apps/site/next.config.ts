import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const siteDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(siteDir, "../..")
};

export default nextConfig;
