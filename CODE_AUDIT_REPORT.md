# Code Audit Report - Accrual Analyzer (Dafi)

**Audit Date:** January 25, 2026
**Auditor:** Claude Code Audit
**Application:** Bulgarian Accounting Solution (Dafi)
**Tech Stack:** React 19.2, TypeScript 5.8, Supabase, Deno Edge Functions

---

## Executive Summary

The Accrual Analyzer is a well-structured Bulgarian accounting application with three main features: trial balance analysis, Trading 212 statement processing, and AI-powered invoice verification. The codebase demonstrates good TypeScript practices and modern React patterns. However, there are several areas requiring attention in terms of security, code quality, and maintainability.

**Overall Assessment:** Good foundation with room for improvement in security hardening, error handling, and test coverage.

---

## Table of Contents

1. [Security Findings](#1-security-findings)
2. [Code Quality Issues](#2-code-quality-issues)
3. [Architecture Recommendations](#3-architecture-recommendations)
4. [Performance Considerations](#4-performance-considerations)
5. [Testing & Quality Assurance](#5-testing--quality-assurance)
6. [Maintainability Suggestions](#6-maintainability-suggestions)

---

## 1. Security Findings

### 1.1 HIGH: Overly Permissive CORS Configuration

**Location:** `supabase/functions/extract-invoice/index.ts:4-7`, `supabase/functions/delete-user/index.ts:3-6`

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',  // VULNERABILITY
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```

**Issue:** Using `Access-Control-Allow-Origin: '*'` allows any website to make requests to these endpoints, potentially enabling cross-site request forgery (CSRF) attacks.

**Recommendation:** Restrict CORS to your specific domain(s):
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Credentials': 'true',
};
```

### 1.2 MEDIUM: Missing Input Validation on Edge Functions

**Location:** `supabase/functions/extract-invoice/index.ts:51`

```typescript
const { imageBase64, mimeType, useProModel } = await req.json();
```

**Issue:** The request body is destructured directly without validation. Malformed or excessively large payloads could cause issues.

**Recommendation:** Add input validation:
```typescript
const body = await req.json();
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB in base64

if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
  return new Response(JSON.stringify({ error: 'Invalid image data' }), { status: 400 });
}

if (body.imageBase64.length > MAX_IMAGE_SIZE) {
  return new Response(JSON.stringify({ error: 'Image too large' }), { status: 413 });
}
```

### 1.3 MEDIUM: Sensitive Error Information Exposure

**Location:** Multiple files

```typescript
// supabase/functions/extract-invoice/index.ts:244-254
return new Response(
  JSON.stringify({
    error: error instanceof Error ? error.message : 'Unknown error',  // Exposes internal errors
    ...
  }),
  { status: 500 }
);
```

**Issue:** Detailed error messages are returned to clients, which could expose internal system information.

**Recommendation:** Log detailed errors server-side, return generic messages to clients:
```typescript
console.error('Detailed error:', error);
return new Response(
  JSON.stringify({ error: 'An error occurred processing your request' }),
  { status: 500 }
);
```

### 1.4 MEDIUM: Missing Rate Limiting on Client Side

**Location:** `src/lib/invoiceComparison.ts`

**Issue:** While rate limit errors are handled reactively, there's no proactive rate limiting to prevent users from triggering excessive API calls.

**Recommendation:** Implement client-side rate limiting:
```typescript
import { RateLimiter } from 'limiter';

const limiter = new RateLimiter({ tokensPerInterval: 10, interval: 'minute' });

async function makeApiCall() {
  const hasToken = await limiter.tryRemoveTokens(1);
  if (!hasToken) {
    throw new Error('Rate limit exceeded. Please wait before making more requests.');
  }
  // proceed with API call
}
```

### 1.5 LOW: localStorage for Auth Token Storage

**Location:** `src/integrations/supabase/client.ts:13`

```typescript
auth: {
  storage: localStorage,  // Vulnerable to XSS
  persistSession: true,
}
```

**Issue:** Storing authentication tokens in localStorage makes them vulnerable to XSS attacks.

**Recommendation:** This is Supabase's default and acceptable for most applications. For higher security requirements, consider:
- Implementing Content Security Policy (CSP) headers
- Using httpOnly cookies via Supabase's cookie-based auth

### 1.6 LOW: No Content Security Policy

**Issue:** The application doesn't appear to have CSP headers configured.

**Recommendation:** Add CSP headers in your hosting configuration:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:;
```

---

## 2. Code Quality Issues

### 2.1 Type Safety Issues

**Location:** `src/pages/Admin.tsx:44-47`

```typescript
const { data, error } = await supabase
  .from('profiles_with_email' as any)  // Unsafe type assertion
  .select('*')
  .order('created_at', { ascending: false }) as { data: UserProfile[] | null; error: any };
```

**Issue:** Using `as any` bypasses TypeScript's type checking and can hide bugs.

**Recommendation:** Update the Supabase types file to include the view:
```typescript
// In src/integrations/supabase/types.ts
export interface Database {
  public: {
    Views: {
      profiles_with_email: {
        Row: {
          id: string;
          user_id: string;
          approved: boolean;
          created_at: string;
          updated_at: string;
          email: string | null;
        }
      }
    }
  }
}
```

### 2.2 Inconsistent Error Handling

**Location:** Various files

**Issue:** Error handling is inconsistent across the codebase. Some functions throw errors, others return null, and others log and continue silently.

**Example from `src/lib/invoiceComparison.ts:136-144`:**
```typescript
} catch (error) {
  // Re-throw rate limit errors for retry handling
  if (isRateLimitError(error)) {
    throw error;
  }

  console.error('Error in extractInvoiceData:', error);
  return createUnreadableResult(uploadedFile, fileIndex, useProModel);  // Silent failure
}
```

**Recommendation:** Establish a consistent error handling strategy:
```typescript
// Define custom error types
class ExtractionError extends Error {
  constructor(message: string, public readonly recoverable: boolean) {
    super(message);
    this.name = 'ExtractionError';
  }
}

// Use Result type pattern
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

### 2.3 Magic Numbers and Strings

**Location:** Multiple files

```typescript
// src/lib/tradingStatementParser.ts:4
const EUR_BGN_RATE = 1.95583;

// src/components/MultiImageUpload.tsx:11-15
const MAX_FILES = 250;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const CHUNK_SIZE = 5;

// src/lib/invoiceComparison.ts:250
const DELAY_BETWEEN_REQUESTS_MS = 4000;
```

**Issue:** Configuration values are scattered throughout the code.

**Recommendation:** Create a centralized configuration file:
```typescript
// src/config/constants.ts
export const CONFIG = {
  upload: {
    maxFiles: 250,
    maxFileSizeMB: 20,
    chunkSize: 5,
    acceptedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    acceptedPdfType: 'application/pdf',
  },
  api: {
    delayBetweenRequests: 4000,
    maxRetries: 3,
    baseBackoffMs: 10000,
  },
  currency: {
    eurBgnRate: 1.95583,
  },
} as const;
```

### 2.4 Unused Parameters

**Location:** `src/lib/invoiceComparison.ts:821`

```typescript
function compareAmount(
  fieldName: string,
  fieldLabel: string,
  invoiceAmount: number | null,
  excelAmount: number | null,
  documentType?: string | null,  // UNUSED
  tolerance: number = 0.005
): FieldComparison {
```

**Issue:** The `documentType` parameter is declared but never used in the function body.

**Recommendation:** Remove unused parameters or document why they exist for future use.

### 2.5 Callback Dependency Issues in React Hooks

**Location:** `src/components/MultiImageUpload.tsx:221`

```typescript
const handleFiles = useCallback(async (fileList: FileList | File[]) => {
  // ... uses files, onFilesChange
}, [files, onFilesChange]);  // processFilesInChunks is not in deps
```

**Issue:** `processFilesInChunks` is called inside the callback but not included in the dependency array.

**Recommendation:** Either include `processFilesInChunks` in dependencies or memoize it separately.

---

## 3. Architecture Recommendations

### 3.1 Separation of Concerns

**Issue:** Some files mix business logic with UI logic and API calls.

**Example:** `src/lib/invoiceComparison.ts` handles:
- API calls to Supabase
- Data transformation
- Comparison logic
- Error handling

**Recommendation:** Split into layers:
```
src/
├── services/           # API layer
│   ├── invoiceService.ts
│   └── ocrService.ts
├── domain/             # Business logic
│   ├── invoiceComparison.ts
│   └── invoiceMatcher.ts
├── utils/              # Pure utility functions
│   └── dateUtils.ts
└── hooks/              # React-specific logic
    └── useInvoiceVerification.ts
```

### 3.2 State Management

**Issue:** The application uses local component state extensively. For complex features like invoice verification, this can become hard to manage.

**Recommendation:** Consider using:
- **Zustand** or **Jotai** for lightweight global state
- **React Query** (already in use) for server state
- Create custom hooks that encapsulate related state:

```typescript
// src/hooks/useInvoiceVerification.ts
export function useInvoiceVerification() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [extractedData, setExtractedData] = useState<ExtractedInvoiceData[]>([]);
  const [verificationResult, setVerificationResult] = useState<VerificationSummary | null>(null);

  // ... encapsulate all invoice verification logic

  return {
    uploadedFiles,
    extractedData,
    verificationResult,
    uploadFiles,
    runVerification,
    retryFailed,
    clear,
  };
}
```

### 3.3 API Response Types

**Issue:** API responses from edge functions don't have shared type definitions with the frontend.

**Recommendation:** Create shared types:
```typescript
// shared/types/api.ts (or use a monorepo structure)
export interface ExtractInvoiceResponse {
  documentType: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  supplierId: string | null;
  taxBaseAmount: number | null;
  vatAmount: number | null;
  confidence: 'high' | 'medium' | 'low' | 'unreadable';
}

export interface ApiError {
  error: string;
  code?: string;
  retryable?: boolean;
}
```

---

## 4. Performance Considerations

### 4.1 Memory Management in PDF Processing

**Location:** `src/components/MultiImageUpload.tsx:42-82`

**Positive:** The code already implements good memory management practices:
- `page.cleanup()` is called after rendering
- Canvas is cleared after blob creation
- PDF is destroyed after processing

**Improvement:** Add explicit garbage collection hints:
```typescript
// After processing each file
if (typeof global !== 'undefined' && global.gc) {
  global.gc();
}
```

### 4.2 Large List Rendering

**Location:** `src/components/MultiImageUpload.tsx:299-363`

**Issue:** When displaying 250 uploaded files, all thumbnails are rendered at once.

**Recommendation:** Implement virtualization for large lists:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

// Or use simpler pagination for the grid
const ITEMS_PER_PAGE = 50;
const [page, setPage] = useState(0);
const visibleFiles = files.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
```

### 4.3 Repeated Font Loading

**Location:** `src/lib/exporter.ts:137-160`

**Positive:** Font caching is already implemented correctly with `cachedFont` variable.

### 4.4 Unnecessary Re-renders

**Location:** `src/pages/Index.tsx`

**Issue:** Multiple state updates can cause unnecessary re-renders.

**Recommendation:** Batch related state updates:
```typescript
// Instead of:
setSelectedFile(file);
setIsLoading(true);
setResult(null);

// Use:
const handleFileSelect = useCallback(async (file: File) => {
  unstable_batchedUpdates(() => {
    setSelectedFile(file);
    setIsLoading(true);
    setResult(null);
  });
  // ...
}, []);
```

---

## 5. Testing & Quality Assurance

### 5.1 Critical: No Automated Tests

**Issue:** The codebase has **zero automated tests**. This is a significant risk for a financial/accounting application.

**Recommendation:** Prioritize testing for:

1. **Unit Tests** (highest priority for financial calculations):
```typescript
// __tests__/calculator.test.ts
import { calculateFinancials } from '../lib/calculator';

describe('calculateFinancials', () => {
  it('should correctly sum revenue accounts (701-709)', () => {
    const data = [
      { номер: 701, оборот_кредит: 1000 },
      { номер: 702, оборот_кредит: 2000 },
    ];
    const result = calculateFinancials(data);
    expect(result.приходи).toBe(3000);
  });
});
```

2. **Integration Tests** for invoice comparison logic
3. **E2E Tests** for critical user flows

### 5.2 Missing Input Validation Tests

**Issue:** Date parsing and number parsing functions lack boundary testing.

**Recommendation:** Add fuzz testing for parser functions:
```typescript
describe('extractDateComponents', () => {
  it.each([
    ['31.12.2025', { day: 31, month: 12, year: 2025 }],
    ['01.01.25', { day: 1, month: 1, year: 2025 }],
    ['invalid', null],
    ['', null],
    [null, null],
  ])('parses %s correctly', (input, expected) => {
    expect(extractDateComponents(input)).toEqual(expected);
  });
});
```

---

## 6. Maintainability Suggestions

### 6.1 Add JSDoc Documentation

**Issue:** Functions lack documentation, making it harder for new developers.

**Example improvement:**
```typescript
/**
 * Compares extracted invoice data against Excel purchase journal data.
 * Uses two-phase matching:
 * 1. Exact document number match
 * 2. Best match fallback (fewest mismatches among unclaimed rows)
 *
 * @param invoiceData - OCR-extracted invoice data
 * @param excelRows - Parsed purchase journal rows
 * @param excludeRows - Set of row indices already claimed by other invoices
 * @returns Comparison result with field-by-field analysis
 *
 * @example
 * const result = compareInvoiceWithExcel(extractedData, excelRows, new Set());
 * if (result.overallStatus === 'suspicious') {
 *   // Handle mismatches
 * }
 */
export function compareInvoiceWithExcel(
  invoiceData: ExtractedInvoiceData,
  excelRows: InvoiceExcelRow[],
  excludeRows: Set<number> = new Set()
): ComparisonResult {
```

### 6.2 Consistent Logging Strategy

**Issue:** Console logging is inconsistent. Some functions use prefixes like `[OCR]`, others don't.

**Recommendation:** Create a logging utility:
```typescript
// src/lib/logger.ts
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export const logger = {
  ocr: createLogger('OCR'),
  parser: createLogger('Parser'),
  comparison: createLogger('Comparison'),
};

function createLogger(prefix: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => console.debug(`[${prefix}] ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) => console.info(`[${prefix}] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[${prefix}] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[${prefix}] ${msg}`, ...args),
  };
}
```

### 6.3 Environment Configuration

**Issue:** Environment variables are accessed directly throughout the code.

**Recommendation:** Create a validated configuration module:
```typescript
// src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export const env = envSchema.parse({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
```

### 6.4 Remove Console Statements in Production

**Issue:** Numerous `console.log` statements throughout the codebase.

**Recommendation:**
1. Use the logger utility mentioned above
2. Configure build to strip console statements:
```typescript
// vite.config.ts
export default defineConfig({
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
});
```

---

## Summary of Priority Actions

### Critical (Address Immediately)
1. Restrict CORS to specific domains
2. Add input validation on edge functions
3. Implement automated testing for financial calculations

### High Priority
4. Centralize configuration values
5. Improve type safety (remove `as any` assertions)
6. Implement consistent error handling strategy

### Medium Priority
7. Add JSDoc documentation to public functions
8. Create logging utility with proper log levels
9. Implement virtualization for large file lists

### Low Priority
10. Split large files into smaller modules
11. Add environment variable validation
12. Remove/replace development console.log statements

---

## Conclusion

The Accrual Analyzer demonstrates solid React and TypeScript fundamentals with a well-thought-out feature set. The main areas requiring immediate attention are:

1. **Security hardening** of edge functions
2. **Test coverage** for critical financial calculations
3. **Type safety improvements** to catch potential bugs at compile time

With the recommended improvements implemented, this application will be production-ready with proper security, maintainability, and reliability characteristics expected of financial software.

---

*This audit report was generated as part of a code review process. Recommendations should be prioritized based on your team's resources and risk tolerance.*
