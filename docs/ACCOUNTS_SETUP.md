# Turning on accounts (sign up / sign in, progress saved for every student)

The site is ready for accounts. They switch on as soon as `site/js/config.js` holds a Supabase project URL and
key. This takes about 10 minutes and is free (no card). Until then the site works as before, with progress
saved in each browser.

## 1. Create the free project

1. Go to <https://supabase.com>, sign up, and click **New project**.
2. Name it `mediorounds`, set a database password (keep it safe; the website never needs it), and pick the region
   closest to your students (for India, **Mumbai / ap-south-1**).
3. Wait about 2 minutes for it to start.

## 2. Create the table (one paste)

1. Left menu: **SQL Editor → New query**.
2. Paste the whole of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**. You should see "Success".

This creates one table, `progress`, with Row Level Security: each student can read and write only their own
row. It also adds a function so students can delete their own account.

## 3. Sign-in settings

**Authentication → URL Configuration**
- **Site URL:** `https://inzy0.github.io/MediORounds/site/`
- **Redirect URLs:** add `https://inzy0.github.io/MediORounds/site/` and `https://inzy0.github.io/MediORounds/site/#/account`

**Authentication → Sign In / Providers → Email:** leave Email enabled.

**About confirmation emails (your decision):**
- Supabase's built-in email sender is meant for testing and has a **low hourly limit**. Check the current figure
  in **Authentication → Rate Limits**. With many students signing up at once, some confirmation emails will be
  delayed.
- You have two options:
  - **Simplest:** turn off **Confirm email** (Authentication → Sign In / Providers → Email). Students are signed
    in straight after creating an account. The trade-off is that addresses aren't verified.
  - **Better for many students:** keep confirmation on and connect a free email service under
    **Project Settings → Authentication → SMTP Settings** (for example Brevo or Resend, which have free tiers).
- The "Email me a link" option and password reset also send email, so they share that limit.

## 4. Copy two values into the site

**Project Settings → API**:
- **Project URL**, which looks like `https://abcdefghijk.supabase.co`
- **Project API keys → `anon` `public`**, a long key starting `eyJ...`

Put them in `site/js/config.js`:

```js
export const SUPABASE_URL = "https://abcdefghijk.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

The `anon public` key is designed to be visible in a website, so it's fine to commit it. The table's Row Level
Security is what protects each student's data. **Never** put the `service_role` key in the site.

Commit and push, or send the two values and they'll be added for you.

## What students get

- A **Sign in** button in the header. Students can create an account (name, email, password), sign in, use a
  one-time email link, or reset a forgotten password.
- Progress (cases, scores, XP, badges, review deck, reflections, settings) is saved to their account about
  1.5 seconds after each change, and follows them to any device. A coloured dot shows the sync state.
- Progress from before signing in is added to the account at the first sign-in. Nothing is lost or counted twice.
- **Sign out** clears the progress from that browser (for shared lab computers). It stays safe in the account.
- On the **Account** page students can change their password or **delete their account and all its data**.

## What is stored, and limits

- Stored: email, chosen name, and learning progress. No patient data (the site refuses obvious identifiers).
- **Free tier:**
  - The database and monthly active users have generous caps. Check the current numbers on Supabase's pricing page.
  - Each student's progress is capped at about 2 MB by the table.
  - A free project **pauses after a period of inactivity** (about a week with no requests). Restore it from the
    dashboard, or upgrade to stop pausing.
- **Privacy law:** because the site now stores students' personal data (email and name), you are the data
  controller. For students in India this falls under the DPDP Act 2023. Add a short privacy notice and a
  contact for deletion requests before a wide launch. The in-app delete button covers self-service deletion.
