-- =============================================================================
-- Rename the legacy bootstrap admin from `admin@gmail.com` to
-- `mymail87455@gmail.com`. The original `admin@gmail.com` was a placeholder
-- used during early development; it is no longer a valid login.
--
-- This migration:
--   1. Renames the row in `auth.users` (preserving id, hashed password, and
--      `email_confirmed_at`) so the user can sign in with the new address
--      using the same password they already had.
--   2. Updates `auth.identities` for the `email` provider so Supabase Auth
--      finds the new address when validating credentials.
--   3. Syncs `public.profiles.email` to whatever `auth.users.email` ends up
--      holding for that id, and ensures the row stays role=admin / active.
--
-- Idempotent: safe to run multiple times. Skipped if `admin@gmail.com`
-- doesn't exist on the project, or if `mymail87455@gmail.com` is already
-- present on a different user (in which case the legacy row is left as-is
-- and a warning is raised so an operator can resolve the conflict).
-- =============================================================================

do $$
declare
  v_old   text := 'admin@gmail.com';
  v_new   text := 'mymail87455@gmail.com';
  v_user  uuid;
  v_clash uuid;
begin
  select id
    into v_user
    from auth.users
   where lower(email) = lower(v_old)
   limit 1;

  if v_user is null then
    raise notice 'rename_bootstrap_admin_email: no auth user with email % found; nothing to rename.', v_old;
  else
    select id
      into v_clash
      from auth.users
     where lower(email) = lower(v_new)
       and id <> v_user
     limit 1;

    if v_clash is not null then
      raise warning 'rename_bootstrap_admin_email: % already exists on a different auth user (%). Skipping rename — resolve manually.', v_new, v_clash;
    else
      update auth.users
         set email              = v_new,
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at         = now()
       where id = v_user;

      update auth.identities
         set provider_id   = v_new,
             identity_data = coalesce(identity_data, '{}'::jsonb)
                              || jsonb_build_object('email', v_new)
       where user_id  = v_user
         and provider = 'email';

      raise notice 'rename_bootstrap_admin_email: renamed % -> % for user %', v_old, v_new, v_user;
    end if;
  end if;
end$$;

-- Keep `public.profiles.email` aligned with `auth.users.email` (covers the
-- rename above plus any other drift) and re-promote the bootstrap admin row
-- so a refreshed install / reseed never resurrects the old address.

update public.profiles p
   set email = u.email
  from auth.users u
 where p.id = u.id
   and p.email is distinct from u.email;

update public.profiles
   set role   = 'admin',
       status = 'active'
 where email = 'mymail87455@gmail.com'
   and (role <> 'admin' or status <> 'active');
