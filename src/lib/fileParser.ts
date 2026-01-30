import * as XLSX from 'xlsx';
import { AccountRow } from './calculationTypes';

function parseNumber(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  
  // Remove spaces and handle Bulgarian number format
  const cleaned = value.toString().replace(/\s/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

export async function parseExcelFile(file: File): Promise<{ rows: AccountRow[]; title: string; period: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON with header row detection
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
        
        // Extract title and period from first rows (before header)
        let title = '';
        let period = '';
        
        for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
          const row = jsonData[i];
          if (Array.isArray(row) && row.length > 0) {
            const rowText = row.filter(cell => cell).join(' ').trim();
            
            // Check for period pattern (от XX.XX.XXXX до XX.XX.XXXX)
            const periodMatch = rowText.match(/от\s*\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}\s*(до|[-–])\s*\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}/i);
            if (periodMatch && !period) {
              period = periodMatch[0];
              continue;
            }
            
            // Check if this looks like a title (contains "ведомост" or company name patterns)
            if (rowText && !rowText.toLowerCase().includes('номер') && !rowText.toLowerCase().includes('сметка')) {
              if (rowText.toLowerCase().includes('ведомост') || rowText.toLowerCase().includes('еоод') || rowText.toLowerCase().includes('оод')) {
                if (!title) {
                  title = rowText;
                }
              }
            }
          }
        }
        
        // Find the header row (looking for "Номер" column)
        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
          const row = jsonData[i];
          if (Array.isArray(row)) {
            const rowStr = row.join(' ').toLowerCase();
            if (rowStr.includes('номер') && rowStr.includes('име')) {
              headerRowIndex = i;
              break;
            }
          }
        }
        
        if (headerRowIndex === -1) {
          // Try to find by structure
          headerRowIndex = jsonData.findIndex((row: unknown[]) => 
            row && row.length >= 8 && 
            (String(row[0]).toLowerCase().includes('номер') || 
             String(row[0]).toLowerCase().includes('сметка'))
          );
        }
        
        const accountRows: AccountRow[] = [];
        
        // Process rows after header
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i] as (string | number | undefined)[];
          
          if (!row || row.length < 2) continue;
          
          // Try to parse номер (account number)
          const номерValue = row[0];
          const номер = parseNumber(номерValue);
          
          // Skip if not a valid account number (should be 3 digits typically)
          if (номер < 100 || номер > 999) continue;
          
          // Skip "Общо:" row
          const име = String(row[1] || '').trim();
          if (име.toLowerCase().includes('общо')) continue;
          
          accountRows.push({
            номер,
            име,
            начално_салдо_дебит: parseNumber(row[2]),
            начално_салдо_кредит: parseNumber(row[3]),
            оборот_дебит: parseNumber(row[4]),
            оборот_кредит: parseNumber(row[5]),
            крайно_салдо_дебит: parseNumber(row[6]),
            крайно_салдо_кредит: parseNumber(row[7]),
          });
        }
        
        resolve({ rows: accountRows, title: title.trim(), period: period.trim() });
      } catch (error) {
        reject(new Error('Грешка при обработка на файла: ' + (error as Error).message));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Грешка при четене на файла'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

export async function parsePdfFile(file: File): Promise<AccountRow[]> {
  // Dynamic import for PDF.js - use self-hosted worker for security
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const typedArray = new Uint8Array(e.target?.result as ArrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedArray).promise;
        
        let fullText = '';
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ');
          fullText += pageText + '\n';
        }
        
        // Parse the text to extract account data
        const accountRows = parseTextToAccountRows(fullText);
        resolve(accountRows);
      } catch (error) {
        reject(new Error('Грешка при обработка на PDF файла: ' + (error as Error).message));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Грешка при четене на файла'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

function parseTextToAccountRows(text: string): AccountRow[] {
  const accountRows: AccountRow[] = [];
  
  // Split into lines and try to find number patterns
  const lines = text.split(/[\n\r]+/);
  
  for (const line of lines) {
    // Look for patterns like "101 Основен капитал 0.00 6000.00..."
    const match = line.match(/(\d{3})\s+([^\d]+)\s+([\d\s,.]+)/);
    
    if (match) {
      const номер = parseInt(match[1]);
      const име = match[2].trim();
      const numbers = match[3].split(/\s+/).map(n => {
        const cleaned = n.replace(/\s/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      });
      
      if (номер >= 100 && номер <= 999 && numbers.length >= 6) {
        accountRows.push({
          номер,
          име,
          начално_салдо_дебит: numbers[0] || 0,
          начално_салдо_кредит: numbers[1] || 0,
          оборот_дебит: numbers[2] || 0,
          оборот_кредит: numbers[3] || 0,
          крайно_салдо_дебит: numbers[4] || 0,
          крайно_салдо_кредит: numbers[5] || 0,
        });
      }
    }
  }
  
  return accountRows;
}
