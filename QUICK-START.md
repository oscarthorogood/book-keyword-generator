# Quick Start Guide

## 🚀 Get Running in 15 Minutes

Everything is built and ready to go. Just configure your API keys.

### Prerequisites
- Node.js 18+ (already installed)
- npm or yarn
- Supabase account (free tier works)
- Resend account (free tier works)

### Step 1: Get Your API Keys (5 minutes)

**Supabase:** https://supabase.com
1. Create a project (or use existing)
2. Go to Settings > API
3. Copy: Project URL, Anon Key, Service Role Key

**Resend:** https://resend.com
1. Create account (or sign in)
2. Create API Key
3. Verify sender email (use `onboarding@resend.dev` for testing)

**Auth Secret:** Generate a random key
```bash
openssl rand -base64 32
```

### Step 2: Create `.env.local` (2 minutes)

Run the interactive setup script:
```bash
bash /tmp/setup-env.sh
```

Or create manually (copy from `.env.example`):
```bash
cp .env.example .env.local
# Edit .env.local with your keys
```

### Step 3: Validate Configuration (1 minute)

```bash
bash /tmp/validate-setup.sh
```

Expected output:
```
✓ .env.local found
✓ NEXT_PUBLIC_SUPABASE_URL
✓ NEXT_PUBLIC_SUPABASE_ANON_KEY
✓ SUPABASE_SERVICE_ROLE_KEY
✓ RESEND_API_KEY
✓ EMAIL_FROM
✓ ADMIN_EMAIL
✓ AUTH_SECRET
✓ Supabase connection successful
✓ Resend connection successful
```

### Step 4: Initialize Database (5 minutes)

In Supabase dashboard:

1. **Create Access Requests Table**
   - Go to SQL Editor
   - Click "New Query"
   - Paste content from `sql/01-access-requests-table.sql`
   - Click Run

2. **Create Storage Policies**
   - Go to SQL Editor
   - Click "New Query"
   - Paste content from `sql/02-storage-bucket-policies.sql`
   - Click Run

3. **Create Storage Bucket**
   - Go to Storage
   - Click "Create bucket"
   - Name: `bulksheets`
   - Privacy: `Private`
   - Click Create

### Step 5: Start Development (1 minute)

```bash
npm run dev
```

Visit: http://localhost:3000

### Step 6: Test the Flow (1 minute)

1. Click "Try Now" or go to `/login`
2. Enter your email
3. Check email for magic link (or check Resend dashboard)
4. Click magic link
5. You're signed in!
6. Generate a campaign

---

## 📚 Full Documentation

- **Setup Details:** `docs/DATABASE-SETUP.md`
- **API Endpoints:** `docs/API-REFERENCE.md`
- **Deployment:** `docs/DEPLOYMENT-GUIDE.md`
- **Architecture:** `docs/ARCHITECTURE.md`
- **Troubleshooting:** `docs/DATABASE-STATUS.md`

---

## ✨ Features

### Campaign Generation
- 15+ keyword sources (tropes, competitors, product targets)
- Multi-source ad group organization
- Amazon Ads bulksheet format (Excel export)
- Real-time keyword count estimation

### Budget Optimization
- 3 match-type strategies (phrase-only, phrase-exact, all)
- Cost modeling with row multipliers
- Budget-aware keyword capping
- Estimated daily spend projection

### UX/UI
- 6-page form with progress tracking
- Real-time budget calculator
- Strategy impact explanation
- Professional results dashboard
- Mobile-responsive design

### Authentication
- Magic link sign-in
- Email-based allowlist
- Admin approval workflow
- Role-based access control
- HMAC-signed tokens

---

## 🔧 Common Tasks

### Check if everything is working
```bash
npm run type-check  # Type checking
npm run build       # Full build
npm run dev         # Start server
```

### Debug environment issues
```bash
# Check if .env.local is loaded
grep NEXT_PUBLIC_SUPABASE_URL .env.local

# Test Supabase connection
curl -X GET https://your-project.supabase.co/rest/v1/ \
  -H "Authorization: Bearer your-anon-key"

# Test Resend connection
curl -X GET https://api.resend.com/domains \
  -H "Authorization: Bearer your-resend-key"
```

### Reset database (if needed)
```sql
-- In Supabase SQL Editor
DELETE FROM access_requests WHERE email = 'your-email@example.com';
```

---

## ❓ Troubleshooting

### "NEXT_PUBLIC_SUPABASE_URL is not set"
→ Create .env.local with all required variables

### "Email already exists" error
→ Delete from database: `DELETE FROM access_requests WHERE email = '...';`

### Emails not sending
→ Check Resend dashboard, verify sender email is approved

### Build fails
→ Run: `npm install` to ensure dependencies are installed

### Magic link not working
→ Check if Supabase Auth is enabled (Settings > Authentication > Email)

---

## 📊 What's Included

✅ Campaign keyword generation from 15+ sources  
✅ Match-type strategy selection with cost modeling  
✅ Budget-aware keyword capping algorithm  
✅ Excel bulksheet generation (Amazon Ads format)  
✅ Multi-page form with progress tracking  
✅ Real-time budget calculations  
✅ Professional dashboard with onboarding  
✅ Magic link authentication  
✅ Email-based access control  
✅ Admin approval system  
✅ Full API documentation  
✅ Deployment guides  
✅ TypeScript strict mode  
✅ Production-ready code  

---

## 🚀 Next Steps

After everything is working:

1. **Customize email templates** (in `lib/email.ts`)
2. **Add your company branding** (update colors, logo, etc.)
3. **Deploy to Vercel** (push to main, connect repo)
4. **Set up monitoring** (Vercel logs, Supabase monitoring)
5. **Add optional features** (AI keyword ranking, rich text extraction)

---

## 📞 Support

- Check `docs/` directory for detailed guides
- Review `.env.example` for all available options
- Test scripts in `/tmp/` for validation

---

**That's it!** 🎉

Your Amazon Ads campaign generator is ready to use. All code is production-ready, documented, and tested.

Start with: `npm run dev`
