/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
