CREATE TABLE IF NOT EXISTS studio_study_courses (
  id uuid PRIMARY KEY,
  owner_key text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','ready','failed')),
  source bytea,
  deck jsonb,
  progress jsonb NOT NULL DEFAULT '{}',
  town jsonb NOT NULL DEFAULT '{"wood":0,"buildings":[]}',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_study_owner ON studio_study_courses(owner_key,created_at);
ALTER TABLE studio_study_courses ADD COLUMN IF NOT EXISTS adventure jsonb NOT NULL DEFAULT '{}';
ALTER TABLE studio_study_courses ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE studio_study_courses ADD COLUMN IF NOT EXISTS import_key uuid;
CREATE INDEX IF NOT EXISTS studio_study_content ON studio_study_courses(owner_key,content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS studio_study_import_key ON studio_study_courses(owner_key,import_key) WHERE import_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS studio_study_answers (
  course_id uuid NOT NULL REFERENCES studio_study_courses(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY(course_id,request_key)
);
CREATE TABLE IF NOT EXISTS studio_projects (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  source text NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'sample')),
  latest_version_id uuid,
  released_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  number integer NOT NULL CHECK (number > 0),
  commit_sha text NOT NULL,
  artifact_key text NOT NULL,
  artifact_hash text NOT NULL,
  summary text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('generated', 'sample', 'restore')),
  source_version_id uuid REFERENCES studio_versions(id),
  standards_version text NOT NULL,
  validation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
CREATE TABLE IF NOT EXISTS studio_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  base_version_id uuid REFERENCES studio_versions(id),
  request_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  phase text NOT NULL DEFAULT 'queued',
  cancel_requested boolean NOT NULL DEFAULT false,
  attempt integer NOT NULL DEFAULT 0,
  lease_token uuid,
  heartbeat_at timestamptz,
  prepared jsonb,
  error text,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_active_job ON studio_jobs(project_id) WHERE status IN ('queued', 'running');
CREATE TABLE IF NOT EXISTS studio_messages (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  job_id uuid REFERENCES studio_jobs(id),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_events (
  id serial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES studio_jobs(id),
  phase text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_experiences (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES studio_jobs(id),
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  standards_version text NOT NULL,
  outcome text NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'observation',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_worker_health (
  id integer PRIMARY KEY CHECK (id = 1),
  heartbeat_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_users (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  access_hash text NOT NULL UNIQUE,
  disabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  daily_job_limit integer NOT NULL DEFAULT 10 CHECK (daily_job_limit BETWEEN 1 AND 100),
  total_job_limit integer NOT NULL DEFAULT 100 CHECK (total_job_limit BETWEEN 1 AND 10000),
  project_limit integer NOT NULL DEFAULT 10 CHECK (project_limit BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES studio_users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_sessions_user ON studio_sessions(user_id);
CREATE TABLE IF NOT EXISTS studio_login_limits (
  bucket bigint PRIMARY KEY,
  attempts integer NOT NULL
);
ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES studio_users(id);
CREATE INDEX IF NOT EXISTS studio_projects_owner ON studio_projects(owner_id);

CREATE TABLE IF NOT EXISTS studio_evolution_candidates (
  id uuid PRIMARY KEY,
  experience_id uuid NOT NULL REFERENCES studio_experiences(id),
  lesson_index integer NOT NULL CHECK (lesson_index BETWEEN 0 AND 2),
  author_id uuid REFERENCES studio_users(id),
  lesson jsonb NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','rejected')),
  review_note text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES studio_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(experience_id,lesson_index,content_hash)
);
CREATE TABLE IF NOT EXISTS studio_knowledge_releases (
  id uuid PRIMARY KEY,
  number serial UNIQUE NOT NULL,
  request_key uuid UNIQUE NOT NULL,
  requested_candidate_ids uuid[] NOT NULL,
  base_release_id uuid REFERENCES studio_knowledge_releases(id),
  label text NOT NULL,
  entries jsonb NOT NULL,
  content_hash text NOT NULL,
  suite_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','passed','failed')),
  report jsonb,
  error text,
  created_by uuid REFERENCES studio_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  published_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_evolution_check ON studio_knowledge_releases ((true)) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS studio_public_knowledge (
  id integer PRIMARY KEY CHECK (id=1),
  release_id uuid REFERENCES studio_knowledge_releases(id)
);
INSERT INTO studio_public_knowledge(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS studio_evolution_events (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES studio_users(id),
  action text NOT NULL,
  candidate_id uuid REFERENCES studio_evolution_candidates(id),
  release_id uuid REFERENCES studio_knowledge_releases(id),
  previous_release_id uuid REFERENCES studio_knowledge_releases(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_canvas (
  project_id uuid PRIMARY KEY REFERENCES studio_projects(id),
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_canvas_assets (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  name text NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 2000000),
  width integer NOT NULL,
  height integer NOT NULL,
  mime text NOT NULL CHECK (mime='image/png'),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,sha256)
);
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS canvas_snapshot jsonb;
ALTER TABLE studio_versions ADD COLUMN IF NOT EXISTS canvas_snapshot jsonb;
ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS draft_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS studio_project_draft_key ON studio_projects(draft_key) WHERE draft_key IS NOT NULL;

ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'build' CHECK (kind IN ('chat','build'));
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS plan jsonb;
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS planning_reply text;
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS result_version_id uuid REFERENCES studio_versions(id);
ALTER TABLE studio_versions ADD COLUMN IF NOT EXISTS development_plan jsonb;

CREATE TABLE IF NOT EXISTS studio_game_ratings (
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  voter_key text NOT NULL,
  rating smallint NOT NULL CHECK (rating IN (-1,1)),
  PRIMARY KEY (project_id,voter_key)
);
CREATE TABLE IF NOT EXISTS studio_game_visits (
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  visit_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,visit_id)
);

-- Referral awards are a separate, non-renewing pool of creation credits.
ALTER TABLE studio_users ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES studio_users(id);
ALTER TABLE studio_users ADD COLUMN IF NOT EXISTS invitation_rewarded_at timestamptz;
ALTER TABLE studio_users ADD COLUMN IF NOT EXISTS bonus_job_credits integer NOT NULL DEFAULT 0 CHECK (bonus_job_credits >= 0);
CREATE INDEX IF NOT EXISTS studio_users_invited_by ON studio_users(invited_by);
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS uses_bonus boolean NOT NULL DEFAULT false;

-- Identity stays separate from project ownership and invitation credentials.
ALTER TABLE studio_users ALTER COLUMN access_hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS studio_identities (
  provider text NOT NULL,
  app_id text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES studio_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, app_id, subject),
  UNIQUE (provider, app_id, user_id)
);

ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'default' CHECK (model IN ('default','gpt-6-astra'));

-- Purchased credits are separate from invitation awards and basic quotas.
ALTER TABLE studio_users ADD COLUMN IF NOT EXISTS paid_job_credits integer NOT NULL DEFAULT 0;
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS uses_paid boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS studio_credit_orders (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES studio_users(id),
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  pack_id text NOT NULL,
  credits integer NOT NULL CHECK (credits > 0),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  merchant_id text NOT NULL,
  provider_id text UNIQUE,
  capture_id text UNIQUE,
  capture_request_id uuid NOT NULL UNIQUE,
  approval_url text,
  status text NOT NULL DEFAULT 'CREATING',
  granted boolean NOT NULL DEFAULT false,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_credit_orders_owner ON studio_credit_orders(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS studio_credit_events (
  environment text NOT NULL,
  id text NOT NULL,
  order_id uuid NOT NULL REFERENCES studio_credit_orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,id)
);
CREATE TABLE IF NOT EXISTS studio_credit_ledger (
  order_id uuid NOT NULL REFERENCES studio_credit_orders(id),
  kind text NOT NULL CHECK (kind IN ('purchase','revoke')),
  delta integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(order_id,kind)
);

-- Image projects use the same ownership, conversations and immutable versions.
ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS media_kind text NOT NULL DEFAULT 'game' CHECK(media_kind IN ('game','image'));
CREATE TABLE IF NOT EXISTS studio_image_assets (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES studio_projects(id),
 name text NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS image_asset_id uuid REFERENCES studio_image_assets(id);

CREATE TABLE IF NOT EXISTS studio_image_batches (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES studio_projects(id),
 base_version_id uuid REFERENCES studio_versions(id), request_key uuid NOT NULL UNIQUE, request_hash text NOT NULL,
 prompt text NOT NULL, styles jsonb NOT NULL, request_keys jsonb NOT NULL, model text NOT NULL,
 canvas_snapshot jsonb, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled','failed')),
 error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_active_image_batch ON studio_image_batches(project_id) WHERE status='active';
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS image_batch_id uuid REFERENCES studio_image_batches(id);
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS image_batch_index integer;
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS image_reference_version_id uuid REFERENCES studio_versions(id);
CREATE UNIQUE INDEX IF NOT EXISTS studio_image_batch_item ON studio_jobs(image_batch_id,image_batch_index);

ALTER TABLE studio_image_batches ADD COLUMN IF NOT EXISTS grouped boolean NOT NULL DEFAULT false;
ALTER TABLE studio_image_batches ADD COLUMN IF NOT EXISTS result_version_id uuid REFERENCES studio_versions(id);
