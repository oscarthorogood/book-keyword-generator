# Development Guide

## Setup

### Prerequisites
- Node.js 18+ (check with `node --version`)
- npm or yarn

### Initial Setup
```bash
# Run the setup script to install dependencies and configure git hooks
bash scripts/setup.sh

# Or manually:
npm install
cp .env.example .env.local
# Edit .env.local with your configuration
```

### Environment Variables

See `.env.example` for all available configuration options. Key variables:

- `APP_PASSWORD` - Password for login (required)
- `AUTH_SECRET` - Secret for JWT signing (auto-generated if not set, but recommend setting in production)
- `AMAZON_ADS_*` - Amazon Ads API credentials (optional, for keyword recommendations)
- `GEMINI_API_KEY` - Google Gemini API key for AI ranking (optional)
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` - Supabase Storage archiving of generated bulksheets (optional, both required together)

## Development Workflow

### Starting the Dev Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Code Quality

#### Linting
```bash
# Run ESLint
npm run lint

# Fix issues automatically
npm run lint -- --fix
```

#### Type Checking
```bash
# Check TypeScript
npx tsc --noEmit
```

#### Building
```bash
npm run build
npm start
```

## Project Structure

```
.
├── app/
│   ├── api/                    # API route handlers
│   │   ├── generate/           # Campaign generation endpoint
│   │   ├── login/              # Authentication endpoints
│   │   └── lookup/             # Book metadata lookup
│   ├── page.tsx                # Main UI page
│   ├── layout.tsx              # App layout
│   └── globals.css             # Global styles
├── lib/
│   ├── config.ts               # Centralized configuration (NEW)
│   ├── errors.ts               # Error handling utilities (NEW)
│   ├── auth.ts                 # Authentication logic
│   ├── scrape.ts               # Web scraping functions
│   ├── keywordMerge.ts         # Keyword processing
│   ├── bulksheet.ts            # Excel bulksheet generation
│   └── ...                     # Other utility modules
├── components/
│   ├── Header.tsx              # Header component
│   └── LoginForm.tsx           # Login form component
├── .github/workflows/
│   └── ci.yml                  # GitHub Actions CI/CD (NEW)
├── scripts/
│   └── setup.sh                # Dev environment setup (NEW)
└── DEVELOPMENT.md              # This file
```

## Key Modules

### `lib/config.ts` (NEW)
Centralized configuration for:
- Authentication settings (JWT secret, cookie config, public paths)
- API settings (timeout, error messages)
- Keyword configuration (marketplaces, match types, limits)

**Why it was added:** Previously, configuration was duplicated across `middleware.ts` and `lib/auth.ts`. This centralizes it for easier maintenance.

### `lib/errors.ts` (NEW)
Standardized error handling with:
- Custom error classes (`AppError`, `ValidationError`, `AuthError`, etc.)
- Consistent error logging with context
- Error-to-response conversion for API endpoints

**Why it was added:** Error handling was inconsistent, mixing `console.error` with raw `NextResponse.json` calls.

### `lib/auth.ts`
Authentication and session management. Now uses centralized config from `lib/config.ts`.

### `app/api/generate/route.ts` (791 lines)
Main campaign generation endpoint. **TODO:** This should be refactored into smaller modules:
- `services/generateCampaign.ts` - Core logic
- `services/keywordExtraction.ts` - Keyword gathering and processing
- `validators/generateRequest.ts` - Request validation

## GitHub Actions CI/CD

The project includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that:
1. Runs ESLint on every push and PR
2. Type-checks with TypeScript
3. Builds the project

This runs automatically on:
- Pushes to `main`
- Pull requests to `main`

## Performance Considerations

- The `/api/generate` endpoint has a 60-second timeout to handle:
  - Concurrent autocomplete requests (dozens of small API calls)
  - Web scraping operations
  - AI ranking pass

If you're hitting timeouts locally, reduce `AUTOCOMPLETE_CONCURRENCY` / `MAX_AUTOCOMPLETE_SEEDS` in `lib/scrape.ts`.

## Debugging

### View logs
```bash
# Development server logs appear in terminal when running npm run dev
npm run dev
```

### Common Issues

**"Invalid ASIN"** - ASIN must be 10 characters (ISBN-10) or valid ISBN-13
**"Marketplace must be..."** - Ensure marketplace is one of: US, UK, CA, DE, FR, IT, ES
**"Timeout"** - Reduce concurrent requests in scrape.ts or increase maxDuration in route.ts

## Making Changes

### Code Style
- Use TypeScript for type safety
- Follow ESLint rules (auto-fixed with `npm run lint -- --fix`)
- Add JSDoc comments for complex logic
- Keep functions focused and testable

### Testing
Currently, the project has no test suite. This should be added via Jest + React Testing Library.

### Commits
Use clear, descriptive commit messages:
```
Add: New feature
Fix: Bug fix
Refactor: Code reorganization
Docs: Documentation updates
```

## Deployment

### Vercel (Recommended)
```bash
vercel deploy
```

### Docker
```bash
docker build -t amazon-ads-assistant .
docker run -p 3000:3000 amazon-ads-assistant
```

### Environment Setup for Deployment
Ensure these are set in your deployment platform:
- `APP_PASSWORD` (required)
- `AUTH_SECRET` (recommended, will auto-generate if not set)
- `AMAZON_ADS_*` (optional, for API features)
- `GEMINI_API_KEY` (optional, for AI ranking)
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (optional, for bulksheet archiving)

## Getting Help

- Check existing GitHub issues
- Review the README.md for feature documentation
- Check `.env.example` for configuration options
- Review error messages carefully — they usually indicate what's wrong
