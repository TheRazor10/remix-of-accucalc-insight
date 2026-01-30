/**
 * Shared CORS configuration for all edge functions
 * Restricts access to known project domains only
 */

// Allowed origins - production and preview domains
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  'https://accrual-analyzer.lovable.app',
  /^https:\/\/id-preview--[a-z0-9-]+\.lovable\.app$/,
  /^http:\/\/localhost:\d+$/,
];

/**
 * Get CORS headers with dynamic origin validation
 * @param requestOrigin - The Origin header from the request
 * @returns CORS headers object
 */
export function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = requestOrigin ?? '';
  
  const isAllowed = ALLOWED_ORIGINS.some(allowed => 
    typeof allowed === 'string' 
      ? allowed === origin 
      : allowed.test(origin)
  );
  
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : 'https://accrual-analyzer.lovable.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
}

/**
 * Handle preflight OPTIONS request
 * @param requestOrigin - The Origin header from the request
 * @returns Response for OPTIONS request
 */
export function handleCorsPreflightRequest(requestOrigin: string | null): Response {
  return new Response(null, { headers: getCorsHeaders(requestOrigin) });
}
