# API Reference

## Authentication Endpoints

### POST /api/auth/magic-link

**Purpose:** Initiate sign-in with email

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Responses:**
- If approved: Sends magic link email
- If pending: Records request, emails admin approve/deny links
- If denied: Silent response (prevents enumeration)

**Public response:** "If that address has access, a sign-in link is on its way."

**Error codes:**
- 400: Invalid email format
- 500: Resend API error (logs to console)

**Implementation:** `app/api/auth/magic-link/route.ts`

---

### POST /api/auth/approve

**Purpose:** Admin approves/denies access requests

**Request:**
```json
{
  "email": "user@example.com",
  "action": "approve",  // or "deny"
  "signature": "hmac-signature"
}
```

**Authentication:** HMAC-signed token (sent in email links)

**Responses:**
- 200: Decision recorded
- 400: Invalid request or signature
- 404: Access request not found

**Effects:**
- Approve: Sets status to 'approved', user can now receive magic links
- Deny: Sets status to 'denied', user is blocked

**Implementation:** `app/api/auth/approve/route.ts`

---

### GET /auth/confirm

**Purpose:** Complete magic link flow (called from email link)

**Query Parameters:**
- `code` (required): Magic link token from Supabase Auth
- `next` (optional): Redirect URL after sign-in

**Flow:**
1. User clicks magic link in email
2. Browser calls this endpoint with code
3. Code is exchanged for session
4. User is redirected to `next` or home

**Implementation:** `app/auth/confirm/route.ts`

---

### POST /api/logout

**Purpose:** Sign out current user

**Request:** No body required

**Response:** 200 OK, session cleared

**Implementation:** `app/api/logout/route.ts`

---

## Campaign Generation Endpoints

### POST /api/generate

**Purpose:** Generate campaign keywords and bulksheet

**Request:**
```json
{
  "asin": "B0BBL2ZW73",
  "authorName": "Freida McFadden",
  "seriesName": "Haven's End Series",
  "bookTitle": "Never Lie",
  "marketplace": "US",
  "matchTypeStrategy": "phrase-exact",  // "phrase-only" | "phrase-exact" | "all"
  "dailyBudget": 5.00,
  "sources": {
    "tropesKeywords": true,
    "competitorNames": true,
    "productTargets": true,
    // ... other sources
  }
}
```

**Authentication:** Required (user session or magic link)

**Response:**
```json
{
  "success": true,
  "summary": {
    "tropesCount": 25,
    "competitorNamesCount": 15,
    "productTargetCount": 10,
    "totalRows": 150,
    "generatedAt": "2024-08-10T10:30:00Z",
    "downloadUrl": "https://...(signed URL)",
    "expiresAt": "2024-08-10T11:30:00Z"
  },
  "metadata": {
    "campaignName": "PB_FM_B0BBL2ZW73_Freida_McFadden_Never_Lie_US_SPM_1",
    "estimatedDailySpend": 2.50
  }
}
```

**Error codes:**
- 400: Invalid request (missing fields, invalid ASIN, etc.)
- 401: Not authenticated
- 500: Generation failed (logs error details)

