// Postgres schema for Supabase (also used by the embedded PGlite fallback).
// Every statement is idempotent, so it is safe to run on every cold start.
// `npm run db:sql` writes the same SQL to supabase/migrations/0001_init.sql.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id                   integer PRIMARY KEY CHECK (id = 1),
  company_name         text    NOT NULL DEFAULT '',
  office_start         text    NOT NULL DEFAULT '09:00',
  office_end           text    NOT NULL DEFAULT '18:00',
  grace_minutes        integer NOT NULL DEFAULT 15,
  half_day_hours       numeric(4,2) NOT NULL DEFAULT 5,
  weekend_days         jsonb   NOT NULL DEFAULT '[6,0]',
  timezone             text    NOT NULL DEFAULT 'Asia/Karachi',
  currency             text    NOT NULL DEFAULT 'PKR',
  office_lat           double precision,
  office_lng           double precision,
  office_radius_m      integer NOT NULL DEFAULT 150,
  late_penalty_enabled boolean NOT NULL DEFAULT false,
  setup_completed_at   timestamptz,
  updated_at           timestamptz
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS departments (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_uq ON departments (lower(name));

CREATE TABLE IF NOT EXISTS designations (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  department_id integer REFERENCES departments(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS designations_name_uq ON designations (lower(name), COALESCE(department_id, 0));

CREATE TABLE IF NOT EXISTS leave_types (
  id           serial PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  yearly_quota integer,              -- NULL = unlimited
  is_paid      boolean NOT NULL DEFAULT true,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holidays (
  id         serial PRIMARY KEY,
  date       date NOT NULL UNIQUE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id              serial PRIMARY KEY,
  code            text NOT NULL,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  email           text NOT NULL,
  phone           text,
  address         text,
  gender          text CHECK (gender IN ('male','female','other')),
  dob             date,
  department_id   integer REFERENCES departments(id),
  designation_id  integer REFERENCES designations(id),
  employment_type text NOT NULL DEFAULT 'full_time',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','probation','exited')),
  join_date       date NOT NULL,
  exit_date       date,
  basic_salary    numeric(12,2) NOT NULL CHECK (basic_salary > 0),
  hra_pct         numeric(6,2) NOT NULL DEFAULT 40,
  medical_pct     numeric(6,2) NOT NULL DEFAULT 10,
  other_allowance numeric(12,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS employees_code_uq ON employees (lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_uq ON employees (lower(email));
CREATE INDEX IF NOT EXISTS employees_dept_idx ON employees (department_id);

CREATE TABLE IF NOT EXISTS users (
  id                   serial PRIMARY KEY,
  email                text NOT NULL,
  password_hash        text NOT NULL,
  name                 text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('admin','hr','employee')),
  employee_id          integer UNIQUE REFERENCES employees(id),
  is_active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS attendance (
  id          serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES employees(id),
  date        date NOT NULL,
  check_in    text,
  check_out   text,
  hours       numeric(5,2),
  status      text NOT NULL CHECK (status IN ('present','late','half_day','missing_checkout')),
  is_late     boolean NOT NULL DEFAULT false,
  source      text NOT NULL DEFAULT 'web' CHECK (source IN ('web','camera','correction')),
  lat         double precision,
  lng         double precision,
  accuracy_m  double precision,
  distance_m  double precision,
  rules       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz,
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance (date);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id             serial PRIMARY KEY,
  employee_id    integer NOT NULL REFERENCES employees(id),
  date           date NOT NULL,
  check_in       text NOT NULL,
  check_out      text,
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id    integer REFERENCES users(id),
  review_comment text,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id             serial PRIMARY KEY,
  employee_id    integer NOT NULL REFERENCES employees(id),
  leave_type_id  integer NOT NULL REFERENCES leave_types(id),
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  days           numeric(5,1) NOT NULL,
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  source         text NOT NULL DEFAULT 'form' CHECK (source IN ('form','ai')),
  reviewer_id    integer REFERENCES users(id),
  review_comment text,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS leave_emp_idx ON leave_requests (employee_id, status);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id               serial PRIMARY KEY,
  month            text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  working_days     integer NOT NULL,
  employee_count   integer NOT NULL DEFAULT 0,
  total_gross      numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_tax        numeric(14,2) NOT NULL DEFAULT 0,
  total_net        numeric(14,2) NOT NULL DEFAULT 0,
  created_by       integer REFERENCES users(id),
  finalized_by     integer REFERENCES users(id),
  finalized_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz
);

CREATE TABLE IF NOT EXISTS payslips (
  id                serial PRIMARY KEY,
  run_id            integer NOT NULL REFERENCES payroll_runs(id),
  employee_id       integer NOT NULL REFERENCES employees(id),
  department_id     integer,
  designation_id    integer,
  basic             numeric(12,2) NOT NULL,
  hra               numeric(12,2) NOT NULL,
  medical           numeric(12,2) NOT NULL,
  other_allowance   numeric(12,2) NOT NULL,
  monthly_gross     numeric(12,2) NOT NULL,
  working_days      integer NOT NULL,
  employed_days     integer NOT NULL,
  absent_days       numeric(5,1) NOT NULL,
  unpaid_leave_days numeric(5,1) NOT NULL,
  half_days         numeric(5,1) NOT NULL,
  late_count        integer NOT NULL,
  late_penalty_days numeric(5,1) NOT NULL,
  per_day           numeric(12,2) NOT NULL,
  gross             numeric(12,2) NOT NULL,
  deductions        numeric(12,2) NOT NULL,
  taxable_annual    numeric(14,2) NOT NULL,
  tax               numeric(12,2) NOT NULL,
  net               numeric(12,2) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id         serial PRIMARY KEY,
  title      text NOT NULL,
  body       text NOT NULL,
  author_id  integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         serial PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id),
  title      text NOT NULL,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    integer,
  actor_name  text,
  actor_role  text NOT NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  before_json jsonb,
  after_json  jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs (created_at);

CREATE TABLE IF NOT EXISTS ai_logs (
  id         bigserial PRIMARY KEY,
  user_id    integer REFERENCES users(id),
  feature    text NOT NULL,
  prompt     text,
  tools      jsonb,
  response   text,
  status     text NOT NULL,
  provider   text NOT NULL,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_logs_user_idx ON ai_logs (user_id, created_at);

-- The audit log is append-only: nobody (not even Admin) can change or delete entries.
CREATE OR REPLACE FUNCTION hcm_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'audit log entries are immutable';
END
$fn$;
DROP TRIGGER IF EXISTS audit_no_change ON audit_logs;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION hcm_audit_immutable();

-- Finalized payroll is locked in the database as well as in the service layer.
CREATE OR REPLACE FUNCTION hcm_payroll_run_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'payroll run is finalized and locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS payroll_run_lock ON payroll_runs;
CREATE TRIGGER payroll_run_lock BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION hcm_payroll_run_lock();

CREATE OR REPLACE FUNCTION hcm_payslip_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  rid integer;
BEGIN
  IF TG_OP = 'INSERT' THEN rid := NEW.run_id; ELSE rid := OLD.run_id; END IF;
  IF (SELECT status FROM payroll_runs WHERE id = rid) = 'finalized' THEN
    RAISE EXCEPTION 'payroll run is finalized and locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS payslip_lock ON payslips;
CREATE TRIGGER payslip_lock BEFORE INSERT OR UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION hcm_payslip_lock();

-- Supabase exposes the public schema through its REST API. This app only talks to the
-- database from the server, so lock the tables down for the anon/authenticated roles.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meta','settings','departments','designations','leave_types','holidays','employees','users',
    'attendance','attendance_corrections','leave_requests','payroll_runs','payslips','announcements','notifications',
    'audit_logs','ai_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$do$;
`;
