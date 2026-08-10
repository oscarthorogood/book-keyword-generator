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

## Book & Keyword Endpoints

### POST /api/books/create

**Purpose:** Add a book. One identifier is all the caller supplies — everything
else is captured server-side.

**Request:**
```json
{
  "input": "https://www.amazon.co.uk/dp/B0BBL2ZW73",
  "marketplace": "US"
}
```

`input` accepts an Amazon product link, a bare ASIN, or an ISBN-10/13
(converted to the ISBN-10 Amazon uses as the ASIN for print books). `asin` is
accepted as an alias. `marketplace` is only read when the input is *not* a
link — a link states its own marketplace, and that wins.

**Side effects:** captures the book's full metadata snapshot (see
`lib/bookSnapshot.ts`) and stores it on `books.metadata_json`. This is the
single Amazon read per book; keyword generation reuses it.

**Response:**
```json
{
  "success": true,
  "book": { "id": "uuid", "asin": "B0BBL2ZW73", "title": "…", "author": "…" },
  "captureOk": true,
  "warning": null
}
```

**Error codes:**
- 400: input missing or not a recognisable link/ASIN/ISBN
- 401: not authenticated
- 409: book already in the library (response carries `bookId` — the client
  navigates to it rather than treating this as an error)

**Implementation:** `app/api/books/create/route.ts`

---

### POST /api/books/[id]/refresh

**Purpose:** Re-capture the book's Amazon metadata, replacing the stored
snapshot. Used when the first capture hit a bot check, or the listing changed.

**Response:** `{ success, book, captureOk, warning }`

**Implementation:** `app/api/books/[id]/refresh/route.ts`

---

### POST /api/books/[id]/keywords/generate

**Purpose:** Run the book's stored snapshot through every keyword source and
write the results into its keyword list.

**Request (all fields optional):**
```json
{
  "keyTropes": ["enemies to lovers", "small town"],
  "knownTags": ["cozy"],
  "keywordCategories": ["core-genre", "comp-titles"],
  "sources": ["autocomplete", "comp-name"],
  "defaultBid": 0.5
}
```

Snapshot-backed sources (comparable titles, reviews, Q&A, author catalogue,
genre metadata, Goodreads/Open Library/Google Books/Wikipedia/Wikidata/LoC)
read the stored capture. Live sources per run: the four autocomplete engines,
Datamuse synonyms, and the Ads API when configured. A snapshot that is missing
or stale is re-captured first.

**Response:**
```json
{
  "success": true,
  "generatedCount": 312,
  "insertedCount": 289,
  "alreadyPresentCount": 23,
  "contributingSources": ["autocomplete", "comp-name", "genre-metadata"],
  "bySource": { "autocomplete": 140 },
  "byCategory": { "core-genre": 12 },
  "byMatchType": { "phrase": 200, "broad": 60, "exact": 52 },
  "genreTerms": ["cozy mystery", "british detectives"],
  "aiRanked": false
}
```

**Error codes:**
- 401: not authenticated
- 404: book not found
- 422: the book's metadata couldn't be read, so there's nothing to generate
  from (`needsRefresh: true` — re-fetch the metadata first)
- 502: every source came back empty

**Implementation:** `app/api/books/[id]/keywords/generate/route.ts`

---

### GET/POST/PATCH/DELETE /api/books/[id]/keywords

**Purpose:** List, add, bulk-update and bulk-delete a book's keywords.

- `GET` — the book's keyword list.
- `POST` — `{ text, matchType? }` or `{ keywords: [{ text, matchType? }] }`.
- `PATCH` — `{ ids: string[], status?, matchType? }` for a bulk review pass.
- `DELETE` — `{ ids: string[] }`, or `{ all: true }` to clear the list.

**Implementation:** `app/api/books/[id]/keywords/route.ts`

---

### PATCH/DELETE /api/keywords/[id]

**Purpose:** Update or delete one keyword (status, match type, category, bid, text).

**Implementation:** `app/api/keywords/[id]/route.ts`

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
'/api/books/create': 30 per day per user      // each call is a full metadata capture
'/api/books/[id]/refresh': 10 per day per user
'/api/books/[id]/keywords/generate': 50 per day per user
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

### Add a Book
```bash
curl -X POST http://localhost:3000/api/books/create \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-token=..." \
  -d '{ "input": "https://www.amazon.com/dp/B0BBL2ZW73" }'
```

### Generate Keywords for a Book
```bash
curl -X POST http://localhost:3000/api/books/<book-id>/keywords/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-token=..." \
  -d '{ "keyTropes": ["unreliable narrator"] }'
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
