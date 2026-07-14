// The Task type moved to @/lib/types (#88) — this re-export keeps the
// existing `from "@/lib/data/mockTasks"` import sites compiling.
// Rewriting those import sites to point at @/lib/types is ticket #89.
export type { Task } from '@/lib/types';
