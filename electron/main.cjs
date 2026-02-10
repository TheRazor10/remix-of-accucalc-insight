const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let mainWindow;
let server;
let serverPort;

// Store API key in user's app data folder
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return {};
}

function saveConfig(config) {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// ─── Express Server (embedded) ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert OCR system specialized in extracting data from Bulgarian invoices (фактури).
Your task is to extract specific fields from invoice images accurately.

CRITICAL - SLASHED ZERO RECOGNITION:
Many Bulgarian thermal receipts and dot-matrix printed invoices use a SLASHED ZERO (0 with a diagonal line through it, like ø).
This is commonly confused with the digit 8 or 9. When you see a digit that looks like:
- A zero with a diagonal slash through it (ø or 0̷) → This is the digit "0"
- An 8-like shape but with a clear diagonal line → This is likely "0" not "8"
Pay special attention to invoice numbers, company IDs (EIK/ДДС номер), and amounts on thermal receipts.

Extract the following fields:
1. Document Type (Вид на документа) - MUST be one of: "ФАКТУРА", "КРЕДИТНО ИЗВЕСТИЕ", "ДЕБИТНО ИЗВЕСТИЕ"
   - IMPORTANT: "ОРИГИНАЛ", "КОПИЕ", "ДУБЛИКАТ" are document COPY STATUSES, NOT document types - IGNORE these!
   - Look for "ФАКТУРА №" or "ФАКТУРА N:" to identify an invoice
   - The document type is the category of the document, not its copy status
2. Document Number (Номер на документа) - the invoice number, usually after "ФАКТУРА №" or "ФАКТУРА N:" or "№"
3. Document Date (Дата на документа) - the issue date, usually labeled "Дата:" or "Дата на издаване:" or "Дата дан.събитие:"
4. Supplier ID (ДДС номер или ЕИК на доставчика) - the VAT number (starts with BG) or company ID (9 digits) of the SUPPLIER/SELLER (Доставчик/Продавач/Издател)
5. Client ID (ДДС номер или ЕИК на получателя) - the VAT number (starts with BG) or company ID (9 digits) of the CLIENT/BUYER (Получател/Клиент)
6. Tax Base Amount (Данъчна основа) - the TOTAL taxable base for the ENTIRE invoice, NOT page subtotals
7. VAT Amount (ДДС) - the TOTAL VAT amount for the ENTIRE invoice, usually 20% of tax base

CRITICAL - CURRENCY PRIORITY (EUR vs BGN):
Many Bulgarian invoices show amounts in BOTH EUR and BGN (лева). You MUST:
1. FIRST look for amounts in EUR (€, EUR, евро) - these are the PRIMARY values to extract
2. ONLY if EUR amounts are NOT present, use the BGN (лв., лева, BGN) amounts as fallback
3. The EUR amount is typically shown alongside or above the BGN equivalent

CRITICAL for Tax Base Amount - look for these labels IN ORDER OF PRIORITY:
1. "Данъчна основа" = Tax Base (MOST COMMON - use this first)
2. "Общо без ДДС" = Total without VAT (COMMON)
3. "НЕТО СУМА" or "Общо нето" = Net Amount (fallback for some vendors like Metro)
For each label, prefer the EUR value if both EUR and BGN are shown.

CRITICAL for VAT Amount - look for these labels:
- "ДДС" followed by amount
- "НАЧИСЛЕН ДДС" or "ДДС НАЧИСЛ. ДДС"
- "В=20%" section showing VAT calculation
- "ОБЩА СУМА" minus "Данъчна основа" = VAT (for verification)
For each label, prefer the EUR value if both EUR and BGN are shown.

DO NOT extract these (they are page subtotals, not invoice totals):
- "Стр. Общо" = Page subtotal - IGNORE THIS
- "Посл. Стр. Общо" = Previous page subtotal - IGNORE THIS

Important notes:
- For dates, use DD.MM.YYYY format
- For amounts, extract only the numeric value (can be negative for credit notes)
- Preserve negative signs for credit notes (КРЕДИТНО ИЗВЕСТИЕ)
- The Supplier ID is from the seller/issuer (Доставчик), NOT the buyer (Получател)
- The Client ID is from the buyer/receiver (Получател/Клиент), NOT the seller (Доставчик)
- Look for ДДС № or ЕИК near each company's name section on the invoice
- If a field cannot be read clearly, return null for that field

Return a confidence level:
- "high": All fields clearly readable
- "medium": Most fields readable, some uncertainty
- "low": Significant difficulty reading some fields
- "unreadable": Cannot extract meaningful data

IMPORTANT: Return your response as valid JSON with these exact fields:
{
  "documentType": string or null,
  "documentNumber": string or null,
  "documentDate": string or null,
  "supplierId": string or null,
  "clientId": string or null,
  "taxBaseAmount": number or null,
  "vatAmount": number or null,
  "confidence": "high" | "medium" | "low" | "unreadable"
}`;

function startServer(apiKey) {
  return new Promise((resolve, reject) => {
    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(express.json({ limit: '50mb' }));

    const genAI = new GoogleGenerativeAI(apiKey);

    // Serve the built frontend
    const distPath = path.join(__dirname, '..', 'dist');
    expressApp.use(express.static(distPath));

    expressApp.post('/extract-invoice', async (req, res) => {
      try {
        const { imageBase64, mimeType, useProModel, ownCompanyIds } = req.body;

        if (!imageBase64 || typeof imageBase64 !== 'string') {
          return res.status(400).json({ error: 'Invalid image data' });
        }

        const ownCompanyIdsList = Array.isArray(ownCompanyIds)
          ? ownCompanyIds.filter(id => id && id.trim()).map(id => id.trim().toUpperCase())
          : [];

        let companyIdExclusionNote = '';
        if (ownCompanyIdsList.length > 0) {
          companyIdExclusionNote = `\n\nCRITICAL - OWN COMPANY IDs:
The following IDs belong to the invoice ISSUER/SELLER (Доставчик):
${ownCompanyIdsList.map(id => `- ${id}`).join('\n')}
Assign these IDs to "supplierId". The OTHER company's ID on the invoice is the "clientId" (Получател/Клиент).
Make sure to extract BOTH supplierId and clientId as separate fields.`;
        }

        const fullPrompt = SYSTEM_PROMPT + companyIdExclusionNote + '\n\nPlease extract the invoice data from this image and return it as JSON.';

        const modelName = useProModel ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });

        const imagePart = {
          inlineData: {
            data: imageBase64,
            mimeType: mimeType || 'image/jpeg',
          },
        };

        console.log(`[${new Date().toISOString()}] Processing image with ${modelName}...`);

        const result = await model.generateContent([fullPrompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        let extractedData;
        try {
          const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
          const jsonStr = jsonMatch ? jsonMatch[1] : text;
          extractedData = JSON.parse(jsonStr.trim());
        } catch (parseError) {
          console.error('Failed to parse Gemini response:', text);
          extractedData = {
            documentType: null, documentNumber: null, documentDate: null,
            supplierId: null, clientId: null, taxBaseAmount: null, vatAmount: null,
            confidence: 'unreadable',
          };
        }

        console.log(`[${new Date().toISOString()}] Extracted:`, extractedData);
        res.json(extractedData);
      } catch (error) {
        console.error('Error in extract-invoice:', error);
        res.status(500).json({
          error: error.message || 'Unknown error',
          documentType: null, documentNumber: null, documentDate: null,
          supplierId: null, clientId: null, taxBaseAmount: null, vatAmount: null,
          confidence: 'unreadable',
        });
      }
    });

    expressApp.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // SPA fallback
    expressApp.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    // Use port 0 to get a random available port
    server = expressApp.listen(0, () => {
      serverPort = server.address().port;
      console.log(`Backend server running on port ${serverPort}`);
      resolve(serverPort);
    });

    server.on('error', reject);
  });
}

// ─── Electron Window ─────────────────────────────────────────────────────────

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'AccuCalc',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Throttle rendering when minimized to reduce CPU usage
  mainWindow.on('minimize', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.setFrameRate(1);
    }
  });

  mainWindow.on('restore', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.setFrameRate(60);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('get-api-key', () => {
  const config = loadConfig();
  return config.geminiApiKey || '';
});

ipcMain.handle('set-api-key', (event, apiKey) => {
  const config = loadConfig();
  config.geminiApiKey = apiKey;
  saveConfig(config);
  return true;
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const config = loadConfig();
  let apiKey = config.geminiApiKey;

  // Prompt for API key if not set
  if (!apiKey) {
    const { response, checkboxChecked } = await dialog.showMessageBox({
      type: 'info',
      title: 'Gemini API Key Required',
      message: 'Please set your Gemini API key.\n\nYou can get one from Google AI Studio.\nThe key will be saved securely for future use.',
      buttons: ['Enter Key', 'Cancel'],
    });

    if (response === 1) {
      app.quit();
      return;
    }

    // Use a simple prompt via a small BrowserWindow
    apiKey = await promptForApiKey();
    if (!apiKey) {
      app.quit();
      return;
    }

    saveConfig({ ...config, geminiApiKey: apiKey });
  }

  try {
    const port = await startServer(apiKey);
    createWindow(port);
  } catch (error) {
    dialog.showErrorBox('Server Error', `Failed to start server: ${error.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});

