# BADSHAH — Master Prompt for Google Anti Gravity AI
**Platform:** Badshah — Citizen Data Registration & Log System
**Target Builder:** Google Anti Gravity AI (Gemini-based code generation)
**Output Type:** Full-stack web application — Frontend HTML + Node.js/Express Backend + SQL Database

---

## SYSTEM CONTEXT

You are building a professional citizen data registration platform called **Badshah**. This is a clean, modern, government-style data entry and log management system. The platform must be fully functional, visually polished, and production-ready. Deliver three artefacts: (1) `badshah.html` — the frontend, (2) `server.js` — the Node.js/Express backend API, and (3) `schema.sql` — the complete SQL database schema.

---

## PLATFORM OVERVIEW

**Name:** Badshah
**Purpose:** Register citizen records including personal, contact, identification, and biometric data — and maintain a tamper-visible activity log of all submissions.
**Architecture:** Single-page application with two tabs (`Register` and `Log`) backed by a REST API and a relational SQL database.
**Data persistence:** PostgreSQL 15+ (primary). MySQL 8.0+ supported. SQLite for local dev only.

---

## UI/UX DESIGN SPECIFICATION

### Visual Language
- **Style:** Clean, minimal, government-grade — authoritative but approachable
- **Primary color:** Deep royal blue `#1A3A6B`
- **Accent:** Gold/amber `#D4A017` — used sparingly on active tabs, submit CTA, and focus rings
- **Background:** Off-white `#F5F7FA`
- **Card surface:** Pure white `#FFFFFF` with `1px solid #E2E8F0` border and `12px` border-radius
- **Error state:** `#DC2626` border + `#FEF2F2` background highlight on the field
- **Success state:** `#16A34A` toast notification
- **Font:** `'Inter', sans-serif` — load from Google Fonts
- **Body text:** 15px / 1.6 line-height
- **Heading:** 22px bold for platform name, 17px medium for section titles

### Layout
- Centered container, max-width `720px`, horizontally centered, `32px` vertical padding
- Platform logo/name `BADSHAH` in top-left of header — bold, royal blue, uppercase letter-spacing
- Header bar: white, `1px bottom border`, sticky
- Two tabs below header: `Register` | `Log` — pill-style tabs, active tab has gold underline + bold weight
- Form and log panel sit in a white card below tabs
- Mobile-responsive: stack all form fields to single column on screens < 600px

### Micro-interactions
- Input fields: smooth `0.2s` border-color transition on focus (blue border)
- Error fields: shake animation + red border + red helper text beneath the field
- Submit button: subtle scale `0.97` on press, disabled + spinner state while API call is in flight
- Log tab badge: show count of total entries as a small pill next to "Log" tab label
- Toast: slide-in from bottom-right, auto-dismiss after 3 seconds

---

## TAB 1 — REGISTER

### Form Fields (in order)

