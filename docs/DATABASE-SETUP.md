# Database & Storage Setup Guide

## Quick Start (15 minutes)

### 1. Create Supabase Project

1. Go to https://supabase.com
2. Click "New Project"
3. Fill in:
   - **Project name:** amazon-ads-assistant
   - **Database password:** (save this!)
   - **Region:** (choose closest to you)
4. Wait for provisioning (~2 min)

### 2. Get API Keys

1. In Supabase dashboard, go to **Settings > API**
2. Copy these values:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Anon (public) key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Service role key** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ KEEP SECRET!)

### 3. Create `access_requests` Table

1. In Supabase, go to **SQL Editor**
2. Click **New Query**
3. Paste this SQL:

```sql
-- Create access_requests table for magic link auth
CREATE TABLE access_requests (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  decision_token TEXT,
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  notified_at TIMESTAMP WITH TIME ZONE,
  decided_at TIMESTAMP WITH TIME ZONE
);

-- Lowercase constraint for email case-insensitivity
ALTER TABLE access_requests 
ADD CONSTRAINT email_lowercase CHECK (email = LOWER(email));

-- Enable RLS (Row Level Security)
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

-- Policy: users can read their own row
CREATE POLICY "Users read own requests" ON access_requests
  FOR SELECT USING (auth.uid()::text = email OR email IS NULL);

-- Policy: service role can do everything
-- (this is implicit for service role, but being explicit is good practice)
```

4. Click **Run**
5. Verify table appears in **Editor > Tables**

### 4. Create Storage Bucket

1. In Supabase, go to **Storage**
2. Click **Create bucket**
3. Fill in:
   - **Bucket name:** `bulksheets`
   - **Privacy:** Private
4. Click **Create**

### 5. Set Up Resend (Email)

1. Go to https://resend.com
2. Sign up or log in
3. Go to **API Keys** and create a new key
4. Go to **Domains** and add/verify your domain:
   - Option A: Use `onboarding@resend.dev` (testing only, auto-verified)
   - Option B: Verify your own domain (production)

### 6. Create `.env.local`

In your project root, create `.env.local`:

```bash
# Supabase (from step 2)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# Auth security
AUTH_SECRET=$(openssl rand -base64 32)

# Email (Resend - from step 5)
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com
ADMIN_EMAIL=your-email@example.com

# Site URL (for email links)
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Optional APIs (add as needed)
# GEMINI_API_KEY=
# FIRECRAWL_API_KEY=
# GOOGLE_BOOKS_API_KEY=
# SCRAPER_PROXY_API_KEY=
```

⚠️ **Never commit `.env.local`!** It contains secrets.

### 7. Enable Auth

1. In Supabase, go to **Authentication > Providers**
2. Click **Email**
3. Under "Email Auth":
   - Toggle **Confirm email** OFF (for magic link simplicity)
   - Toggle **Secure email change** OFF
4. Under "Magic Link":
   - Expiry time: 24 hours (or your preference)
   - Click **Save**

### 8. Test Locally

```bash
npm run dev
# Visit http://localhost:3000
# Try to access /api/generate without logging in → should redirect to /login
# Enter your email → should get error if Resend isn't configured
# Check server logs for Resend API errors
```

---

## Troubleshooting

### "NEXT_PUBLIC_SUPABASE_URL is not set"

**Cause:** Missing `.env.local`

**Fix:** Create `.env.local` with all required variables. Restart dev server.

### Emails not sending

**Cause:** Resend API key invalid or domain not verified

**Fix:**
1. Check RESEND_API_KEY in `.env.local`
2. In Resend dashboard, verify domain shows "verified" status
3. Try sending from `onboarding@resend.dev` (always works)

### "Email already exists"

**Cause:** Email was previously marked 'denied' or 'approved'

**Fix:** In Supabase SQL Editor:
```sql
DELETE FROM access_requests WHERE email = 'your-email@example.com';
```

### "Column 'decision_token' does not exist"

**Cause:** Didn't run the full SQL schema

**Fix:** Re-run the SQL from step 3, or check if table has all columns

---

## Database Schema Reference

### access_requests

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `email` | text | PRIMARY KEY, lowercase | User identifier |
| `status` | text | pending\|approved\|denied | Access control |
| `decision_token` | text | nullable | Signed approval/denial link |
| `requested_at` | timestamp | DEFAULT now() | When sign-up initiated |
| `notified_at` | timestamp | nullable | When admin was emailed |
| `decided_at` | timestamp | nullable | When decision was made |

### Next: campaigns (Phase 3)

Plan a `campaigns` table to store generated campaign metadata:

```sql
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  name TEXT NOT NULL,
  marketplace TEXT DEFAULT 'US',
  daily_budget DECIMAL(10, 2),
  
  -- Generated keyword counts
  tropes_count INTEGER DEFAULT 0,
  comp_names_count INTEGER DEFAULT 0,
  product_targets_count INTEGER DEFAULT 0,
  
  -- Configuration snapshot
  match_type_strategy TEXT,
  config_json JSONB,
  
  -- Storage reference
  bulksheet_path TEXT,
  
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_asin ON campaigns(asin);
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at);
```

---

## Production Deployment

### Vercel Deployment

1. Push code to GitHub
2. Connect repo to Vercel
3. In Vercel settings > **Environment Variables**, add:
   - All values from `.env.local`
4. Deploy
5. Vercel automatically rebuilds on push

### Security Best Practices

- ✅ `SUPABASE_SERVICE_ROLE_KEY` is server-only (never in NEXT_PUBLIC_)
- ✅ `RESEND_API_KEY` is server-only
- ✅ `AUTH_SECRET` must be a long random string (`openssl rand -base64 32`)
- ✅ Never commit `.env.local` (add to `.gitignore`)
- ✅ Rotate `AUTH_SECRET` occasionally (invalidates existing tokens)

---

## Monitoring & Maintenance

### Check Database Health

```bash
# In Supabase SQL Editor:
SELECT COUNT(*) FROM access_requests WHERE status = 'pending';
SELECT COUNT(*) FROM access_requests WHERE status = 'approved';
```

### Clean Up Old Storage Files

```bash
# Supabase Storage supports lifecycle policies (enterprise plan)
# For now, manually delete old files from dashboard
# Path structure makes cleanup easy: /userId/YYYY/MM/DD/...
```

### Email Delivery Issues

- Check Resend dashboard for bounce rates
- Verify SPF/DKIM records if using custom domain
- Test with `onboarding@resend.dev` first (always works)

---

## Next Steps

1. ✅ Complete setup steps 1-8 above
2. ✅ Test sign-up and campaign generation
3. 📋 Implement campaign persistence table (Phase 3)
4. 📋 Add campaign history dashboard
5. 📋 Integrate Amazon Ads API for live sync (Phase 3)
