/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server-only packages that ship their own binaries / data files.
  serverExternalPackages: ['pdfkit', '@electric-sql/pglite', 'postgres', 'bcryptjs'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