| Field | Type | Validation |
|---|---|---|
| Full Name | Text input | Required, min 3 chars, alphabets + spaces only |
| Mobile Number | Tel input | Required, exactly 10 digits, **UNIQUE KEY** |
| Aadhaar Number | Text input | Required, exactly 12 digits, **UNIQUE KEY** |
| Date of Birth | Date picker | Required, must be in the past, age ≥ 1 |
| Address | Textarea (3 rows) | Required, min 10 characters |
| Photo | File input (image/*) | Required, max 2MB, preview thumbnail shown after selection |

### Unique Key Enforcement Rules (CRITICAL)
1. On form submit, the frontend calls `POST /api/citizens/check` with the mobile and Aadhaar values before attempting the full save.
2. If the API returns `mobile_exists: true`:
   - Highlight the Mobile Number field with a red border + red background tint
   - Show an inline error message directly below the field: *"This mobile number is already registered."*
   - Do NOT submit the full form
   - Scroll to the field and focus it
3. If the API returns `aadhaar_exists: true`:
   - Highlight the Aadhaar Number field with a red border + red background tint
   - Show an inline error message directly below the field: *"This Aadhaar number is already registered."*
   - Do NOT submit the full form
4. If both are duplicates, show both errors simultaneously.
5. Uniqueness is also enforced at the database layer via UNIQUE constraints — the API must handle a `23505` (PostgreSQL) or `ER_DUP_ENTRY` (MySQL) error from the DB and return `409 Conflict` to the frontend if it fires.

### Photo Handling
- On file selection, show a circular 80×80px thumbnail preview directly below the file input
- Upload the photo as `multipart/form-data` to the backend
- Backend stores the file on disk (or S3) and saves the file path in the database column `photo_path`
- If no photo is selected, block submission with: *"Please upload a photo to continue."*

### Submit Button
- Label: `Register Citizen`
- Full-width, royal blue background, white text, 14px bold
- On successful API response (`201 Created`):
  - Clear all form fields and photo preview
  - Show bottom-right toast: `✓ Record saved successfully`
  - Auto-switch to the Log tab after 1.5 seconds
  - Increment the log tab badge count

### Form Reset
- Include a subtle `Clear form` text link below the submit button
- Clicking it resets all fields and removes the photo preview after confirmation: *"Clear all fields? This cannot be undone."*

---

## TAB 2 — LOG

### Purpose
Display all submitted citizen records fetched from the backend API in a searchable, paginated table.

### Log Table Columns
| Column | Content |
|---|---|
| # | Auto-increment serial number |
| Photo | Circular 40×40px thumbnail (loaded from backend file URL) |
| Name | Full name |
| Mobile | Masked: `XXXXXX1234` (last 4 digits visible) |
| Aadhaar | Masked: `XXXX XXXX 5678` (last 4 digits visible) |
| Date of Birth | Formatted as `DD MMM YYYY` |
| Address | Truncated to 40 chars with `…`; full text visible on hover tooltip |
| Registered At | Formatted as `DD MMM YYYY, HH:MM AM/PM` |

### Log Features
- **Search bar** at the top: calls `GET /api/citizens?search=<term>&page=<n>` on each keystroke (debounced 300ms)
- **Total count** displayed above table: `Total Records: N` (from API response)
- **Pagination:** 10 records per page; previous/next buttons
- **Empty state:** Centered placeholder with text: *"No records yet. Register the first citizen."*
- **Export CSV button:** Calls `GET /api/citizens/export` and triggers browser download

---

## DATABASE SCHEMA (`schema.sql`)

Generate a complete SQL file with the following:

```sql
-- ============================================================
-- BADSHAH — Citizen Registration Portal
-- Database: PostgreSQL 15+ (MySQL 8.0+ compatible with notes)
-- ============================================================

CREATE TABLE citizens (
  id            SERIAL PRIMARY KEY,
  full_name     VARCHAR(255)   NOT NULL,
  mobile        CHAR(10)       NOT NULL,
  aadhaar       CHAR(12)       NOT NULL,
  dob           DATE           NOT NULL,
  address       TEXT           NOT NULL,
  photo_path    VARCHAR(500),
  registered_at TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- Enforce uniqueness at DB layer (two-layer safety with app layer)
  CONSTRAINT uq_citizens_mobile  UNIQUE (mobile),
  CONSTRAINT uq_citizens_aadhaar UNIQUE (aadhaar)
);

-- Indexes for duplicate pre-checks and search
CREATE INDEX idx_citizens_mobile   ON citizens(mobile);
CREATE INDEX idx_citizens_aadhaar  ON citizens(aadhaar);
CREATE INDEX idx_citizens_name     ON citizens(full_name);
CREATE INDEX idx_citizens_reg_at   ON citizens(registered_at DESC);

-- Audit log: every INSERT/UPDATE/DELETE is recorded
CREATE TABLE audit_log (
  log_id      SERIAL PRIMARY KEY,
  citizen_id  INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  event_type  VARCHAR(50)  NOT NULL,   -- 'INSERT' | 'UPDATE' | 'DELETE'
  changed_by  VARCHAR(100),            -- operator username (future: auth layer)
  event_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  metadata    JSONB                    -- full row snapshot before/after
);

CREATE INDEX idx_audit_citizen ON audit_log(citizen_id);
CREATE INDEX idx_audit_event   ON audit_log(event_at DESC);

-- Trigger: auto-populate audit_log on new citizen INSERT
CREATE OR REPLACE FUNCTION log_citizen_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (citizen_id, event_type, metadata)
  VALUES (NEW.id, 'INSERT', row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_citizen_insert
AFTER INSERT ON citizens
FOR EACH ROW EXECUTE FUNCTION log_citizen_insert();
```

---

## BACKEND API (`server.js`)

Build a Node.js + Express REST API with the following endpoints. Use the `pg` package (node-postgres) for all database queries. Use parameterised queries exclusively — no string concatenation in SQL.

### Endpoints

#### `POST /api/citizens/check`
Pre-submission duplicate check.
- Body: `{ mobile, aadhaar }`
- Query:
  ```sql
  SELECT
    EXISTS(SELECT 1 FROM citizens WHERE mobile  = $1) AS mobile_exists,
    EXISTS(SELECT 1 FROM citizens WHERE aadhaar = $2) AS aadhaar_exists;
  ```
- Response: `200 OK` with `{ mobile_exists: bool, aadhaar_exists: bool }`

#### `POST /api/citizens`
Register a new citizen.
- Content-Type: `multipart/form-data`
- Fields: `full_name`, `mobile`, `aadhaar`, `dob`, `address`, `photo` (file)
- Steps:
  1. Validate all fields server-side (mirror frontend validation rules)
  2. Save photo file to `./uploads/` with a UUID filename
  3. Run duplicate check query
  4. If duplicate found, return `409 Conflict` with `{ error: "DUPLICATE_MOBILE" }` or `{ error: "DUPLICATE_AADHAAR" }`
  5. INSERT into `citizens` table
  6. Return `201 Created` with the saved record
- Handle DB `23505` unique violation error — map to `409 Conflict` as fallback

#### `GET /api/citizens`
Fetch paginated, searchable log.
- Query params: `search` (optional), `page` (default 1), `limit` (default 10)
- SQL:
  ```sql
  SELECT id, full_name, mobile, aadhaar, dob, address, photo_path, registered_at
  FROM   citizens
  WHERE  full_name ILIKE '%' || $1 || '%' OR mobile LIKE '%' || $1
  ORDER  BY registered_at DESC
  LIMIT  $2 OFFSET $3;
  ```
- Response: `{ records: [...], total: number, page: number, totalPages: number }`

#### `GET /api/citizens/export`
Export all records as CSV.
- Headers: `Content-Disposition: attachment; filename="badshah_export.csv"`
- Columns: Name, Mobile (unmasked), Aadhaar (unmasked), DOB, Address, Registered At
- Return as `text/csv` stream

#### Static file serving
Serve uploaded photos at `/uploads/:filename` from the `./uploads/` directory.

---

## SECURITY REQUIREMENTS

- All SQL uses parameterised queries — no interpolation.
- Validate photo MIME type server-side (accept only `image/jpeg`, `image/png`, `image/webp`).
- Reject photos larger than 2 MB at the multer middleware layer.
- Add a code comment: `// TODO (production): Encrypt Aadhaar values using AES-256 before storing`
- Set `helmet` middleware headers on all responses.
- Rate-limit `POST /api/citizens` to 30 requests per minute per IP.

---

## TECHNICAL REQUIREMENTS

- **Frontend:** Vanilla HTML + CSS + JavaScript — single `badshah.html` file; no build step; all API calls via `fetch()`
- **Backend:** Node.js + Express.js — `server.js`; dependencies: `express`, `pg`, `multer`, `helmet`, `express-rate-limit`, `uuid`
- **Database:** PostgreSQL 15+ (`schema.sql`)
- **No jQuery, no React, no Tailwind**
- The frontend must work correctly when served by the Express static middleware
- Include a `package.json` with all backend dependencies listed
- Include a `.env.example` with: `DATABASE_URL`, `PORT`, `UPLOAD_DIR`

---

## WHAT NOT TO DO

- Do NOT use `localStorage` for primary data persistence — all data goes to PostgreSQL.
- Do NOT use `SELECT *` in queries — always name columns explicitly.
- Do NOT concatenate user input into SQL strings — always use `$1, $2` parameterisation.
- Do NOT store raw Aadhaar numbers without the `// TODO: encrypt` comment.
- Do NOT use inline `onclick` attributes in HTML — use `addEventListener`.
- Do NOT use modal overlays.
- Do NOT use Bootstrap or any CSS framework — write all CSS from scratch per the design spec above.

---

## DELIVERABLES CHECKLIST

Generate the following files in order:

1. `schema.sql` — Complete PostgreSQL schema with tables, indexes, constraints, trigger
2. `server.js` — Node.js/Express API with all 4 endpoints, multer, pg, helmet, rate-limit
3. `package.json` — All dependencies with exact versions
4. `.env.example` — Environment variable template
5. `badshah.html` — Complete frontend with Register form, Log tab, all validations, API integration

**Begin generating `schema.sql` first, then `server.js`, then `badshah.html`.**