// Simple API key input window
function promptForApiKey() {
  return new Promise((resolve) => {
    const inputWindow = new BrowserWindow({
      width: 500,
      height: 220,
      resizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.cjs'),
      },
    });

    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; background: #1a1a2e; color: #e0e0e0; margin: 0; }
    h3 { margin: 0 0 16px 0; color: #fff; }
    input { width: 100%; padding: 10px; border: 1px solid #444; border-radius: 6px; font-size: 14px; background: #16213e; color: #fff; box-sizing: border-box; }
    input:focus { outline: none; border-color: #6c63ff; }
    .buttons { margin-top: 16px; text-align: right; }
    button { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin-left: 8px; }
    .ok { background: #6c63ff; color: white; }
    .ok:hover { background: #5a52d5; }
    .cancel { background: #333; color: #ccc; }
    .cancel:hover { background: #444; }
  </style>
</head>
<body>
  <h3>Enter Gemini API Key</h3>
  <input type="password" id="key" placeholder="Paste your API key here..." autofocus />
  <div class="buttons">
    <button class="cancel" onclick="window.electronAPI.submitKey('')">Cancel</button>
    <button class="ok" onclick="window.electronAPI.submitKey(document.getElementById('key').value)">Save</button>
  </div>
  <script>
    document.getElementById('key').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') window.electronAPI.submitKey(document.getElementById('key').value);
      if (e.key === 'Escape') window.electronAPI.submitKey('');
    });
  </script>
</body>
</html>`;

    const tempPath = path.join(app.getPath('temp'), 'accucalc-apikey.html');
    fs.writeFileSync(tempPath, html);
    inputWindow.loadFile(tempPath);

    ipcMain.handleOnce('submit-api-key', (event, key) => {
      inputWindow.close();
      // Clean up temp file
      try { fs.unlinkSync(tempPath); } catch (e) {}
      resolve(key || null);
    });

    inputWindow.on('closed', () => {
      resolve(null);
    });
  });
}
