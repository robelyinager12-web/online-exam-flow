-- ExamFlow custom constraints and indexes that Prisma cannot express.
-- Location in project: database/constraints/001_custom_constraints.sql
-- Column names are camelCase (Prisma default), so they are quoted.

-- ---------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT users_email_lowercase CHECK ("email" = lower("email")),
  ADD CONSTRAINT users_institution_required CHECK (
    "role" = 'SUPER_ADMIN' OR "institutionId" IS NOT NULL
  ),
  ADD CONSTRAINT users_failed_login_nonneg CHECK ("failedLoginCount" >= 0);

-- ---------------------------------------------------------------
-- Questions
-- ---------------------------------------------------------------
ALTER TABLE "question_versions"
  ADD CONSTRAINT question_versions_points_positive CHECK ("points" > 0),
  ADD CONSTRAINT question_versions_version_positive CHECK ("version" >= 1);

-- Full-text search over question bodies
CREATE INDEX question_versions_body_fts
  ON "question_versions"
  USING GIN (to_tsvector('english', "body"));

-- ---------------------------------------------------------------
-- Exams
-- ---------------------------------------------------------------
ALTER TABLE "exams"
  ADD CONSTRAINT exams_window_valid CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT exams_duration_positive CHECK ("durationMinutes" > 0),
  ADD CONSTRAINT exams_attempts_positive CHECK ("maxAttempts" >= 1),
  ADD CONSTRAINT exams_pass_mark_range CHECK ("passMarkPercent" BETWEEN 0 AND 100),
  ADD CONSTRAINT exams_late_entry_nonneg CHECK ("lateEntryMinutes" >= 0);

ALTER TABLE "exam_random_rules"
  ADD CONSTRAINT exam_random_rules_count_positive CHECK ("count" > 0);

-- An assignment targets exactly one of: a group, or a single student
ALTER TABLE "exam_assignments"
  ADD CONSTRAINT exam_assignments_single_target CHECK (
    ("groupId" IS NOT NULL AND "userId" IS NULL)
    OR ("groupId" IS NULL AND "userId" IS NOT NULL)
  );

-- ---------------------------------------------------------------
-- Attempts and answers
-- ---------------------------------------------------------------
-- A student can have at most ONE in-progress attempt per exam
CREATE UNIQUE INDEX attempts_one_in_progress
  ON "attempts" ("examId", "studentId")
  WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "attempts"
  ADD CONSTRAINT attempts_number_positive CHECK ("attemptNumber" >= 1),
  ADD CONSTRAINT attempts_deadline_valid CHECK ("expiresAt" > "startedAt"),
  ADD CONSTRAINT attempts_percentage_range CHECK (
    "percentage" IS NULL OR "percentage" BETWEEN 0 AND 100
  );

ALTER TABLE "answers"
  ADD CONSTRAINT answers_score_nonneg CHECK ("score" IS NULL OR "score" >= 0),
  ADD CONSTRAINT answers_revision_positive CHECK ("revision" >= 1);

-- ---------------------------------------------------------------
-- Audit log: append-only
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- Note: ON DELETE SET NULL on audit_logs.actorId/institutionId is itself an
-- UPDATE and would be blocked by the trigger. Users and institutions are
-- soft-deleted, so those rows are never physically removed in normal use.
