CREATE TABLE IF NOT EXISTS "chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_content_id" integer NOT NULL,
	"symbol_id" integer,
	"content" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"embedding" vector(768),
	"embedding_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_contents" (
	"id" serial PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"language" text,
	CONSTRAINT "file_contents_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_content_id" integer NOT NULL,
	"source" text NOT NULL,
	"names" text[] DEFAULT '{}' NOT NULL,
	"default_name" text,
	"is_namespace" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ref_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_ref_id" integer NOT NULL,
	"file_content_id" integer NOT NULL,
	"path" text NOT NULL,
	CONSTRAINT "uq_ref_files_ref_path" UNIQUE("repo_ref_id","path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repo_refs" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"ref" text NOT NULL,
	"commit_sha" text NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"stage_message" text,
	"semver" text,
	"indexed_at" timestamp,
	"indexing_started_at" timestamp,
	"language_stats" jsonb,
	"files_total" integer DEFAULT 0 NOT NULL,
	"files_processed" integer DEFAULT 0 NOT NULL,
	"chunks_total" integer DEFAULT 0 NOT NULL,
	"chunks_embedded" integer DEFAULT 0 NOT NULL,
	"indexing_error" text,
	CONSTRAINT "uq_repo_refs_repo_ref" UNIQUE("repo_id","ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repos" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"local_path" text,
	"remote_url" text,
	"glob_patterns" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repos_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "symbols" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_content_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"signature" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"documentation" text
);
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_file_content_id_file_contents_id_fk" FOREIGN KEY ("file_content_id") REFERENCES "public"."file_contents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_symbol_id_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."symbols"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "imports" ADD CONSTRAINT "imports_file_content_id_file_contents_id_fk" FOREIGN KEY ("file_content_id") REFERENCES "public"."file_contents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ref_files" ADD CONSTRAINT "ref_files_repo_ref_id_repo_refs_id_fk" FOREIGN KEY ("repo_ref_id") REFERENCES "public"."repo_refs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "ref_files" ADD CONSTRAINT "ref_files_file_content_id_file_contents_id_fk" FOREIGN KEY ("file_content_id") REFERENCES "public"."file_contents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "repo_refs" ADD CONSTRAINT "repo_refs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_file_content_id_file_contents_id_fk" FOREIGN KEY ("file_content_id") REFERENCES "public"."file_contents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_embedding" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
