import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Docker用の設定（standalone出力を有効化）
  output: 'standalone',
};

export default nextConfig;
