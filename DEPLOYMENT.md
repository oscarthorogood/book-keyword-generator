# Deployment Guide: Amazon Book Ads Builder

This guide walks you through deploying the application to Vercel with Supabase backend.

## Prerequisites

Before deploying, ensure you have:
- ✅ GitHub account with the repository pushed to `oscarthorogood/amazon-ads-assistant`
- ✅ Supabase project created (EU Central, project ID: `wzhfmzsqpuelvdjewvbu`)
- ✅ Resend account with API key configured
- ✅ Code merged to `main` branch

## Vercel Deployment Steps

### Step 1: Import Repository to Vercel

1. Go to https://vercel.com/new
2. Sign in with GitHub (or create a Vercel account if needed)
3. Click **"Import Git Repository"**
4. Search for `amazon-ads-assistant`
5. Select the repository from `oscarthorogood`
6. Click **"Import"**

### Step 2: Configure Project Settings

On the Vercel project setup page:

- **Project Name:** Keep default or customize
- **Framework Preset:** Next.js (should be auto-detected)
- **Root Directory:** Leave empty (uses repo root)

### Step 3: Add Environment Variables

Click **"Environment Variables"** and add each of these:

#### Required Supabase Auth Variables

```
NEXT_PUBLIC_SUPABASE_URL
Value: https://wzhfmzsqpuelvdjewvbu.supabase.co
```

```
NEXT_PUBLIC_SUPABASE_ANON_KEY
Value: sb_publishable_UYJdQCuJylgRFionZdYC9Q_SHWQAMdl
```

```
SUPABASE_SERVICE_ROLE_KEY
Value: sb_secret_lxy6hvngqgFR1iDSTedgaQ_XEnUqppZ
```

#### Auth & Security Variables

```
AUTH_SECRET
Value: 8f4e9c2d7a1b5f3e6c9a2b4d7e0f1a3c5b7d9e1f3a5c7d9e1f3a5c7d9e1f3a
```

#### Email Delivery Variables

```
RESEND_API_KEY
Value: re_QRGB2ja4_9g3CsgXGhDyo6aTH4RWV34Lp
```

```
EMAIL_FROM
Value: oscarthorogood@icloud.com
```

```
ADMIN_EMAIL
Value: oscarthorogood@icloud.com
```

#### Site Configuration (Update After Deployment)

```
NEXT_PUBLIC_SITE_URL
Value: (Leave empty for now - update after deployment gets your domain)
```

#### Optional: Amazon Ads Integration

```
AMAZON_ADS_CLIENT_ID
Value: (Get from Amazon Ads console)
```

```
AMAZON_ADS_CLIENT_SECRET
Value: (Get from Amazon Ads console)
```

```
AMAZON_ADS_REFRESH_TOKEN
Value: (Get from Amazon Ads OAuth flow)
```

```
AMAZON_ADS_PROFILE_ID
Value: (Get from Amazon Ads console)
```

#### Optional: AI & Data Enrichment

```
GEMINI_API_KEY
Value: (Get from Google AI Studio - optional, for AI ranking)
```

```
GOOGLE_BOOKS_API_KEY
Value: (Get from Google Books API console - optional)
```

```
SCRAPER_PROXY_API_KEY
Value: (Get from ScraperAPI - optional, for product page scraping)
```

```
SCRAPINGBEE_API_KEY
Value: (Get from ScrapingBee - optional, alternative to SCRAPER_PROXY_API_KEY; takes priority if both are set)
```

```
FIRECRAWL_API_KEY
Value: (Get from Firecrawl - optional, for page extraction)
```

### Step 4: Deploy

1. Click **"Deploy"**
2. Wait for the build to complete (takes 2-3 minutes)
3. Once complete, you'll see your deployment URL:
   - Example: `https://amazon-ads-assistant.vercel.app`

## Post-Deployment Configuration

### Step 5: Update Supabase Auth Redirects

After Vercel finishes deploying and you have your domain:

1. Go to Supabase Dashboard: https://wzhfmzsqpuelvdjewvbu.supabase.co
2. Navigate to **Settings > Authentication > URL Configuration**
3. Click **"Redirect URLs"** or **"Email Templates"**
4. Add these redirect URLs (replace `your-domain` with your actual Vercel domain):

```
https://your-domain.vercel.app/auth/confirm
https://your-domain.vercel.app/
```

5. Click **"Save"**

### Step 6: Update Environment Variable in Vercel

1. Go back to Vercel: https://vercel.com/dashboard
2. Click on your `amazon-ads-assistant` project
3. Go to **Settings > Environment Variables**
4. Find `NEXT_PUBLIC_SITE_URL` and update it:

```
NEXT_PUBLIC_SITE_URL
Value: https://your-domain.vercel.app
```

5. Click **"Save"**
6. Go to **Deployments** and redeploy the latest commit to pick up the new variable:
   - Click the three dots on the latest deployment
   - Click **"Redeploy"**

## Testing the Deployment

After deployment and configuration:

1. Go to your Vercel domain: `https://your-domain.vercel.app`
2. You should see the login page
3. Try signing in:
   - Enter your email: `oscarthorogood@icloud.com`
   - Check for approval request email
   - Approve yourself
   - Click the magic link in the confirmation email
   - You should be signed in to the app
4. Test generating a bulksheet:
   - Fill out the form with an ASIN
   - Click "Generate"
   - You should receive the bulksheet via email

## Troubleshooting

### "Authentication is not configured"
- Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in Vercel
- Redeploy after adding environment variables

### Emails not arriving
- Verify RESEND_API_KEY is correct
- Check Supabase Email Provider is set to custom SMTP with Resend
- Verify EMAIL_FROM is a verified sender in Resend

### Magic link not working
- Ensure Supabase Auth redirect URLs match your Vercel domain
- Check that redirect URLs are saved in Supabase
- Try redeploy in Vercel after updating Supabase redirects

### Admin console not accessible
- Verify you're signed in with the ADMIN_EMAIL
- Check browser console for errors
- Verify RLS policies were created in Supabase

## Additional Resources

- **Vercel Docs:** https://vercel.com/docs
- **Next.js Deployment:** https://nextjs.org/docs/deployment/vercel
- **Supabase Deployment:** https://supabase.com/docs/guides/hosting/overview
- **Environment Variables:** https://vercel.com/docs/environment-variables

## Support

If you encounter issues:
1. Check the Vercel deployment logs: **Deployments > Click deployment > Logs**
2. Check Supabase project logs: **Project > Logs**
3. Check browser console for client-side errors (F12)
