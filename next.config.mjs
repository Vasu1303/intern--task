/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    dangerouslyAllowSVG: true,
    domains: [],
    // Allow data URLs and blob URLs
    unoptimized: false,
    remotePatterns: [],
  },
};

export default nextConfig;
