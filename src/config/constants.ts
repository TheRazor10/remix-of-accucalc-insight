/**
 * Centralized configuration constants for the application.
 * All magic numbers and configuration values should be defined here.
 */

/**
 * File upload configuration
 */
export const UPLOAD_CONFIG = {
  /** Maximum number of files that can be uploaded at once */
  maxFiles: 250,
  /** Maximum file size for single file uploads (10MB) */
  maxFileSizeSingle: 10 * 1024 * 1024,
  /** Maximum file size for multi-file uploads including PDFs (20MB) */
  maxFileSizeMulti: 20 * 1024 * 1024,
  /** Number of files to process concurrently to prevent memory overload */
  chunkSize: 5,
  /** Accepted image MIME types */
  acceptedImageTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  /** Accepted PDF MIME type */
  acceptedPdfType: 'application/pdf' as const,
} as const;

/**
 * API request configuration
 */
export const API_CONFIG = {
  /** Delay between API requests in milliseconds (rate limiting) - increased for 8+ concurrent users */
  delayBetweenRequests: 8000,
  /** Maximum number of retries for failed requests */
  maxRetries: 3,
  /** Base backoff time for exponential backoff in milliseconds */
  baseBackoffMs: 10000,
} as const;

/**
 * Currency conversion rates
 */
export const CURRENCY_CONFIG = {
  /** Fixed EUR to BGN conversion rate */
  eurBgnRate: 1.95583,
} as const;

/**
 * Invoice verification configuration
 */
export const INVOICE_CONFIG = {
  /** Tolerance for amount comparisons (0.5%) */
  amountTolerance: 0.005,
  /** Confidence levels for OCR extraction */
  confidenceLevels: ['high', 'medium', 'low', 'unreadable'] as const,
} as const;

/**
 * File history configuration
 */
export const HISTORY_CONFIG = {
  /** Maximum number of files to keep in history per user */
  maxFilesPerUser: 100,
} as const;
