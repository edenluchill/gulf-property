# Gulf Property Backend API

Backend API for Gulf Property - Dubai Off-Plan Properties Platform

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with JSONB for flexible schema
- **AI Processing**: LangGraph + Gemini AI (Multi-Agent System)
- **Deployment**: Hetzner

## Setup

### Prerequisites

- Node.js 18+ installed
- PostgreSQL 14+ installed and running
- npm or yarn package manager

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Update `.env` with your database credentials and API keys:
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gulf_property
DB_USER=gulf_admin
DB_PASSWORD=your_password

# AI Processing (Required for LangGraph PDF Processor)
GEMINI_API_KEY=your_gemini_api_key_here
```

Get your Gemini API key from: https://aistudio.google.com/app/apikey

4. Create database and run schema:
```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE gulf_property;

# Exit psql
\q

# Run schema
psql -U postgres -d gulf_property -f src/db/schema.sql
```

5. (Optional) Seed database with sample data:
```bash
npm run seed
```

### Development

Start the development server with hot reload:
```bash
npm run dev
```

The API will be available at `http://localhost:3001`

### Build

Build for production:
```bash
npm run build
```

Start production server:
```bash
npm start
```

## API Endpoints

### Projects

- `GET /api/projects` - Get all verified projects with optional filters
  - Query params: `developer`, `district`, `minPrice`, `maxPrice`, `completionDateEnd`, `status`
- `GET /api/projects/:id` - Get single project by ID
- `GET /api/projects/meta/developers` - Get list of unique developers
- `GET /api/projects/meta/districts` - Get list of unique districts

### Submissions

- `POST /api/submissions` - Submit new project (from developer)
- `GET /api/submissions` - Get all submissions (admin only)

### LangGraph PDF Processor (NEW! 🤖)

Advanced multi-agent AI system for automated PDF analysis:

- `POST /api/langgraph/process-pdf` - Process property brochure PDF
  - Upload PDF file (multipart/form-data)
  - Returns: Extracted building data, market analysis, marketing content
  - See [LANGGRAPH_README.md](./LANGGRAPH_README.md) for detailed documentation
- `GET /api/langgraph/health` - Check LangGraph service status
- `GET /api/langgraph/info` - Get workflow information and agent details

**Features**:
- Automatic page classification (floor plans, payment plans, etc.)
- Parallel processing for speed
- Unit type extraction with specifications
- Payment plan standardization
- Market intelligence gathering
- Multi-platform marketing content generation (Xiaohongshu, Twitter, Email)

### Health Check

- `GET /health` - Check API and database health

## Database Schema

The database uses PostgreSQL with JSONB fields for flexible data structures:

- **projects** - Verified off-plan property projects
- **developer_submissions** - Unverified project submissions from developers

See `src/db/schema.sql` for complete schema.

## Deployment to Hetzner

1. Set up a Hetzner Cloud server with Ubuntu
2. Install Node.js and PostgreSQL
3. Clone the repository
4. Set up environment variables
5. Build the project: `npm run build`
6. Use PM2 or similar to manage the process:
```bash
npm install -g pm2
pm2 start dist/index.js --name gulf-property-api
pm2 save
pm2 startup
```

## Environment Variables

See `.env.example` for all required environment variables.

## Security Features

- Helmet.js for security headers
- CORS configuration
- Rate limiting
- Input validation with express-validator
- SQL injection prevention with parameterized queries

## License

MIT
