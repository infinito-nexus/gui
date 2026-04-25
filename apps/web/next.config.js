/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Disable Next.js built-in gzip compression so proxied Server-Sent Events
  // (text/event-stream) reach the browser as a true byte-stream instead of
  // being buffered into gzip frames that EventSource cannot parse incrementally.
  compress: false,
  experimental: {
    proxyTimeout: 600000,
  },
  async rewrites() {
    const target = (process.env.API_PROXY_TARGET || "http://api:8000").replace(
      /\/+$/,
      ""
    );
    return [
      {
        source: "/api/:path*",
        destination: `${target}/api/:path*`,
      },
    ];
  },
  webpack: (config) => {
    config.experiments = {
      ...(config.experiments || {}),
      asyncWebAssembly: true,
    };
    return config;
  },
};

module.exports = nextConfig;
