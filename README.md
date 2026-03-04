# Playtest Forge — MTG Card Image Downloader

Bulk download MTG playtest card images from Scryfall links, organized by customer.

## Quick Deploy to Vercel

### Step 1: Push to GitHub

```bash
cd playtest-forge
git init
git add .
git commit -m "Initial commit - Playtest Forge"
gh repo create playtest-forge --public --push
```

Or create a repo manually on github.com, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/playtest-forge.git
git push -u origin main
```

### Step 2: Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your `playtest-forge` repo
3. Click **Deploy** (no env vars needed)
4. Done! Your URL will be `playtest-forge-xxx.vercel.app`

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)
