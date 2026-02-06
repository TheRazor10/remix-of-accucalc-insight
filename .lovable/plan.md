

# Two-Pass Invoice Matching Algorithm

## Problem Statement

The current invoice matching algorithm processes files in **upload order**. This causes a critical issue:

- **Low-confidence or unreadable invoices** processed early can claim Excel rows that would have been **perfect matches** for later invoices
- **Legitimate invoices** are then forced to match against remaining rows and appear as "suspicious" with multiple mismatches
- **Multi-page invoice splits** (2 files for 1 invoice) compete for the same row, with only one succeeding

## Solution: Two-Pass Matching

### Pass 1 - Exact Matches Only
Process only invoices where:
- Confidence is "high" or "medium" AND
- Document number is not null AND
- An exact document number match exists in unclaimed Excel rows

These get assigned to their correct rows first, claiming priority.

### Pass 2 - Remaining Files
Process all remaining invoices (unreadable, low confidence, or no exact match found) using the existing `findBestMatch` logic against unclaimed rows only.

---

## Technical Implementation

### File to Modify
`src/lib/invoiceComparison.ts`

### Changes to `runVerification()` function (lines 939-977)

**Current logic:**
```text
for each invoice in upload order:
    find best match (exact OR fallback)
    claim the row
```

**New logic:**
```text
PASS 1 - Exact matches first:
    Filter invoices: confidence = high/medium AND documentNumber != null
    Sort by confidence (high before medium)
    For each:
        Find ONLY exact documentNumber match in unclaimed rows
        If found: claim the row, mark invoice as processed

PASS 2 - Fallback for remaining:
    For each unprocessed invoice:
        Use findBestMatch against unclaimed rows only
        Claim whatever row has fewest mismatches
```

### Helper Function to Add

```text
function findExactDocumentNumberMatch(
    invoiceData: ExtractedInvoiceData,
    excelRows: InvoiceExcelRow[],
    excludeRows: Set<number>
): InvoiceExcelRow | null

- Returns Excel row with matching document number
- Returns null if no exact match exists
- Ignores rows already claimed
```

### Summary of Changes

| Function | Change |
|----------|--------|
| `runVerification()` | Rewrite to use two-pass logic |
| `findExactDocumentNumberMatch()` | New helper function |
| `compareInvoiceWithExcel()` | No changes needed |
| `findBestMatch()` | No changes needed |

---

## Expected Outcomes

| Before | After |
|--------|-------|
| Unreadable invoices "steal" rows from perfect matches | Exact matches always claim their rows first |
| Upload order determines match priority | Match quality determines priority |
| Legitimate invoices marked suspicious | Only true mismatches marked suspicious |

---

## Edge Cases Handled

1. **Multi-page splits (2 files for 1 invoice)**: If both extract the same document number, only one claims the row; the other goes to Pass 2 or "not_found"

2. **All invoices unreadable**: Pass 1 finds no matches; Pass 2 uses existing fallback logic

3. **No exact matches exist**: All invoices go to Pass 2 (current behavior preserved)

4. **Duplicate document numbers in Excel**: First unclaimed row with that number is matched (existing behavior)

