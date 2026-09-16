import type { NextConfig } from 'next'

const isDevelopment = process.env.NODE_ENV === 'development'

// Pin connect-src to the one external origin the app actually talks to
// (Supabase REST + Realtime websocket) instead of a https: wildcard that
// would let injected scripts exfiltrate anywhere.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseOrigins = supabaseUrl
  ? ` ${supabaseUrl} ${supabaseUrl.replace('https://', 'wss://')}`
  : ''
const devConnect = isDevelopment ? ' ws: wss:' : ''

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // Zoom's desktop webview and web client embed the app.
  "frame-ancestors 'self' https://*.zoom.us https://*.zoom.com",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${supabaseOrigins}${devConnect}`,
  "media-src 'self' blob:",
].join('; ')

const nextConfig: NextConfig = {
  allowedDevOrigins: ['gavel.sankrityat.com', '127.0.0.1'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ]
  },
}

export default nextConfig
