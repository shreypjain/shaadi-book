/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Specific tRPC proxy — backend mounts tRPC at /trpc
      {
        source: "/api/trpc/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/trpc/:path*`,
      },
      // General API proxy for other routes
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
