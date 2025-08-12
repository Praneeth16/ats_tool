// Sophie ATS – Kanban + Supabase + Vercel (Vite + React + TS)
// ------------------------------------------------------------
// Use `.env` with:
//  - VITE_SUPABASE_URL
//  - VITE_SUPABASE_ANON_KEY
// ------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent, DragOverlay, closestCorners, useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Upload, Sun, Moon, Search, FileText, Users, Trash2, Edit, Download, FileUp, X, Briefcase, CheckCircle, Gauge, ShieldCheck, SlidersHorizontal, EyeOff, Eye, Tags, Filter, Trash, ArrowRightLeft } from "lucide-react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dayjs from 'dayjs';
import Fuse from 'fuse.js';

// --------------------------------------
// Types
// --------------------------------------
const STAGES = [
  "Sourced",
  "Interview: First Round",
  "Interview: Second Round",
  "Interview: Final round",
  "Hired",
  "Rejected",
] as const;

type Stage = typeof STAGES[number];

type FileRef = { name: string; url: string };

type Candidate = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  tags: string[];
  score?: number; // 0-100
  resume?: FileRef | null;
  notes?: string;
  stage: Stage;
  appliedAt: string; // ISO string
};

type Job = {
  id: string;
  title: string;
  department?: string;
  location?: string;
  createdAt: string;
  jd?: FileRef | null;
  candidates: Candidate[];
};

type ATSState = {
  jobs: Job[];
  selectedJobId?: string | null;
};

type PersistMode = "local" | "supabase";

// --------------------------------------
// Utilities
// --------------------------------------
const uid = () => Math.random().toString(36).slice(2, 10);
const prettyDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "—");

const safeJSONParse = <T,>(raw: string | null, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const STORAGE_KEY = "internal-ats-state-v1";
const THEME_KEY = "internal-ats-theme";
const VIEWS_KEY = "internal-ats-views-v1";

const isStage = (s: any): s is Stage => (STAGES as readonly string[]).includes(s as any);

const normalizeStage = (s: any): Stage => {
  const v = String(s || '').toLowerCase();
  if (v === 'applied' || v === 'interview stage 1') return 'Interview: First Round';
  if (v === 'screening' || v === 'interview stage 2') return 'Interview: Second Round';
  if (v === 'offer' || v === 'interview') return 'Interview: Final round';
  if (isStage(s)) return s as Stage;
  return 'Sourced';
};

// Env helper (Vite → Node → window)
const env = (k: string): string | undefined => {
  try {
    // @ts-ignore
    const v = (import.meta as any)?.env?.[k];
    if (typeof v !== "undefined") return v as string;
  } catch {}
  try {
    const p = (typeof process !== "undefined" ? (process as any).env : undefined);
    if (p && typeof p[k] !== "undefined") return p[k];
  } catch {}
  try {
    if (typeof window !== "undefined" && typeof (window as any)[k] !== "undefined") return (window as any)[k];
  } catch {}
  return undefined;
};

const SB_URL = env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
const SB_KEY = env("VITE_SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// --------------------------------------
// Supabase helpers
// --------------------------------------
function useSupabase() {
  const sb = useMemo(() => {
    if (!SB_URL || !SB_KEY) return null;
    return createClient(SB_URL, SB_KEY);
  }, []);
  return sb;
}

async function uploadToStorage(sb: SupabaseClient, kind: "jd" | "resumes", file: File): Promise<FileRef> {
  const path = `${kind}/${Date.now()}-${file.name}`;
  const { error } = await sb.storage.from("ats-public").upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from("ats-public").getPublicUrl(path);
  return { name: file.name, url: data.publicUrl };
}

// Map DB rows → UI types
function mapRowsToState(jobsRows: any[], candsRows: any[]): ATSState {
  const byJob: Record<string, Candidate[]> = {};
  for (const r of candsRows || []) {
    const id = r.id as string;
    const jobId = r.job_id as string;
    const tags: string[] = Array.isArray(r.tags) ? r.tags : safeJSONParse(r.tags, [] as string[]);
    const cand: Candidate = {
      id,
      name: r.name || "",
      email: r.email || "",
      phone: r.phone || "",
      tags,
      score: typeof r.score === "number" ? r.score : undefined,
      resume: r.resume_url ? { name: r.resume_name || "resume", url: r.resume_url } : null,
      notes: r.notes || "",
      stage: (r.stage as Stage) || "Sourced",
      appliedAt: r.applied_at || new Date().toISOString(),
    };
    byJob[jobId] = byJob[jobId] || [];
    byJob[jobId].push(cand);
  }
  const jobs: Job[] = (jobsRows || []).map((j: any) => ({
    id: j.id,
    title: j.title,
    department: j.department || "",
    location: j.location || "",
    createdAt: j.created_at || new Date().toISOString(),
    jd: j.jd_url ? { name: j.jd_name || "JD", url: j.jd_url } : null,
    candidates: byJob[j.id] || [],
  }));
  return { jobs, selectedJobId: jobs[0]?.id || null };
}

// --------------------------------------
// Sortable Card for Candidates
// --------------------------------------
function SortableCandidateCard({ candidate, onClick, blindMode, matchScore }: {
  candidate: Candidate;
  onClick: (c: Candidate) => void;
  blindMode: boolean;
  matchScore?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: candidate.id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(candidate)}
      role="button"
      className="group rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="min-w-0">
        <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate text-sm">
          {blindMode ? `Candidate ${candidate.id.slice(-4)}` : (candidate.name || 'Unnamed')}
        </div>
        {candidate.tags && candidate.tags.length>0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {candidate.tags.slice(0,3).map(t => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">{t}</span>
            ))}
          </div>
        )}
        {typeof matchScore === 'number' && (
          <div className="mt-1 text-[10px] inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">Match {Math.round(matchScore)}%</div>
        )}
      </div>
    </div>
  );
}

