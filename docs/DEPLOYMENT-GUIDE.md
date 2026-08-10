# Deployment Guide

## Architecture Overview

```
┌─────────────────┐
│   User Browser  │
└────────┬────────┘
         │
         ├─ /login → Email input → /api/auth/magic-link
         │                             ↓
         │                      [Resend email]
         │                             ↓
         │          [Magic link in email] → /auth/confirm
         │                             ↓
         ├─ /admin → Admin dashboard → /api/admin/access
         │
         └─ / → Campaign form → /api/generate → [Excel bulksheet]
                                       ↓
                              [Supabase Storage]

┌──────────────────┐
│     Supabase     │
├──────────────────┤
│ • auth.users     │ ← Magic link via Supabase Auth
│ • access_requests│ ← Allowlist table
│ • campaigns      │ ← Campaign history (Phase 3)
│ • Storage bucket │ ← Bulksheet archives
└──────────────────┘
```

## Deployment Checklist

### Local Development

- [x] Build succeeds: `npm run build`
- [x] All dependencies installed: `npm install`
- [x] TypeScript strict mode passes
- [ ] Create `.env.local` with API keys
- [ ] Database tables created in Supabase
- [ ] Storage bucket created in Supabase
- [ ] Start dev server: `npm run dev`
- [ ] Test sign-in flow
- [ ] Test campaign generation
- [ ] Test bulksheet download

### Production (Vercel)

1. **Connect repository to Vercel**
   ```
   vercel git connect
   ```

2. **Set environment variables in Vercel dashboard**
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   RESEND_API_KEY
   EMAIL_FROM
   ADMIN_EMAIL
   AUTH_SECRET (must be long random string)
   NEXT_PUBLIC_SITE_URL (your domain)
   ```

3. **Enable automatic deployments**
   - Vercel auto-deploys on push to main

4. **Set up Supabase for production**
   - Use dedicated Supabase project
   - Run SQL initialization scripts
   - Set up backups

5. **Verify email configuration**
   - Update Resend domain configuration
   - Test email delivery with live domain

## Security Checklist

### Secrets Management

- [x] `SUPABASE_SERVICE_ROLE_KEY` is server-only (never in NEXT_PUBLIC_)
- [x] `RESEND_API_KEY` is server-only
- [x] `AUTH_SECRET` is random 32+ bytes
- [ ] `.env.local` is in `.gitignore` (never committed)
- [ ] All secrets rotated periodically

### Database Security

- [x] Row-Level Security (RLS) enabled on all tables
- [x] `access_requests` table has email-based policies
- [x] Storage bucket is private (no public access)
- [ ] Regular backups enabled in Supabase

### API Security

- [x] All routes validate input format
- [x] Email validation prevents injection
- [x] HMAC signatures on approval/denial links
- [x] Email hashing prevents enumeration
- [ ] Rate limiting on `/api/auth/magic-link` (optional)
- [ ] CORS configured for your domain

## Performance Optimization

### Database

- [x] Indexes on frequently queried columns:
  - `access_requests(status)`
  - `access_requests(requested_at DESC)`
  - `campaigns(user_id, created_at DESC)`

### Caching

- Keyword cache: In-memory SHA256 fingerprinting
- Author code cache: Deterministic generation
- Storage: Signed URLs cached for 1 hour

### Build Optimization

```bash
# Production build
npm run build

# Output: .next/ directory (optimized)
# Size: ~2-3 MB (mostly Next.js runtime)
```

## Monitoring & Logging

### Application Logs

```bash
# View Vercel logs
vercel logs

# View build logs
vercel logs --build
```

### Database Monitoring

In Supabase dashboard:
- Monitor query performance
- Check database size
- Review slow queries
- Monitor auth rate limits

### Email Delivery

In Resend dashboard:
- Monitor delivery rate
- Check bounce/spam rates
- Verify DKIM/SPF records
- Review API usage

## Rollback Procedures

### Database Schema

All database changes are idempotent (use `IF NOT EXISTS`):
```sql
-- Safe to re-run
CREATE TABLE IF NOT EXISTS access_requests (...)
CREATE INDEX IF NOT EXISTS idx_access_requests_status (...)
```

To rollback, drop the table (all data lost):
```sql
DROP TABLE access_requests;
```

### Code Deployment

Vercel maintains previous deployments:
```bash
# View deployment history
vercel deployments

