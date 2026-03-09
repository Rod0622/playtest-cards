# Playtest Forge (MTG Card Image Downloader + Price Database)

This project is a Next.js app that:

1) Downloads MTG card images (Scryfall links + Google Drive image links + direct image URLs)
2) Provides a **Supabase-backed price database** that can crawl supported stores and let you:
   - Search cards
   - Compare prices per store
   - Export CSV / XLSX / PDF
   - Copy rows into Google Sheets

## Pages

- `/` — Image Downloader
- `/database` — Card Price Database

## Supabase setup

1. Create a Supabase project
2. Open **SQL Editor**
3. Run: `supabase_schema.sql`

That will create:
- `stores`
- `cards`
- `listings`
- `price_history`
- `scrape_runs`

RLS is enabled with **public read-only** access.

## Environment variables

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY

# Used to protect the /api/scrape/run endpoint
SCRAPE_ADMIN_TOKEN=your_long_random_token
```

In Vercel: add the same env vars in **Project Settings → Environment Variables**.

## Running locally

```bash
npm install
npm run dev
```

## Triggering the crawler

Open `/database` and paste your `SCRAPE_ADMIN_TOKEN` into the Admin Token field.

Then click:
- **Scrape Contemporary Nook**
- **Scrape HeroHobbies**
- **Scrape All**

### Important note about High Market Online

`highmarketonline.shop` currently shows an anti-bot / captcha page.
This project will **not** bypass captchas.

Options:
- Ask the site owner to provide an API / export, or whitelist your crawler
- Or upload data manually (future enhancement)

## Exports

On `/database`:
- Export CSV
- Export XLSX
- Export PDF
- Copy → Google Sheets (TSV on clipboard)

## Deployment

- Push repo to GitHub
- Import project into Vercel
- Add env vars
- Deploy

(Optional) Use Vercel Cron to call `/api/scrape/run` periodically.