**Side effects:**
- Generates Excel bulksheet
- Archives to Supabase Storage (best-effort, doesn't block)
- Creates signed download URL (1 hour TTL)

**Implementation:** `app/api/generate/route.ts`

---

### GET /api/lookup

**Purpose:** Metadata lookup (book details, competitor info, etc.)

**Query Parameters:**
- `asin` (required): Product ASIN
- `marketplace` (optional): Market code (default: "US")

**Response:**
```json
{
  "asin": "B0BBL2ZW73",
  "title": "Never Lie",
  "author": "Freida McFadden",
  "marketplaceData": {
    "price": 14.99,
    "rating": 4.5,
    "reviews": 8234
  }
}
```

**Error codes:**
- 400: Invalid ASIN
- 404: Book not found
- 500: Lookup service error

**Implementation:** `app/api/lookup/route.ts`

---

## Admin Endpoints

### GET /api/admin/access

**Purpose:** View all access requests

**Query Parameters:**
- `status` (optional): Filter by status ("pending", "approved", "denied")
- `limit` (optional): Max results (default: 50)

**Authentication:** Admin only (checks ADMIN_EMAIL)

**Response:**
```json
{
  "requests": [
    {
      "email": "user@example.com",
      "status": "pending",
      "requestedAt": "2024-08-10T09:00:00Z",
      "approveLink": "https://.../admin?email=...&action=approve&sig=...",
      "denyLink": "https://.../admin?email=...&action=deny&sig=..."
    }
  ],
  "summary": {
    "pending": 3,
    "approved": 12,
    "denied": 2
  }
}
```

**Implementation:** `app/api/admin/access/route.ts`

---

## Error Handling

All endpoints follow consistent error format:

```json
{
  "error": "Description of what went wrong",
  "code": "ERROR_CODE",
  "details": "Optional technical details"
}
```

**Common error codes:**
- `INVALID_EMAIL`: Email format validation failed
- `NOT_FOUND`: Resource not found
- `UNAUTHORIZED`: User not authenticated
- `FORBIDDEN`: User lacks permission
- `RATE_LIMIT`: Too many requests
- `EXTERNAL_API_ERROR`: Third-party service failed (Resend, Supabase, etc.)

---

## Authentication Flow

### Complete Sign-In Flow

```
User visits /login
    ↓
Enters email
    ↓
POST /api/auth/magic-link { email }
    ↓
    ├─ If status='approved': Supabase sends magic link email
    └─ If new: Creates pending, emails admin
    ↓
User clicks link in email
    ↓
GET /auth/confirm?code=...
    ↓
Session created
    ↓
Redirect to home (authenticated)
```

### Admin Approval Flow

```
New user signs up with email
    ↓
Admin receives email with approve/deny links
    ↓
Admin clicks approve link
    ↓
POST /api/auth/approve { email, action: 'approve', signature }
    ↓
User status updated to 'approved'
    ↓
User can now sign in
```

---

## Rate Limits (Recommended)

Current implementation has no built-in rate limiting. For production, add:

```typescript
// Suggested limits
'/api/auth/magic-link': 5 per minute per IP
'/api/generate': 10 per day per user
'/api/lookup': 100 per day per user
```

---

## Response Headers

All responses include:

```
Content-Type: application/json
X-Content-Type-Options: nosniff
Cache-Control: no-cache, no-store
```

---

## Example cURL Commands

### Generate Campaign
```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-token=..." \
  -d '{
    "asin": "B0BBL2ZW73",
    "authorName": "Freida McFadden",
    "seriesName": "Haven'"'"'s End",
    "bookTitle": "Never Lie",
    "marketplace": "US",
    "matchTypeStrategy": "phrase-exact",
    "dailyBudget": 5.00,
    "sources": { "tropesKeywords": true }
  }'
```

### Request Sign-In
```bash
curl -X POST http://localhost:3000/api/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

### Admin Access Requests
```bash
curl http://localhost:3000/api/admin/access?status=pending \
  -H "Cookie: auth-token=..."
```

---

## Monitoring & Debugging

### Enable Debug Logging

Set environment variable:
```bash
DEBUG=amazon-ads:* npm run dev
```

### Check Server Logs

```bash
# Vercel production logs
vercel logs

# Local dev server (console output)
# Watch for:
# - [api-route] Performance metrics
# - [error] Any exceptions
# - [resend] Email delivery status
```

### Database Query Debugging

In Supabase dashboard:
- SQL Editor: Run manual queries
- Logs: View query performance
- Database: Monitor size and connections

---

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (client error) |
| 401 | Unauthorized (not logged in) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 429 | Too many requests (rate limited) |
| 500 | Server error |
| 503 | Service unavailable (external API down) |
