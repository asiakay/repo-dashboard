-- Migration 0004: DAD-* OKRs for family guardianship & care placement case
-- Apply via: wrangler d1 execute repo-dashboard-work-items --remote --file=db/migrations/0004_dad_okrs.sql
--
-- IDs use DAD- prefix to avoid collision with existing KR-1.x / KR-2.x / KR-3.x / KR-4.x OKRs.
-- Maps to the 7-stage repatriation roadmap in masshealth-crm/index.html,
-- plus a parallel guardianship track (DAD-8).

INSERT OR IGNORE INTO okrs (id, objective, key_result, target_date, status) VALUES
  ('DAD-1', 'Family Guardianship & Care Placement (Maine → Massachusetts)',
   'Stage 1 — Establish MA legal residency (42 CFR § 435.403)',
   'Ongoing', 'In Progress'),

  ('DAD-2', 'Family Guardianship & Care Placement (Maine → Massachusetts)',
   'Stage 2 — Compel hospital case-management records release',
   'Ongoing', 'In Progress'),

  ('DAD-3', 'Family Guardianship & Care Placement (Maine → Massachusetts)',
   'Stage 3 — File cross-state PASRR Level 1 screen',
   'Ongoing', 'In Progress'),

  ('DAD-4', 'Family Guardianship & Care Placement (Maine → Massachusetts)',
   'Stage 4 — Submit MassHealth SACA-2 LTC application to Tewksbury MEC',
   'Ongoing', 'In Progress'),

  ('DAD-5', 'Family Guardianship & Care Placement (Maine → Massachusetts)',
   'Stage 5 — Secure conditional bed acceptance from MassHealth-pending SNF',
   'Ongoing', 'In Progress'),

  ('DAD-6', 'Family Guardianship & Care Placement (Maine → Massachusetts)',
   'Stage 6 — Serve safe discharge demand & secure hospital-funded transport',
   'Ongoing', 'In Progress'),

  ('DAD-7', 'Family Guardianship & Care Placement (Maine → Massachusetts)',
   'Stage 7 — Direct transfer arrival & business office PPA turnover',
   'Ongoing', 'In Progress'),

  ('DAD-8', 'Family Guardianship & Care Placement (Maine → Massachusetts)',
   'Guardianship — Permanent guardianship awarded in Maine (Sept 29) + concurrent MA guardianship transfer filing',
   'Ongoing', 'In Progress');
