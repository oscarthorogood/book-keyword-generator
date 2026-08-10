# Database & Storage System Status

## Current Configuration

### Supabase (Required)
**Status:** ⚠️ **NOT CONFIGURED** (Environment variables missing)

Required environment variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Public/anonymous key (browser-safe)
- `SUPABASE_SERVICE_ROLE_KEY` - Server-only administrative key

### Email (Resend - Required)
**Status:** ⚠️ **NOT CONFIGURED** (Environment variables missing)

Required environment variables:
- `RESEND_API_KEY` - Resend API key
- `EMAIL_FROM` - Verified sender email
- `ADMIN_EMAIL` - Admin approval email address

### Optional API Keys
**Status:** ❌ **NOT CONFIGURED** (but not required for basic operation)

- Google Books API Key
- Gemini API Key (for AI-powered keyword ranking)
- Firecrawl API Key (for rich text extraction)
- ScraperAPI Key (for residential proxy access)

---

## Database Tables

### 1. access_requests (REQUIRED)
**Status:** ⚠️ **REQUIRES SETUP IN SUPABASE**

**Purpose:** Magic link authentication & access control

**Fields:**
```
- email (text) - User email address (PRIMARY KEY)
- status (enum) - 'pending' | 'approved' | 'denied'
- decision_token (text, nullable) - HMAC-signed decision link token
- requested_at (timestamp) - When user first requested access
- notified_at (timestamp, nullable) - When admin was emailed
- decided_at (timestamp, nullable) - When access decision was made
```

**Current Usage:**
- Sign-in gate: first-time users are recorded as 'pending'
- Admin receives approve/deny links via email
- Users must be 'approved' status to receive login links
- Tracks request history and admin notification state

---

## File Storage

### Supabase Storage - "bulksheets" Bucket
**Status:** ⚠️ **REQUIRES SETUP IN SUPABASE**

**Purpose:** Archive generated campaign bulksheets

**Configuration:**
- Bucket name: `bulksheets`
- Privacy: PRIVATE (no public access)
- TTL on download links: 1 hour
- Path structure: `{userId}/{YYYY}/{MM}/{DD}/{uuid}-{campaign}.xlsx`

**Current Implementation:**
- `lib/supabaseStorage.ts` - Upload & signing logic
- Archiving is best-effort (never blocks generation)
- Returns 1-hour signed download URL to user
- Falls back gracefully if Storage is unavailable

---

## Dependency Map

```
API Routes
├── /api/generate (Campaign generation)
│   └── Uses: supabaseStorage (optional archive)
├── /api/login (Sign-in initiation)
│   └── Uses: accessRequests (required)
├── /api/auth/approve (Approval/denial)
│   └── Uses: accessRequests + Supabase Auth + Resend
└── /api/auth/magic-link (Magic link generation)
    └── Uses: Supabase Auth + Resend

Components
├── CampaignGenerationForm
│   └── Uses: /api/generate, /api/lookup
└── CampaignsDashboard (currently mock data)
    └── Awaiting: Campaign persistence table
```

---

## What's Working (Phase 1/2)

✅ Campaign keyword generation (15+ sources, deterministic)
✅ Match-type strategy selection & cost modeling
✅ Budget-aware keyword capping (algorithm implemented)
✅ Bulksheet Excel export (local download)
✅ Form UX/UI with progress tracking

---

## What Requires Setup

### Required for Production
1. **Supabase project creation**
   - Project URL & API keys
   - Create `access_requests` table with schema
   - Enable auth with magic link provider

2. **Supabase Storage**
   - Create `bulksheets` private bucket
   - Set up object lifecycle (optional: expire old files)

3. **Resend account**
   - Create API key
   - Verify sender email domain/address
   - Test email delivery

4. **Environment variables**
   - Create `.env.local` with all required keys
   - Auth, Supabase, Resend, optional APIs

### Optional for Enhanced Functionality
- Google Books API (keyword enrichment)
- Gemini API (AI keyword ranking)
- Firecrawl API (rich text extraction)
- ScraperAPI (residential proxy for scraping)

---

## Next Phase: Campaign Persistence

**Currently:** Campaigns are generated but not persisted  
**Needed:** Database table to store campaign metadata

Proposed schema:
```sql
CREATE TABLE campaigns (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  asin TEXT NOT NULL,
  name TEXT NOT NULL,
  bulksheet_path TEXT, -- Reference to storage archive
  keywords_json JSONB, -- Keyword sets per ad group
  config_json JSONB, -- Form inputs for re-running
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at);
```

---

## Testing Checklist

- [ ] Create Supabase project
- [ ] Create `access_requests` table
- [ ] Enable Supabase Auth (magic link)
- [ ] Create `bulksheets` storage bucket
- [ ] Set up Resend account & API key
- [ ] Populate `.env.local`
- [ ] Test sign-up flow
- [ ] Test campaign generation
- [ ] Verify bulksheet storage archive
- [ ] Test download link
- [ ] Verify email delivery
- [ ] Test access approval/denial flow

---

## Documentation

For detailed setup instructions, see [DATABASE-SETUP.md](./DATABASE-SETUP.md)
