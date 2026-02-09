# Review: Sales Verification System

**Branch reviewed:** `claude/review-code-algorithm-oPZ6a`
**Commit:** `2c69ee4` — "Add Sales Verification system matching Lovable reference design"
**Reviewer:** Claude
**Date:** 2026-02-09

## Scope

~3,000 lines added across 8 new files and 2 modified files, implementing a Bulgarian VAT sales journal verification workflow (PDF vs Excel comparison).

### Files Added
- `src/components/SalesComparisonResults.tsx` (549 lines) — Results display component
- `src/components/SalesVerificationTab.tsx` (563 lines) — Main verification workflow UI
- `src/lib/salesComparison.ts` (385 lines) — Core comparison logic
- `src/lib/salesComparisonTypes.ts` (152 lines) — Type definitions
- `src/lib/salesJournalParser.ts` (420 lines) — Excel sales journal parser
- `src/lib/pdfTextExtractor.ts` (537 lines) — Native PDF text extraction
- `src/lib/pdfOcrFallback.ts` (192 lines) — OCR fallback for scanned PDFs
- `src/lib/salesVerificationExport.ts` (181 lines) — Excel export with status column

### Files Modified
- `src/pages/InvoiceStandalone.tsx` — Added Purchases/Sales tab layout
- `src/App.tsx` — Trailing newline removal (cosmetic)

---

## Issues

### Critical

#### 1. Best-match fallback always matches (`salesComparison.ts:47-52`)

`findBestSalesMatch` returns the row with the fewest mismatches but has no minimum threshold. If exact document number matching fails, every PDF will be assigned to some Excel row, even with 6/6 fields mismatching. This produces false "suspicious" matches instead of `not_found`.

**Recommendation:** Add a mismatch ceiling (e.g., reject if mismatches > 3) and return `null` when no reasonable match exists.

#### 2. Row-claiming allows suboptimal matches (`salesComparison.ts:286-295`)

PDFs are processed sequentially. The best-match fallback can claim a row that a later PDF would have matched exactly. The `excludeRows` set prevents double-claiming, but processing order determines who gets priority.

**Recommendation:** Process PDFs in two passes — first assign exact matches for all PDFs, then run best-match fallback only for unmatched PDFs.

### Significant

#### 3. EUR vs BGN extraction ambiguity (`pdfTextExtractor.ts:310-370`)

Amount extraction prioritizes EUR when both EUR and BGN appear. The Excel sales journal typically records BGN amounts. EU invoices showing both currencies will produce mismatches.

**Recommendation:** Default to BGN extraction for the sales journal context, or detect and match the Excel's currency.

#### 4. Seller/client ID extraction can swap roles (`pdfTextExtractor.ts:218-234`)

`extractSellerId` falls back to the first BG number found. If the document layout puts the buyer first, this misidentifies the client as the seller, leaving `clientId` null.

**Recommendation:** Parse seller and client as a coordinated pair using document layout position rather than independent first-match fallbacks.

#### 5. Column 9 vs Column 11 check is too simplistic (`salesJournalParser.ts:173-186`)

The internal check assumes `totalTaxBase` (col 9) should always equal `taxBase20` (col 11). This fails for invoices with mixed VAT rates (9%, 0%).

**Recommendation:** Check `totalTaxBase == taxBase20 + taxBase9 + taxBase0` instead.

### Minor

#### 6. O(n^2) index lookup in render loop (`SalesComparisonResults.tsx:223`)

`summary.comparisons.indexOf(comparison)` inside `.map()` is O(n) per item. With hundreds of invoices this could lag.

**Recommendation:** Pre-compute indices or use a Map.

#### 7. Duplicated `isPhysicalIndividual` logic

Defined in both `SalesComparisonResults.tsx:23-31` and `salesComparisonTypes.ts:140-149`. Identical logic.

**Recommendation:** Remove the component copy and import from `salesComparisonTypes`.

#### 8. Missing per-PDF failure surfacing (`SalesVerificationTab.tsx`)

When individual PDFs fail extraction, they silently produce null-field results. No UI indication of which PDFs failed.

**Recommendation:** Count and display failed extractions separately.

#### 9. Export row mapping fragility (`salesVerificationExport.ts:99`)

Row index mapping assumes a direct 1:1 correspondence between parser `rowIndex` and worksheet rows. Merged cells or hidden rows would break this.

#### 10. `isVerifiableDocumentType` substring matching (`salesComparisonTypes.ts:131-134`)

Uses `.includes()` which could match unintended substrings (unlikely but possible).

---

## Positive Observations

- Type definitions are thorough with clear JSDoc documentation
- OCR fallback architecture is clean with reasonable garbled-text heuristics
- UI categorization (credit notes, physical individuals, scanned PDFs) is useful
- Excel internal checks (VAT calculation, sequence gaps, duplicates) add real audit value
- Document number normalization handles edge cases well
- Date extraction priority ordering (specific before generic) is well designed
- The tabbed Purchases/Sales layout in InvoiceStandalone.tsx is a clean integration

## Summary

The most impactful issues to fix are #1 (best-match threshold) and #2 (two-pass matching), as both can silently produce incorrect verification results. The EUR/BGN (#3) and seller/client swap (#4) issues will cause real mismatches with certain document formats. The remaining items are quality-of-life improvements.
