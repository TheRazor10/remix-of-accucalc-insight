import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CalculationResult, ExportFormat } from './calculationTypes';
import { TradingStatementResult } from './tradingStatementTypes';

function formatCurrency(value: number): string {
  return value.toLocaleString('bg-BG', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }) + ' лв.';
}

function formatCurrencyWithSymbol(value: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : 'лв.';
  return `${value.toFixed(2)} ${symbol}`;
}

export async function exportResults(result: CalculationResult, format: ExportFormat, fileName: string = 'financial_report'): Promise<void> {
  if (format === 'xlsx') {
    exportToExcel(result, fileName);
  } else {
    await exportToPdf(result, fileName);
  }
}

export function exportTradingResults(result: TradingStatementResult, fileName: string = 'trading_report'): void {
  const workbook = XLSX.utils.book_new();
  
  // Summary sheet
  const summaryData = [
    ['Trading 212 Отчет'],
    [''],
    ['Обобщение', 'BGN', 'EUR'],
    ['Обща печалба', formatCurrencyWithSymbol(result.totalProfitBGN, 'BGN'), formatCurrencyWithSymbol(result.totalProfitEUR, 'EUR')],
    ['Обща загуба', formatCurrencyWithSymbol(result.totalLossBGN, 'BGN'), formatCurrencyWithSymbol(result.totalLossEUR, 'EUR')],
    ['Нетен резултат', formatCurrencyWithSymbol(result.totalProfitBGN - result.totalLossBGN, 'BGN'), formatCurrencyWithSymbol(result.totalProfitEUR - result.totalLossEUR, 'EUR')],
    ['Обща стойност', formatCurrencyWithSymbol(result.totalValueBGN, 'BGN'), formatCurrencyWithSymbol(result.totalValueEUR, 'EUR')],
    [''],
    ['Брой продажби', result.summary.totalSellTransactions.toString()],
    ['Валути', result.summary.currenciesInvolved.join(', ')],
    ['Период', result.summary.dateRange.from && result.summary.dateRange.to 
      ? `${result.summary.dateRange.from.toLocaleDateString('bg-BG')} - ${result.summary.dateRange.to.toLocaleDateString('bg-BG')}`
      : 'N/A'
    ],
  ];
  
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Обобщение');
  
  // Conversions details sheet
  if (result.conversions.length > 0) {
    const conversionsData = [
      ['Детайли по конверсии'],
      [''],
      ['Дата', 'Валута', 'Печалба/Загуба', 'Курс', 'BGN', 'EUR', 'Общо', 'Общо BGN'],
      ...result.conversions.map(conv => [
        conv.date.toLocaleDateString('bg-BG'),
        conv.originalCurrency,
        formatCurrencyWithSymbol(conv.originalValue, conv.originalCurrency),
        conv.exchangeRateUsed.toFixed(5),
        formatCurrencyWithSymbol(conv.convertedBGN, 'BGN'),
        formatCurrencyWithSymbol(conv.convertedEUR, 'EUR'),
        formatCurrencyWithSymbol(conv.total, conv.originalCurrency),
        formatCurrencyWithSymbol(conv.totalBGN, 'BGN'),
      ]),
    ];
    
    const conversionsSheet = XLSX.utils.aoa_to_sheet(conversionsData);
    conversionsSheet['!cols'] = [
      { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 12 }, 
      { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 15 }
    ];
    XLSX.utils.book_append_sheet(workbook, conversionsSheet, 'Конверсии');
  }
  
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

function exportToExcel(result: CalculationResult, fileName: string): void {
  const workbook = XLSX.utils.book_new();
  
  // Build company info string (title + period)
  const companyInfo = [result.title, result.period].filter(Boolean).join(' | ');
  
  const summaryData = [
    ['Финансов отчет', companyInfo],
    [''],
    ['Категория', 'Стойност'],
    ['Приходи', formatCurrency(result.приходи)],
    ['Разходи', formatCurrency(result.разходи)],
    ['Др. вземания', formatCurrency(result.др_вземания)],
    ['Др. задължения', formatCurrency(result.др_задължения)],
    ['Каса', formatCurrency(result.каса)],
    [''],
    ['Печалба/Загуба', formatCurrency(result.приходи - result.разходи)],
  ];
  
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  
  // Set column widths
  summarySheet['!cols'] = [{ wch: 40 }, { wch: 20 }];
  
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Обобщение');
  
  // Details sheets
  const categories = [
    { name: 'Приходи', data: result.details.приходи },
    { name: 'Разходи', data: result.details.разходи },
    { name: 'Др. вземания', data: result.details.др_вземания },
    { name: 'Др. задължения', data: result.details.др_задължения },
    { name: 'Каса', data: result.details.каса },
  ];
  
  for (const category of categories) {
    if (category.data.length > 0) {
      const detailData = [
        [category.name],
        [''],
        ['Номер на сметка', 'Име', 'Стойност'],
        ...category.data.map(item => [item.номер.toString(), item.име, formatCurrency(item.стойност)]),
        [''],
        ['Общо:', '', formatCurrency(category.data.reduce((sum, item) => sum + item.стойност, 0))],
      ];
      
      const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
      detailSheet['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(workbook, detailSheet, category.name);
    }
  }
  
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

// Cache for the font to avoid reloading
let cachedFont: string | null = null;

async function loadCyrillicFont(): Promise<string> {
  if (cachedFont) return cachedFont;
  
  // Fetch Noto Sans TTF font which has comprehensive Cyrillic/Bulgarian support
  // Using Google Fonts static TTF file
  const response = await fetch('https://fonts.gstatic.com/s/notosans/v36/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf');
  
  if (!response.ok) {
    throw new Error('Failed to fetch font');
  }
  
  const arrayBuffer = await response.arrayBuffer();
  
  // Convert to base64
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  cachedFont = btoa(binary);
  return cachedFont;
}

async function exportToPdf(result: CalculationResult, fileName: string): Promise<void> {
  const doc = new jsPDF();
  
  let fontLoaded = false;
  
  // Load and add Noto Sans Cyrillic font (TTF format required by jsPDF)
  try {
    const fontBase64 = await loadCyrillicFont();
    doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    doc.setFont('NotoSans', 'normal');
    fontLoaded = true;
  } catch (error) {
    console.warn('Failed to load Cyrillic font, falling back to default:', error);
  }
  
  const fontName = fontLoaded ? 'NotoSans' : 'helvetica';
  
  // Title and header info
  let yPos = 15;
  
  if (result.title) {
    doc.setFontSize(14);
    doc.text(result.title, 105, yPos, { align: 'center' });
    yPos += 8;
  }
  
  if (result.period) {
    doc.setFontSize(10);
    doc.text(result.period, 105, yPos, { align: 'center' });
    yPos += 8;
  }
  
  doc.setFontSize(16);
  doc.text('Финансов отчет', 105, yPos + 5, { align: 'center' });
  yPos += 12;
  
  doc.setFontSize(9);
  doc.text(`Дата: ${new Date().toLocaleDateString('bg-BG')}`, 105, yPos, { align: 'center' });
  yPos += 10;
  
  // Summary table
  doc.setFontSize(12);
  doc.text('Обобщение', 14, yPos);
  
  autoTable(doc, {
    startY: yPos + 5,
    head: [['Категория', 'Стойност']],
    body: [
      ['Приходи', formatCurrency(result.приходи)],
      ['Разходи', formatCurrency(result.разходи)],
      ['Др. вземания', formatCurrency(result.др_вземания)],
      ['Др. задължения', formatCurrency(result.др_задължения)],
      ['Каса', formatCurrency(result.каса)],
      ['', ''],
      ['Печалба/Загуба', formatCurrency(result.приходи - result.разходи)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [23, 119, 153], textColor: 255, font: fontName, fontStyle: 'normal' },
    bodyStyles: { font: fontName },
    styles: { font: fontName, fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 60, halign: 'right' },
    },
  });
  
  let yPosition = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 100;
  
  // Detail tables
  const categories = [
    { name: 'Приходи (детайли)', data: result.details.приходи },
    { name: 'Разходи (детайли)', data: result.details.разходи },
    { name: 'Др. вземания (детайли)', data: result.details.др_вземания },
    { name: 'Др. задължения (детайли)', data: result.details.др_задължения },
    { name: 'Каса (детайли)', data: result.details.каса },
  ];
  
  for (const category of categories) {
    if (category.data.length > 0) {
      yPosition += 15;
      
      // Check if we need a new page
      if (yPosition > 250) {
        doc.addPage();
        yPosition = 20;
      }
      
      doc.setFontSize(11);
      doc.text(category.name, 14, yPosition);
      
      autoTable(doc, {
        startY: yPosition + 5,
        head: [['Номер', 'Име', 'Стойност']],
        body: [
          ...category.data.map(item => [item.номер.toString(), item.име, formatCurrency(item.стойност)]),
          ['Общо:', '', formatCurrency(category.data.reduce((sum, item) => sum + item.стойност, 0))],
        ],
        theme: 'grid',
        headStyles: { fillColor: [23, 119, 153], textColor: 255, font: fontName, fontStyle: 'normal' },
        bodyStyles: { font: fontName },
        styles: { font: fontName, fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 95 },
          2: { cellWidth: 35, halign: 'right' },
        },
      });
      
      yPosition = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || yPosition + 50;
    }
  }
  
  doc.save(`${fileName}.pdf`);
}
