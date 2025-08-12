### Sophie ATS (Kanban)

A lean, modern ATS with a Kanban pipeline. Works fully offline (LocalStorage) and can optionally persist to Supabase (Postgres + Storage). Ready for local development and Vercel deployment.

### Features

- **Kanban board** with drag & drop across stages
- **Jobs and candidates** CRUD
- **Bulk resume intake** (multi-file upload)
- **Search and tagging**
- **Local / Supabase** persistence toggle
- **Light/Dark** theme

### Tech

- React + TypeScript (Vite)
- Tailwind CSS
- @dnd-kit for drag & drop
- Supabase JS client (optional)

### Quick start (local)

1) Install dependencies

```bash
npm install
```

2) Start the dev server

```bash
npm run dev
```

3) Open the app

- Visit the URL shown in the terminal (typically http://localhost:5173).

The app works out-of-the-box in **Local** mode. To enable Supabase, copy `.env.example` to `.env` and fill your credentials:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Build and preview

```bash
npm run build
npm run preview
```

### Configure Supabase (optional)

- Create a public storage bucket named `ats-public` (public access)
- Create tables and policies using the SQL provided in `DEPLOY.md`

### Deploy

- See `DEPLOY.md` for step-by-step Vercel deployment, including env vars and post-deploy checks.

### Project structure

```
ats_tool/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  tailwind.config.js
  postcss.config.js
  vercel.json
  .env.example
  src/
    main.tsx
    index.css
    App.tsx
```


