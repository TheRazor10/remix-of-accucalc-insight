# Invoice Verification Standalone

A standalone Bulgarian invoice verification tool that uses Google Gemini for OCR extraction.

## Quick Start

### 1. Setup Backend Server

```bash
cd standalone
npm install
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY (get it from https://aistudio.google.com/app/apikey)
npm start
```

The server will run on `http://localhost:3001`

### 2. Setup Frontend

```bash
# In the project root directory
npm install

# Create .env.local with standalone config
echo "VITE_USE_STANDALONE=true" > .env.local
echo "VITE_STANDALONE_URL=http://localhost:3001" >> .env.local

npm run dev
```

The frontend will run on `http://localhost:5173` (or similar)

### 3. Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key
3. Add it to `standalone/.env`

## Project Structure

```
├── standalone/           # Backend server
│   ├── server.js        # Express server with Gemini API
│   ├── package.json     # Server dependencies
│   └── .env.example     # Environment template
├── src/
│   ├── components/      # React components
│   ├── lib/             # Core logic
│   │   ├── invoiceComparison.ts      # Main comparison logic
│   │   ├── invoiceComparisonTypes.ts # TypeScript types
│   │   └── purchaseJournalParser.ts  # Excel parser
│   └── config/constants.ts           # Configuration
└── .env.example          # Frontend env template
```

## How It Works

1. Upload an Excel file with your purchase journal (дневник на покупките)
2. Upload invoice images or PDFs
3. The system extracts data using Gemini's vision capabilities
4. Results are compared and discrepancies are highlighted

## API Endpoints

### POST /extract-invoice

Extract data from an invoice image.

**Request Body:**
```json
{
  "imageBase64": "base64_encoded_image",
  "mimeType": "image/jpeg",
  "useProModel": false,
  "ownCompanyIds": ["BG123456789"]
}
```

**Response:**
```json
{
  "documentType": "ФАКТУРА",
  "documentNumber": "1234567890",
  "documentDate": "15.01.2024",
  "supplierId": "BG987654321",
  "taxBaseAmount": 1000.00,
  "vatAmount": 200.00,
  "confidence": "high"
}
```

## Environment Variables

### Backend (standalone/.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Your Google Gemini API key |
| `PORT` | No | Server port (default: 3001) |

### Frontend (.env.local)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_USE_STANDALONE` | Yes | Set to `true` for standalone mode |
| `VITE_STANDALONE_URL` | No | Server URL (default: http://localhost:3001) |

## Models Used

- **Flash model** (default): `gemini-2.5-flash-preview-05-20` - Fast and efficient
- **Pro model** (for retries): `gemini-2.5-pro-preview-05-06` - More accurate for difficult documents

## License

MIT
