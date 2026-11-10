# Supabase database audit — 2026-11-10

Project: `beach-condition` (`cretgbjdghydsxxjugzg`, eu-west-1)  
Repository branch: `feature/anonymous-auth-bootstrap`

This is a read-only audit snapshot of the live database. It is **not** a recovered copy of the original migrations and must not be applied as SQL.

## Remote migration history

The Supabase migration ledger currently contains:

- `20261029150148 restrict_spatial_ref_sys_public_roles`
- `20261102080228 report_per_sector_cooldown`
- `20261102085129 add_beach_surface_and_filters`
- `20261102090252 aggregate_latest_user_beach_votes`
- `20261103120519 restrict_confirmation_and_photo_reads`
- `20261105161641 add_shared_sector_weather_cache`

The corresponding SQL files are absent from the repository branch. The migration names/versions were read from the remote ledger; their original SQL bodies were not available through that listing. Do not fabricate those files or replay a guessed baseline against the existing production database.

## Public application tables

### beach_sectors
- `id bigint` primary key
- `name text NOT NULL`
- `access_name text NULL`
- `latitude double precision NOT NULL`
- `longitude double precision NOT NULL`
- `is_active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `geometry geometry NULL`
- `beach_type text NOT NULL DEFAULT 'sand'`
- Check: beach_type is `sand` or `pebble`
- Indexes: PK(id), GiST(geometry)

### reports
- `id bigint` primary key
- `sector_id bigint NOT NULL` references beach_sectors(id) ON DELETE CASCADE
- `algae algae_level NOT NULL`
- `jellyfish jellyfish_level NOT NULL`
- `waves wave_level NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `user_id uuid NULL` references auth.users(id) ON DELETE SET NULL
- Indexes: PK(id), created_at DESC, (sector_id, created_at DESC), sector_id, partial (user_id, created_at DESC) where user_id IS NOT NULL

### confirmations
- `id bigint` primary key
- `report_id bigint NOT NULL` references reports(id) ON DELETE CASCADE
- `created_at timestamptz NOT NULL DEFAULT now()`
- `user_id uuid NULL` references auth.users(id) ON DELETE SET NULL
- Indexes: PK(id), created_at DESC, report_id, partial (user_id, created_at DESC), unique partial (report_id,user_id) where user_id IS NOT NULL

### photos
- `id bigint` primary key
- `report_id bigint NOT NULL` references reports(id) ON DELETE CASCADE
- `storage_path text NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `user_id uuid NULL` references auth.users(id) ON DELETE SET NULL
- Indexes: PK(id), report_id

### beach_map_admins
- `user_id uuid` primary key, references auth.users(id) ON DELETE CASCADE
- `created_at timestamptz NOT NULL DEFAULT now()`

### sector_weather_cache
- `latitude double precision NOT NULL`
- `longitude double precision NOT NULL`
- `temperature double precision NULL`
- `weather_code integer NULL`
- `fetched_at timestamptz NULL`
- `refresh_until timestamptz NULL`
- Composite primary key (latitude, longitude)
- Checks: latitude in [-90,90], longitude in [-180,180]

## Enums
- `algae_level`: none, low, high
- `jellyfish_level`: none, low, high
- `wave_level`: none, medium, high

## Views
`public.sector_current_status` aggregates each user's latest report per sector within the last four hours. It computes per-condition vote counts, selects the most-voted value (latest vote breaks ties), and derives status color/icon with priority algae → waves → jellyfish. It includes only active sectors.

## RLS policies observed

- `beach_sectors`: SELECT for anon/authenticated where is_active = true
- `reports`: SELECT for anon/authenticated (true)
- `beach_map_admins`: SELECT authenticated own row (user_id = auth.uid())
- `confirmations`: SELECT authenticated own rows (user_id = auth.uid())
- `photos`: RLS enabled, no policies
- `sector_weather_cache`: RLS enabled, no policies

The last two tables have no anon/authenticated RLS read policy. The weather cache is accessed by the Edge Function using the service role. Photo access should be confirmed against the client code and Storage configuration before adding a policy.

## Functions observed

All SECURITY DEFINER application functions below have an empty search_path configured and schema-qualify application objects:

- `beach_map_is_admin()`: checks auth.uid() against beach_map_admins.
- `admin_deactivate_beach_sector(bigint)`: checks authenticated admin, deactivates sector.
- `admin_save_beach_sector(bigint,text,text,jsonb,text)`: checks authenticated admin; validates Polygon, geometry and beach_type; saves sector.
- Legacy overload `admin_save_beach_sector(bigint,text,text,jsonb)`: exists remotely; same general behavior but no beach_type argument. Its ACL differs from the current overload.
- `submit_beach_report(bigint,algae_level,wave_level,jellyfish_level)`: requires auth.uid(), active sector; per-user advisory lock; one report per sector per five minutes and max five per hour.
- `confirm_beach_report(bigint)`: requires auth.uid(), prevents confirming own report, advisory lock, max twenty confirmations/hour, unique per user/report.
- `get_my_sector_activity(bigint)`: returns current user's latest report and confirmation state.
- `get_sector_current_status()`: SECURITY DEFINER wrapper over sector_current_status, granted to anon and authenticated for public map reads.
- `claim_sector_weather_refresh(double precision,double precision)`: non-SECURITY DEFINER; service-role only; atomically claims a 30-second refresh slot.
- `save_beach_sector_geometry(bigint,jsonb)`: non-SECURITY DEFINER; service-role only.

## Security observations requiring follow-up

1. The advisor reports RLS disabled on `spatial_ref_sys`. PostGIS 3.3.7 is installed in `public`. A historical migration named `restrict_spatial_ref_sys_public_roles` exists, but the live catalog still reports broad table grants to anon/authenticated. Inspect exact effective privileges and extension relocation options before changing this system table.
2. Advisor reports PostGIS in public. Moving an installed extension can affect function references and dependent objects; do not move it without a dedicated tested migration.
3. `get_sector_current_status()` is SECURITY DEFINER and intentionally executable by anon/authenticated. It has empty search_path and only selects the public status view. Keep public read behavior unless product requirements change.
4. `admin_*`, `submit_beach_report`, `confirm_beach_report`, and `get_my_sector_activity` are SECURITY DEFINER but require authenticated identity/admin checks in their bodies. Their intended authenticated grants are present.
5. The old four-argument `admin_save_beach_sector` overload remains in the database. Review client references and remove only after confirming it is unused.
6. `photos` has no RLS policies while anon/authenticated have SELECT table grants. RLS currently blocks row access; confirm client and storage flow before designing narrow policies.
7. `sector_weather_cache` has no RLS policies; service_role has access. This is consistent with the server-side Edge Function design.
8. Storage bucket query returned no buckets. If photo uploads are planned, the Storage bucket/policies still need to be created and verified.
9. Auth leaked-password protection is reported disabled by the Supabase advisor; enable it in Auth security settings when available.

## Next engineering steps

- Restore a clean migration history through a deliberate baseline strategy; do not copy fabricated SQL into `supabase/migrations`.
- Inspect app references to photo table/storage, legacy admin RPC overload, and PostGIS helper functions.
- Verify exact grants for `spatial_ref_sys` and correct only the public-role privileges that are not required by the application.
- Run lint, production build, and browser smoke tests in CI and record actual run URLs/results.
- Do not merge the feature branch until CI and the security review are complete.
