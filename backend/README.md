# Mail-Reply-Agent Backend

## Setup

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Create a `.env` file with your API keys:
   ```bash
   cp .env.example .env
   # Edit .env with your actual API keys
   ```

3. Run the server:
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
   ```

## API Endpoints

- `POST /api/data/upload/style` - Upload style data (email pairs)
- `POST /api/data/upload/knowledge` - Upload knowledge data (PDFs, text)
- `GET /api/data/list/style` - List all style documents
- `GET /api/data/list/knowledge` - List all knowledge documents
- `DELETE /api/data/{doc_type}/{doc_id}` - Delete a document
- `POST /api/draft/generate` - Generate email reply draft
