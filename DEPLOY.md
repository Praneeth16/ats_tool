### Deploying Sophie ATS to Vercel

This app is a Vite + React SPA and deploys cleanly to Vercel.

### 1) Prepare Supabase (optional, for cloud persistence)

- Create a Supabase project
- In Storage, create a public bucket named `ats-public`
- In SQL Editor, run the schema below

```
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text,
  location text,
  created_at timestamptz not null default now(),
  jd_name text,
  jd_url text
);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  tags text[] default '{}',
  score int,
  notes text,
  stage text not null default 'Sourced',
  applied_at timestamptz not null default now(),
  resume_name text,
  resume_url text
);

alter table public.jobs enable row level security;
alter table public.candidates enable row level security;

-- Demo policies – tighten for production
create policy "anon read jobs" on public.jobs for select using (true);
create policy "anon write jobs" on public.jobs for insert with check (true);
create policy "anon update jobs" on public.jobs for update using (true);
create policy "anon delete jobs" on public.jobs for delete using (true);

create policy "anon read candidates" on public.candidates for select using (true);
create policy "anon write candidates" on public.candidates for insert with check (true);
create policy "anon update candidates" on public.candidates for update using (true);
create policy "anon delete candidates" on public.candidates for delete using (true);
```

### 2) Create a Vercel project

- Import the Git repo into Vercel
- Framework detection: Vite (auto)

### 3) Configure environment variables

In Vercel Project Settings → Environment Variables, add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Redeploy after setting vars.

### 4) Build settings

- Build Command: `npm run build`
- Output Directory: `dist`
- Root: repository root (where `package.json` is)

`vercel.json` is provided for clarity, but Vercel auto-detects Vite.

### 5) Post-deploy checks

- Open the deployed URL
- Ensure the navbar shows the correct persistence mode (Local or Supabase)
- Try creating a job, adding candidates, and moving them across stages
- If Supabase is configured, try uploading resumes/JD (files should land in `ats-public`)