// Droppable column for each stage
function DroppableColumn({ id, children }: { id: Stage; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} data-droppable-id={id} className={`flex flex-col gap-3 min-h-[260px] ${isOver ? 'outline outline-2 outline-zinc-400/50 dark:outline-zinc-600/50 rounded-xl' : ''}`}>
      {children}
    </div>
  );
}

// --------------------------------------
// Simple Modal
// --------------------------------------
function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl">
          <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="font-semibold text-lg">{title}</h3>
            <button className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onClose}>
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------
// Toast (minimal)
// --------------------------------------
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const show = (m: string) => {
    setMsg(m);
    if (timer.current) window.clearTimeout(timer.current);
    // @ts-ignore
    timer.current = window.setTimeout(() => setMsg(null), 2500);
  };
  const Toast = () => (
    <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 transition ${msg ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
      <div className="rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 shadow-lg text-sm">{msg}</div>
    </div>
  );
  return { show, Toast } as const;
}

// --------------------------------------
// Navbar
// --------------------------------------
function Navbar({ route, setRoute, theme, setTheme, persistMode, setPersistMode, supaReady }: {
  route: 'home' | 'ats' | 'settings';
  setRoute: (r: 'home' | 'ats' | 'settings') => void;
  theme: string;
  setTheme: React.Dispatch<React.SetStateAction<string>>;
  persistMode: PersistMode;
  setPersistMode: React.Dispatch<React.SetStateAction<PersistMode>>;
  supaReady: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-zinc-950/60 bg-white/80 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
        <button onClick={() => setRoute('home')} className="flex items-center gap-2 font-semibold text-lg">
          <Briefcase className="w-5 h-5" /> Sophie ATS <span className="hidden sm:inline">(Internal)</span>
        </button>

        <nav className="ml-4 hidden md:flex items-center gap-1">
          <button onClick={() => setRoute('home')} className={`px-3 py-1.5 rounded-full text-sm transition ${route === 'home' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>Home</button>
          <button onClick={() => setRoute('ats')} className={`px-3 py-1.5 rounded-full text-sm transition ${route === 'ats' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>ATS</button>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className={`px-2 py-1 rounded-full text-xs border ${persistMode === 'supabase' ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300' : 'border-zinc-300 text-zinc-600 dark:text-zinc-300'}`} title={supaReady ? 'Supabase configured' : 'Supabase not configured'}>
            {persistMode === 'supabase' ? 'Supabase' : 'Local'}
          </span>
          <button
            disabled={!supaReady}
            onClick={() => setPersistMode((m) => (m === 'local' ? 'supabase' : 'local'))}
            className={`px-3 py-1.5 rounded-xl border text-sm ${supaReady ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'opacity-50 cursor-not-allowed'}`}
            title={supaReady ? 'Toggle data source' : 'Add env vars to enable Supabase'}
          >
            Switch
          </button>
          <button onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Toggle theme">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}

// --------------------------------------
// Main App
// --------------------------------------
export default function App() {
  const sb = useSupabase();
  const supaReady = !!sb;

  const [route, setRoute] = useState<'home'|'ats'|'settings'>('home');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [theme, setTheme] = useState<string>(typeof window !== "undefined" ? (localStorage.getItem(THEME_KEY) || "light") : "light");
  const [persistMode, setPersistMode] = useState<PersistMode>(supaReady ? "supabase" : "local");
  const [blindMode, setBlindMode] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [wipLimits, setWipLimits] = useState<Record<Stage, number>>({ Sourced: 20, "Interview: First Round": 15, "Interview: Second Round": 12, "Interview: Final round": 10, Hired: 999, Rejected: 999 });
  const [slaDays, setSlaDays] = useState<Record<Stage, number>>({ Sourced: 7, "Interview: First Round": 7, "Interview: Second Round": 5, "Interview: Final round": 7, Hired: 999, Rejected: 999 });
  const [filters, setFilters] = useState<{ tags: string[]; scoreMin?: number; scoreMax?: number; appliedFrom?: string; appliedTo?: string }>({ tags: [] });
  const [views, setViews] = useState<{ id: string; name: string; filters: typeof filters; query: string }[]>(() => safeJSONParse(localStorage.getItem(VIEWS_KEY), [] as any[]));
  useEffect(() => { localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); }, [views]);

  const [state, setState] = useState<ATSState>(() => {
    const initial: ATSState = safeJSONParse(localStorage.getItem(STORAGE_KEY), {
      jobs: [
        // Local demo job (used if Supabase not set)
        {
          id: uid(),
          title: "Frontend Engineer",
          department: "Product",
          location: "Bengaluru, IN",
          createdAt: new Date().toISOString(),
          jd: null,
          candidates: [
            { id: uid(), name: "Aarav Sharma", email: "aarav@example.com", tags: ["React", "TypeScript"], score: 82, resume: null, notes: "Good projects.", stage: "Interview: Second Round", appliedAt: new Date().toISOString() },
            { id: uid(), name: "Sara Khan", email: "sara@example.com", tags: ["UI/UX", "Next.js"], score: 76, resume: null, stage: "Interview: First Round", appliedAt: new Date().toISOString() },
            { id: uid(), name: "Rohit Verma", email: "rohit@example.com", tags: ["Tailwind", "Vite"], score: 68, resume: null, stage: "Sourced", appliedAt: new Date().toISOString() },
          ],
        },
      ],
      selectedJobId: null,
    });
    if (!initial.selectedJobId && initial.jobs[0]) initial.selectedJobId = initial.jobs[0].id;
    return initial;
  });

  const { show, Toast } = useToast();

  // Persist local state when using local mode
  useEffect(() => {
    if (persistMode === 'local') localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, persistMode]);

  // Theme persist
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Load from Supabase when enabled
  useEffect(() => {
    (async () => {
      if (persistMode !== 'supabase' || !sb) return;
      const { data: jobsRows, error: jErr } = await sb.from('jobs').select('*').order('created_at', { ascending: false });
      if (jErr) { show(`Load jobs failed: ${jErr.message}`); return; }
      const { data: candsRows, error: cErr } = await sb.from('candidates').select('*');
      if (cErr) { show(`Load candidates failed: ${cErr.message}`); return; }
      setState(mapRowsToState(jobsRows || [], candsRows || []));
    })();
  }, [persistMode, sb]);

  const job = useMemo(() => state.jobs.find((j) => j.id === state.selectedJobId) || state.jobs[0] || null, [state.jobs, state.selectedJobId]);

  // --------------------------
  // CRUD helpers (dual-mode)
  // --------------------------
  const createJob = async (data: Partial<Job>, jdFile?: File | null) => {
    if (persistMode === 'supabase' && sb) {
      let jdRef: FileRef | null = null;
      if (jdFile) jdRef = await uploadToStorage(sb, 'jd', jdFile);
      const payload: any = { title: data.title || 'Untitled Role', department: data.department || '', location: data.location || '' };
      if (jdRef) { payload.jd_name = jdRef.name; payload.jd_url = jdRef.url; }
      const { data: row, error } = await sb.from('jobs').insert(payload).select('*').single();
      if (error) { show(`Create job failed: ${error.message}`); return; }
      setState((s) => ({ ...s, jobs: [{ id: row.id, title: row.title, department: row.department, location: row.location, createdAt: row.created_at, jd: row.jd_url ? { name: row.jd_name || 'JD', url: row.jd_url } : null, candidates: [] }, ...s.jobs], selectedJobId: row.id }));
      show('Job created');
      return;
    }
    // local
    const newJob: Job = { id: uid(), title: data.title || 'Untitled Role', department: data.department || '', location: data.location || '', createdAt: new Date().toISOString(), jd: null, candidates: [] };
    setState((s) => ({ ...s, jobs: [newJob, ...s.jobs], selectedJobId: newJob.id }));
    show('Job created');
  };

  const updateJob = async (id: string, patch: Partial<Job>) => {
    if (persistMode === 'supabase' && sb) {
      const payload: any = { title: patch.title, department: patch.department, location: patch.location };
      if (patch.jd) { payload.jd_name = patch.jd.name; payload.jd_url = patch.jd.url; }
      const { error } = await sb.from('jobs').update(payload).eq('id', id);
      if (error) { show(`Update failed: ${error.message}`); return; }
    }
    setState((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
    show('Job updated');
  };

  const deleteJob = async (id: string) => {
    if (persistMode === 'supabase' && sb) {
      const { error } = await sb.from('jobs').delete().eq('id', id);
      if (error) { show(`Delete failed: ${error.message}`); return; }
    }
    setState((s) => { const jobs = s.jobs.filter((j) => j.id !== id); return { jobs, selectedJobId: jobs[0]?.id || null }; });
    show('Job deleted');
  };

  const createCandidate = async (jobId: string, data: Partial<Candidate>, resumeFile?: File | null) => {
    if (persistMode === 'supabase' && sb) {
      let resumeRef: FileRef | null = null;
      if (resumeFile) resumeRef = await uploadToStorage(sb, 'resumes', resumeFile);
      const payload: any = {
        job_id: jobId,
        name: data.name || 'New Candidate',
        email: data.email || '',
        phone: data.phone || '',
        tags: data.tags || [],
        score: typeof data.score === 'number' ? data.score : null,
        notes: data.notes || '',
        stage: (data.stage as Stage) || 'Sourced',
        applied_at: data.appliedAt || new Date().toISOString(),
      };
      if (resumeRef) { payload.resume_name = resumeRef.name; payload.resume_url = resumeRef.url; }
      const { data: row, error } = await sb.from('candidates').insert(payload).select('*').single();
      if (error) { show(`Add candidate failed: ${error.message}`); return; }
      const cand: Candidate = { id: row.id, name: row.name, email: row.email, phone: row.phone, tags: row.tags || [], score: row.score ?? undefined, notes: row.notes, stage: row.stage, appliedAt: row.applied_at, resume: row.resume_url ? { name: row.resume_name || 'resume', url: row.resume_url } : null };
      setState((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, candidates: [...j.candidates, cand] } : j)) }));
      show('Candidate added');
      return;
    }
    // local
    setState((s) => ({ ...s, jobs: s.jobs.map((j) => j.id === jobId ? { ...j, candidates: [...j.candidates, { id: uid(), name: data.name || 'New Candidate', email: data.email || '', phone: data.phone || '', tags: data.tags || [], score: typeof data.score === 'number' ? data.score : undefined, resume: null, notes: data.notes || '', stage: (data.stage as Stage) || 'Sourced', appliedAt: data.appliedAt || new Date().toISOString(), }] } : j) }));
    show('Candidate added');
  };

  const updateCandidate = async (jobId: string, candId: string, patch: Partial<Candidate>) => {
    if (persistMode === 'supabase' && sb) {
      const payload: any = { name: patch.name, email: patch.email, phone: patch.phone, tags: patch.tags, score: patch.score ?? null, notes: patch.notes, stage: patch.stage, applied_at: patch.appliedAt };
      if (patch.resume) { payload.resume_name = patch.resume.name; payload.resume_url = patch.resume.url; }
      const { error } = await sb.from('candidates').update(payload).eq('id', candId);
      if (error) { show(`Update candidate failed: ${error.message}`); return; }
    }
    setState((s) => ({ ...s, jobs: s.jobs.map((j) => j.id === jobId ? { ...j, candidates: j.candidates.map((c) => c.id === candId ? { ...c, ...patch } : c) } : j) }));
  };

  const deleteCandidate = async (jobId: string, candId: string) => {
    if (persistMode === 'supabase' && sb) {
      const { error } = await sb.from('candidates').delete().eq('id', candId);
      if (error) { show(`Delete candidate failed: ${error.message}`); return; }
    }
    setState((s) => ({ ...s, jobs: s.jobs.map((j) => j.id === jobId ? { ...j, candidates: j.candidates.filter((c) => c.id !== candId) } : j) }));
    show('Candidate deleted');
  };

  // --------------------------
  // Drag & Drop
  // --------------------------
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!active || !over || !job) return;
    const candId = String(active.id);
    const overId = String(over.id);
    let targetStage: Stage | null = null;
    if (isStage(overId)) {
      targetStage = overId as Stage;
    } else {
      const overCand = job.candidates.find((x) => x.id === overId);
      if (overCand && isStage(overCand.stage)) targetStage = overCand.stage as Stage;
    }
    if (!targetStage) return;
    const c = job.candidates.find((x) => x.id === candId);
    if (!c) return;
    if (c.stage !== targetStage && isStage(targetStage)) {
      updateCandidate(job.id, candId, { stage: targetStage });
      show(`Moved to ${targetStage}`);
    }
  };

  // --------------------------
  // Filtering & derived lists
  // --------------------------
  const [query, setQuery] = useState("");
  const filtered: Candidate[] = useMemo(() => {
    if (!job) return [];
    let list = job.candidates.slice();
    // Text search with Fuse if query
    if (query.trim()) {
      const fuse = new Fuse(list, { keys: ['name', 'email', 'tags', 'notes'], threshold: 0.35, ignoreLocation: true });
      list = fuse.search(query).map(r => r.item);
    }
    // Filters
    if (filters.tags && filters.tags.length) {
      const need = filters.tags.map(t => t.toLowerCase());
      list = list.filter(c => {
        const have = (c.tags || []).map(t => t.toLowerCase());
        return need.every(t => have.includes(t));
      });
    }
    if (typeof filters.scoreMin === 'number') list = list.filter(c => typeof c.score === 'number' ? (c.score as number) >= (filters.scoreMin as number) : false);
    if (typeof filters.scoreMax === 'number') list = list.filter(c => typeof c.score === 'number' ? (c.score as number) <= (filters.scoreMax as number) : false);
    if (filters.appliedFrom) list = list.filter(c => dayjs(c.appliedAt).isAfter(dayjs(filters.appliedFrom).subtract(1, 'day')));
    if (filters.appliedTo) list = list.filter(c => dayjs(c.appliedAt).isBefore(dayjs(filters.appliedTo).add(1, 'day')));
    return list;
  }, [job, query, filters]);
  const byStage: Record<Stage, Candidate[]> = useMemo(() => {
    const res: Record<Stage, Candidate[]> = { Sourced: [], "Interview: First Round": [], "Interview: Second Round": [], "Interview: Final round": [], Hired: [], Rejected: [] } as Record<Stage, Candidate[]>;
    for (const c of filtered) res[normalizeStage(c.stage)].push({ ...c, stage: normalizeStage(c.stage) });
    return res;
  }, [filtered]);
  const stageCounts = useMemo(() => STAGES.map((s) => byStage[s].length), [byStage]);

  // --------------------------
  // Modals state
  // --------------------------
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [candModalOpen, setCandModalOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);

  // --------------------------
  // Bulk resume upload
  // --------------------------
  const onResumeFiles = async (files: FileList | null) => {
    if (!files || !job) return;
    const farr = Array.from(files);
    for (const f of farr) {
      try {
        const ref = persistMode === 'supabase' && sb ? await uploadToStorage(sb, 'resumes', f) : { name: f.name, url: URL.createObjectURL(f) };
        const base = f.name.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
        const guessName = base.replace(/\d+/g, "").trim() || base || "New Candidate";
        await createCandidate(job.id, { name: guessName, resume: ref, stage: "Sourced" });
      } catch (e: any) {
        show(`Upload failed: ${e.message || e}`);
      }
    }
    show(`${farr.length} resume${farr.length > 1 ? "s" : ""} uploaded`);
  };

  // --------------------------
  // Export / Import JSON (local only)
  // --------------------------
  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ats_state_${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const uploadJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { const next = JSON.parse(String(reader.result)); setState(next); show("State imported"); }
      catch { show("Import failed: invalid JSON"); }
    };
    reader.readAsText(file);
  };

  // CSV export (current job, filtered list)
  const downloadCSV = () => {
    if (!job) return;
    const header = ['id','name','email','phone','tags','score','stage','appliedAt'];
    const rows = filtered.map(c => [c.id, c.name, c.email||'', c.phone||'', (c.tags||[]).join('|'), typeof c.score==='number'?String(c.score):'', c.stage, c.appliedAt]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `candidates_${job.title.replace(/\s+/g,'_')}_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // --------------------------------------
  // UI
  // --------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 text-zinc-900 dark:text-zinc-100">
      {/* App Navbar */}
      <Navbar route={route} setRoute={setRoute} theme={theme} setTheme={setTheme} persistMode={persistMode} setPersistMode={setPersistMode} supaReady={supaReady} />

      {/* Landing page */}
      {route === 'home' && (
        <Landing onGetStarted={() => setRoute('ats')} onNewJob={() => { setRoute('ats'); setEditingJob(null); setJobModalOpen(true); }} jobs={state.jobs} supaReady={supaReady} />
      )}

      {route === 'ats' && (<>
      {/* ATS toolbar */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Job selector */}
          <div className="flex items-center gap-2">
            <select value={state.selectedJobId || ''} onChange={(e) => setState((s) => ({ ...s, selectedJobId: e.target.value }))} className="rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 px-3 py-2 text-sm">
              {state.jobs.map((j) => (<option key={j.id} value={j.id}>{j.title} ({j.candidates.length})</option>))}
            </select>
            <button onClick={() => { setEditingJob(null); setJobModalOpen(true); }} className="px-3 py-2 rounded-xl border text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> New Job</button>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search candidates" className="w-full pl-9 pr-10 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700" />
            <button onClick={() => setShowFilters(v => !v)} className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60" title="Filters">
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm cursor-pointer">
              <Upload className="w-4 h-4" /> Upload Resumes
              <input type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.txt" onChange={(e) => onResumeFiles(e.target.files)} />
            </label>
            {job && (
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm cursor-pointer" title="Attach/replace JD">
                <FileUp className="w-4 h-4" /> Upload JD
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,.txt" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f || !job) return;
                  try {
                    const ref = persistMode === 'supabase' && sb ? await uploadToStorage(sb, 'jd', f) : { name: f.name, url: URL.createObjectURL(f) };
                    updateJob(job.id, { jd: ref }); show('JD attached');
                  } catch (err: any) { show(`JD upload failed: ${err.message || err}`); }
                }} />
              </label>
            )}
            <button onClick={() => setCandModalOpen(true)} className="px-3 py-2 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-sm flex items-center gap-1"><Users className="w-4 h-4" /> Add Candidate</button>
            <button onClick={() => setBlindMode(v => !v)} className="px-3 py-2 rounded-xl border text-sm flex items-center gap-1" title="Bias reduction">
              {blindMode ? (<span className="inline-flex items-center gap-1"><Eye className="w-4 h-4"/> Show Names</span>) : (<span className="inline-flex items-center gap-1"><EyeOff className="w-4 h-4"/> Hide Names</span>)}
            </button>
            <button onClick={() => downloadCSV()} className="p-2 rounded-xl border" title="Export CSV"><Download className="w-4 h-4" /></button>
            {persistMode === 'local' && (<>
              <button onClick={downloadJSON} className="p-2 rounded-xl border" title="Export JSON"><Download className="w-4 h-4" /></button>
              <label className="p-2 rounded-xl border cursor-pointer" title="Import JSON"><Upload className="w-4 h-4"/>
                <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && uploadJSON(e.target.files[0])} />
              </label>
            </>)}
          </div>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="max-w-7xl mx-auto px-4 mt-3">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 p-3">
            <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3 text-sm">
              <div className="lg:col-span-2">
                <label className="text-xs text-zinc-500">Tags (comma separated)</label>
                <input value={filters.tags.join(', ')} onChange={(e)=> setFilters(f => ({...f, tags: e.target.value.split(',').map(t=>t.trim()).filter(Boolean)}))} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Score Min</label>
                <input type="number" value={filters.scoreMin ?? ''} onChange={(e)=> setFilters(f => ({...f, scoreMin: e.target.value===''? undefined : Number(e.target.value)}))} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Score Max</label>
                <input type="number" value={filters.scoreMax ?? ''} onChange={(e)=> setFilters(f => ({...f, scoreMax: e.target.value===''? undefined : Number(e.target.value)}))} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Applied From</label>
                <input type="date" value={filters.appliedFrom ?? ''} onChange={(e)=> setFilters(f => ({...f, appliedFrom: e.target.value || undefined}))} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Applied To</label>
                <input type="date" value={filters.appliedTo ?? ''} onChange={(e)=> setFilters(f => ({...f, appliedTo: e.target.value || undefined}))} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button onClick={()=> setFilters({ tags: [] })} className="px-3 py-1.5 rounded-xl border text-xs">Clear</button>
              <button onClick={()=> { const name = prompt('Save current filters as view name:'); if (!name) return; setViews(v=> [...v, { id: uid(), name, filters, query }]); }} className="px-3 py-1.5 rounded-xl border text-xs">Save View</button>
              {views.length>0 && (
                <select onChange={(e)=> { const v = views.find(x=>x.id===e.target.value); if (v) { setFilters(v.filters); setQuery(v.query); } }} className="px-3 py-1.5 rounded-xl border text-xs">
                  <option value="">Apply view…</option>
                  {views.map(v=> (<option key={v.id} value={v.id}>{v.name}</option>))}
                </select>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Current job details */}
      {job && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{job.title}</span>
              <span>• {job.department || "—"}</span>
              <span>• {job.location || "—"}</span>
              <span>• Created {prettyDate(job.createdAt)}</span>
              {job.jd?.url ? (<a className="inline-flex items-center gap-1 hover:underline" href={job.jd.url} target="_blank" rel="noreferrer"><FileText className="w-4 h-4" /> View JD</a>) : (<span className="inline-flex items-center gap-1 text-zinc-400"><FileText className="w-4 h-4"/> No JD</span>)}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => { setEditingJob(job); setJobModalOpen(true); }} className="px-3 py-1.5 rounded-xl border text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1"><Edit className="w-4 h-4"/> Edit Job</button>
              <button onClick={() => deleteJob(job.id)} className="px-3 py-1.5 rounded-xl border text-sm hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 flex items-center gap-1"><Trash2 className="w-4 h-4"/> Delete Job</button>
            </div>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {job ? (
          <DndContext sensors={sensors} onDragEnd={onDragEnd} collisionDetection={closestCorners}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 2xl:grid-cols-6 gap-4 items-start">
              {STAGES.map((stage, idx) => (
                <div key={stage} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur p-3 flex flex-col min-h-[320px]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-sm">{stage}</div>
                    <div className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">{stageCounts[idx]}</div>
                  </div>

                  <SortableContext id={stage} items={byStage[stage].map((c) => c.id)} strategy={rectSortingStrategy}>
                    <DroppableColumn id={stage}>
                      {byStage[stage].map((c) => {
                        const score = typeof c.score === 'number' ? c.score : undefined;
                        return (
                          <SortableCandidateCard
                            key={c.id}
                            candidate={c}
                            blindMode={blindMode}
                            matchScore={score}
                            onClick={(cand) => { setEditingCandidate(cand); setCandModalOpen(true); }}
                          />
                        );
                      })}
                      {byStage[stage].length === 0 && (
                        <div className="flex-1 min-h-[220px] rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-400 text-sm grid place-items-center">Drop here</div>
                      )}
                    </DroppableColumn>
                  </SortableContext>

                  {/* Quick add */}
                  <div className="mt-3 flex items-center justify-between">
                    <button onClick={() => { setEditingCandidate({ id: "temp", name: "", tags: [], stage, appliedAt: new Date().toISOString(), resume: null }); setCandModalOpen(true); }} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl border border-dashed text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"><Plus className="w-3.5 h-3.5"/> Add</button>
                    {byStage[stage].length > (wipLimits[stage] || 999) && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" title="WIP limit exceeded">WIP!</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <DragOverlay />
          </DndContext>
        ) : (
          <div className="text-center text-zinc-500">No jobs yet. Create one to get started.</div>
        )}
      </main>

      </>) }

      {/* Job Modal */}
      <Modal open={jobModalOpen} onClose={() => setJobModalOpen(false)} title={editingJob ? "Edit Job" : "New Job"}>
        <JobForm initial={editingJob || undefined} onSubmit={async (vals, file) => { if (editingJob) { await updateJob(editingJob.id, vals); } else { await createJob(vals, file || undefined); } setJobModalOpen(false); }} />
      </Modal>

      {/* Candidate Modal */}
      <Modal open={candModalOpen} onClose={() => setCandModalOpen(false)} title={editingCandidate ? (editingCandidate.id === "temp" ? "Add Candidate" : "Edit Candidate") : "Add Candidate"}>
        {job && (
          <CandidateForm initial={editingCandidate?.id ? editingCandidate : undefined} onSubmit={async (vals, file) => {
            if (file && persistMode === 'supabase' && sb) {
              try { const ref = await uploadToStorage(sb, 'resumes', file); vals = { ...vals, resume: ref }; } catch (e: any) { show(`Resume upload failed: ${e.message || e}`); }
            }
            if (editingCandidate && editingCandidate.id !== "temp") { await updateCandidate(job.id, editingCandidate.id, vals); show("Candidate updated"); }
            else { await createCandidate(job.id, vals); }
            setCandModalOpen(false); setEditingCandidate(null);
          }} />
        )}
      </Modal>

      <Toast />
    </div>
  );
}

// --------------------------------------
// Landing Page (modern hero, feature cards, recent jobs)
// --------------------------------------
function Landing({ onGetStarted, onNewJob, jobs, supaReady }: { onGetStarted: () => void; onNewJob: () => void; jobs: Job[]; supaReady: boolean }) {
  const topJobs = jobs.slice(0, 3);
  return (
    <section className="relative">
      {/* Glow */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-zinc-100/40 dark:via-zinc-900/40 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="grid gap-10 md:grid-cols-2 items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border bg-white/60 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800 mb-3">
              <ShieldCheck className="w-3.5 h-3.5" /> Internal & private
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold leading-tight">A lean, modern ATS for your internal hiring</h1>
            <p className="mt-4 text-zinc-600 dark:text-zinc-400 text-lg">Kanban pipelines, bulk resume intake, search, and instant collaboration. Switch between Local and Supabase persistence with one click.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={onGetStarted} className="px-5 py-3 rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium">Open ATS Board</button>
              <button onClick={onNewJob} className="px-5 py-3 rounded-2xl border font-medium">Create a Job</button>
            </div>
            <div className="mt-6 flex items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="inline-flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Drag & drop stages</span>
              <span className="inline-flex items-center gap-2"><Gauge className="w-4 h-4"/> Fast & minimal</span>
            </div>
            <div className="mt-4 text-xs text-zinc-500">Backend: {supaReady ? 'Supabase ready' : 'Supabase not configured (using Local)'}.</div>
          </div>

          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-6 shadow-sm">
            <div className="aspect-video rounded-xl border border-dashed grid place-items-center text-zinc-400">
              <span>Kanban Preview</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3"><div className="text-lg font-semibold">{jobs.reduce((a,j)=>a+j.candidates.length,0)}</div><div>Candidates</div></div>
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3"><div className="text-lg font-semibold">{jobs.length}</div><div>Open Jobs</div></div>
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3"><div className="text-lg font-semibold">{STAGES.length}</div><div>Stages</div></div>
            </div>
          </div>
        </div>

        {/* Recent Jobs */}
        <div className="mt-14">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Recent jobs</h2>
            <button onClick={onNewJob} className="text-sm px-3 py-1.5 rounded-xl border">New Job</button>
          </div>
          {topJobs.length === 0 ? (
            <div className="text-zinc-500">No jobs yet — create your first one.</div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {topJobs.map((j) => (
                <div key={j.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 p-4">
                  <div className="font-medium">{j.title}</div>
                  <div className="text-xs text-zinc-500">{j.department || '—'} • {j.location || '—'}</div>
                  <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{j.candidates.length} candidate{j.candidates.length!==1?'s':''}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feature Cards */}
        <div className="mt-14 grid md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white/60 dark:bg-zinc-900/60"><div className="font-medium">Kanban Workflows</div><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Customize stages and drag candidates across the pipeline.</p></div>
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white/60 dark:bg-zinc-900/60"><div className="font-medium">Bulk Intake</div><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Drop a folder of resumes; cards get created automatically.</p></div>
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white/60 dark:bg-zinc-900/60"><div className="font-medium">Supabase Native</div><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Store jobs/candidates & files in Postgres + Storage.</p></div>
        </div>
      </div>
    </section>
  );
}

// --------------------------------------
// Forms
// --------------------------------------
function JobForm({ initial, onSubmit }: { initial?: Partial<Job>; onSubmit: (vals: Partial<Job>, file?: File | null) => void }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [department, setDepartment] = useState(initial?.department || "");
  const [location, setLocation] = useState(initial?.location || "");
  const [file, setFile] = useState<File | null>(null);

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ title, department, location }, file); }} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-zinc-500">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700" />
        </div>
        <div>
          <label className="text-sm text-zinc-500">Department</label>
          <input value={department} onChange={(e) => setDepartment(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700" />
        </div>
        <div>
          <label className="text-sm text-zinc-500">Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700" />
        </div>
        <div>
          <label className="text-sm text-zinc-500">Attach JD (optional)</label>
          <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => onSubmit({ title, department, location }, null)} className="px-4 py-2 rounded-xl border">Save</button>
        <button type="submit" className="px-4 py-2 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">Save & Close</button>
      </div>
    </form>
  );
}

function CandidateForm({ initial, onSubmit }: { initial?: Partial<Candidate>; onSubmit: (vals: Partial<Candidate>, file?: File | null) => void }) {
  const [name, setName] = useState(initial?.name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [stage, setStage] = useState<Stage>((initial?.stage as Stage) || "Sourced");
  const [tags, setTags] = useState<string>(initial?.tags?.join(", ") || "");
  const [score, setScore] = useState<number | undefined>(initial?.score);
  const [notes, setNotes] = useState(initial?.notes || "");
  const [file, setFile] = useState<File | null>(null);
  const [caseStudy, setCaseStudy] = useState<File | null>(null);

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, email, phone, stage, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), score, notes }, file); }} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-zinc-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700" />
        </div>
        <div>
          <label className="text-sm text-zinc-500">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700" />
        </div>
        <div>
          <label className="text-sm text-zinc-500">Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700" />
        </div>
        <div>
          <label className="text-sm text-zinc-500">Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value as Stage)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2">
            {STAGES.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>
        <div>
          <label className="text-sm text-zinc-500">Tags (comma separated)</label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
        </div>
        <div>
          <label className="text-sm text-zinc-500">Score</label>
          <input type="number" min={0} max={100} value={typeof score === "number" ? score : ""} onChange={(e) => setScore(e.target.value ? Number(e.target.value) : undefined)} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm text-zinc-500">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2" />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm text-zinc-500">Attach Resume (optional)</label>
          <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
        </div>
        {stage === 'Interview: Second Round' && (
          <div className="md:col-span-2">
            <label className="text-sm text-zinc-500">Case Study Upload (placeholder)</label>
            <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={(e)=> setCaseStudy(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
            <div className="text-xs text-zinc-500 mt-1">Attach the case study submitted by the candidate.</div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => onSubmit({ name, email, phone, stage, tags: tags.split(",").map((t)=>t.trim()).filter(Boolean), score, notes }, null)} className="px-4 py-2 rounded-xl border">Save</button>
        <button type="submit" className="px-4 py-2 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">Save & Close</button>
      </div>
    </form>
  );
}

// --------------------------------------
// Minimal dev assertions (tests)
// --------------------------------------
(function runDevTests() {
  try {
    console.assert(Array.isArray(STAGES) && STAGES.includes("Sourced"), "STAGES missing 'Sourced'");
    console.assert(typeof prettyDate(new Date().toISOString()) === "string", "prettyDate returns string");
    // env() should never throw and should return undefined for unknown keys
    let threw = false; try { (void env("__NOT_DEFINED__")); } catch { threw = true; }
    console.assert(threw === false, "env() should not throw");
    console.assert(typeof (SB_URL || "") === "string", "SB_URL variable defined (may be empty if not configured)");
    // window fallback works
    try { (window as any).__ENV_TEST__ = 'ok'; console.assert(env('__ENV_TEST__') === 'ok', 'env window fallback'); delete (window as any).__ENV_TEST__; } catch {}
    // mapRowsToState basic shape
    const mapped = (function(){
      const st = mapRowsToState([{ id: 'j1', title: 'T', created_at: new Date().toISOString() }], [{ id: 'c1', job_id: 'j1', name: 'N', stage: 'Sourced', applied_at: new Date().toISOString(), tags: [] }]);
      return st.jobs.length === 1 && st.jobs[0].candidates.length === 1;
    })();
    console.assert(mapped, "mapRowsToState should group candidates under jobs");
  } catch (e) {
    console.warn("Dev tests warning:", e);
  }
})();

// --------------------------------------
// Supabase schema (reference)
// --------------------------------------
/*
See DEPLOY.md for the SQL to create tables, policies, and storage bucket.
*/



