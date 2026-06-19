import type { NextConfig } from "next"

const isPages = process.env.GITHUB_PAGES === "true"
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  basePath: isPages && basePath ? basePath : undefined,
  assetPrefix: isPages && basePath ? `${basePath}/` : undefined,
}

export default nextConfig