# Rollback to previous version
vercel rollback <deployment-id>
```

## Troubleshooting

### Email Not Sending

**Symptom:** "Email not configured" error

**Solution:**
1. Check RESEND_API_KEY in environment variables
2. Verify sender email is verified in Resend dashboard
3. Check server logs for API errors
4. Try with `onboarding@resend.dev` (always works)

### "Email already exists" Error

**Symptom:** Can't sign up with an email

**Solution:**
```sql
DELETE FROM access_requests WHERE email = 'user@example.com';
```

### Supabase Connection Failed

**Symptom:** "Could not connect to database"

**Solution:**
1. Verify NEXT_PUBLIC_SUPABASE_URL format
2. Check SUPABASE_SERVICE_ROLE_KEY is correct
3. Verify Supabase project is active
4. Check if IP is whitelisted (if applicable)

### Build Fails with Type Errors

**Solution:**
```bash
npm run build  # See detailed errors
npm run type-check  # Check types only
```

## Feature Flags (Optional)

For A/B testing or gradual rollout:

```typescript
// lib/features.ts
export const features = {
  matchTypeStrategy: process.env.FEATURE_MATCH_TYPE === 'true',
  budgetCapping: process.env.FEATURE_BUDGET_CAPPING === 'true',
  campaignPersistence: process.env.FEATURE_PERSISTENCE === 'true',
};
```

## Analytics Setup (Optional)

Add tracking with Vercel Web Analytics or PostHog:

```bash
# Vercel Web Analytics (built-in, no config needed)
# Just enable in Vercel dashboard
```

## Maintenance Tasks

### Weekly
- Monitor error rates in logs
- Check email delivery metrics
- Review database performance

### Monthly
- Audit access requests (approve/deny backlog)
- Check storage usage
- Review API rate limits

### Quarterly
- Rotate `AUTH_SECRET`
- Update dependencies: `npm update`
- Security audit of environment variables

## Disaster Recovery

### Data Backup

Supabase provides automated backups:
- Default: 7-day retention
- Upgrade to: 30-day retention (paid)

To backup manually:
```bash
# Export from Supabase dashboard
# Database > Backups > Download
```

### Secrets Recovery

If an API key is compromised:
1. Immediately rotate in the service (Supabase, Resend)
2. Update environment variables
3. Redeploy application
4. Monitor for suspicious activity

## Cost Optimization

### Supabase Pricing

- Database: Free tier (500 MB)
- Storage: Free tier (1 GB)
- API calls: Unlimited on free tier
- Backup: Included

For production:
- Pro: $25/month + overage
- Typical usage: ~$25-50/month

### Resend Pricing

- 100 emails/day free
- $0.20 per email above free tier
- Typical usage: ~$5-20/month

### Vercel Hosting

- Free tier: Plenty for this app
- Pro: $20/month if scaling needed
- Typical usage: ~Free-$20/month

**Total estimated cost:** $30-90/month for production

## Launch Checklist

- [ ] All environment variables set in Vercel
- [ ] Supabase project created and initialized
- [ ] Resend account configured with verified domain
- [ ] `.env.local` created locally for testing
- [ ] All SQL scripts executed in Supabase
- [ ] Storage bucket created and policies applied
- [ ] Sign-in flow tested end-to-end
- [ ] Campaign generation tested
- [ ] Admin approval flow tested
- [ ] Email delivery verified
- [ ] Build succeeds: `npm run build`
- [ ] No TypeScript errors: `npm run type-check`
- [ ] Pushed to main branch
- [ ] Connected to Vercel
- [ ] Environment variables set in Vercel
- [ ] Deployment successful
- [ ] Test prod URL with real email

## Support & Documentation

- **Setup Guide:** `docs/DATABASE-SETUP.md`
- **Database Status:** `docs/DATABASE-STATUS.md`
- **API Routes:** `app/api/*/route.ts`
- **Core Logic:** `lib/` directory
- **Components:** `components/` directory
