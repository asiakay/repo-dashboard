-- Migration 0010: College Tracker integration
-- Adds sto_owner to okrs, creates courses + assignments tables,
-- adds assignment_id + source_repo to tasks, and creates the
-- okr_progress_matrix view used by the college-tracker Worker.

-- 1. Extend okrs with Single Task Owner
ALTER TABLE okrs ADD COLUMN sto_owner TEXT DEFAULT 'Self';

-- 2. Academic Courses / Project Tracks
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    instructor TEXT,
    term TEXT NOT NULL,
    okr_id TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Assignments, Milestones & Academic Projects
CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    okr_id TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_date TEXT NOT NULL,
    deliverable_type TEXT CHECK(deliverable_type IN ('Essay','Exam','Project','Reading','Code','Presentation')) DEFAULT 'Project',
    weight_pct REAL DEFAULT 0.0,
    status TEXT CHECK(status IN ('Not Started','In Progress','Submitted','Graded')) DEFAULT 'Not Started',
    grade REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assignments_due ON assignments(due_date);

-- 4. Extend tasks with assignment linkage and source repo tracking
ALTER TABLE tasks ADD COLUMN assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN source_repo TEXT DEFAULT 'repo-dashboard';

CREATE INDEX IF NOT EXISTS idx_tasks_assignment ON tasks(assignment_id);

-- 5. OKR Progress Matrix View
CREATE VIEW IF NOT EXISTS okr_progress_matrix AS
SELECT
    o.id AS okr_id,
    o.objective,
    o.key_result,
    COALESCE(o.sto_owner, 'Self') AS sto_owner,
    o.target_date,
    o.status AS milestone_status,
    COUNT(DISTINCT a.id) AS total_assignments,
    SUM(CASE WHEN a.status IN ('Submitted','Graded') THEN 1 ELSE 0 END) AS completed_assignments,
    COUNT(DISTINCT t.id) AS total_micro_tasks,
    SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) AS completed_micro_tasks,
    ROUND(
        CASE
            WHEN COUNT(DISTINCT t.id) = 0 THEN 0.0
            ELSE (CAST(SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(DISTINCT t.id)) * 100.0
        END, 1
    ) AS task_progress_pct
FROM okrs o
LEFT JOIN assignments a ON o.id = a.okr_id
LEFT JOIN tasks t ON o.id = t.okr_id
GROUP BY o.id;

-- 6. Seed new OKRs (INSERT OR IGNORE preserves existing rows)
INSERT OR IGNORE INTO okrs (id, objective, key_result, sto_owner, target_date, status) VALUES
    ('KR-ACAD-1', 'Degree Completion', 'Complete Fall 2026 Core Requirements with >3.5 GPA', 'Self', '2026-12-20', 'In Progress'),
    ('KR-ACAD-2', 'Capstone Project', 'Submit Final Thesis / Portfolio Application Build', 'Self', '2026-11-30', 'Planned'),
    ('KR-CRM-1', 'MassHealth Operations', 'Establish Patient Advocate Pipeline', 'Care STO', '2026-10-31', 'In Progress');

-- 7. Seed courses from registered syllabi
INSERT OR IGNORE INTO courses (id, name, instructor, term, okr_id) VALUES
    ('SCI-133-F26', 'Environmental Science', NULL, 'Fall 2026', 'KR-ACAD-1'),
    ('BMT-210-F26', 'Advanced TV Production', NULL, 'Fall 2026', 'KR-ACAD-1');
