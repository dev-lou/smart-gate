-- ============================================================
-- Smart Gate — Demo operator login (run once in Supabase SQL Editor)
-- ============================================================
-- Creates (or resets) a confirmed email/password account so the
-- Dashboard (:3000) and Guard Station (:3001) can be signed into
-- without going through Authentication -> Users by hand.
--
-- Demo credentials created by this script:
--   email    : demo@isufst.edu.ph
--   password : SmartGate2026!
--
-- The same pair is what the login screens display, and what
-- NEXT_PUBLIC_DEMO_EMAIL / NEXT_PUBLIC_DEMO_PASSWORD hold in each
-- service's .env.local. Change both together if you rename it.
--
-- Safe to re-run: an existing account is reset to this password
-- instead of failing on a duplicate email.
--
-- Works on both GoTrue schema generations: auth.identities.id is
-- `uuid` on newer projects and `text` on older ones, so the insert
-- is built dynamically to match whatever this database uses.
--
-- SECURITY: every signed-in user is a full operator in this schema
-- ("Authenticated users can manage students/access_logs/settings"),
-- so this account is admin-equivalent. Do not ship it to a public
-- deployment — clear NEXT_PUBLIC_DEMO_* there and pick a real
-- password, or delete this user when the defense is over.
-- ============================================================

do $$
declare
  demo_email    text := 'demo@isufst.edu.ph';
  demo_password text := 'SmartGate2026!';
  demo_uid      uuid;
  identity_id_type text;
begin
  select id into demo_uid from auth.users where email = demo_email;

  if demo_uid is null then
    demo_uid := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      demo_uid,
      'authenticated',
      'authenticated',
      demo_email,
      crypt(demo_password, gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '',
      '',
      '',
      ''
    );

    raise notice 'Created demo user %', demo_email;
  else
    -- Reset path: keep the row, make sure it can sign in with the demo password.
    update auth.users
       set encrypted_password = crypt(demo_password, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           confirmation_token = '',
           recovery_token     = '',
           updated_at         = now()
     where id = demo_uid;

    raise notice 'Reset password for existing demo user %', demo_email;
  end if;

  -- GoTrue needs a matching 'email' identity row for password sign-in.
  if not exists (
    select 1 from auth.identities where user_id = demo_uid and provider = 'email'
  ) then
    select data_type into identity_id_type
      from information_schema.columns
     where table_schema = 'auth'
       and table_name   = 'identities'
       and column_name  = 'id';

    if identity_id_type = 'uuid' then
      execute $sql$
        insert into auth.identities
          (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
        values
          ($1, $2, $3, 'email', $4, now(), now(), now())
      $sql$
      using gen_random_uuid(),
            demo_uid,
            jsonb_build_object('sub', demo_uid::text, 'email', demo_email, 'email_verified', true),
            demo_uid::text;
    else
      execute $sql$
        insert into auth.identities
          (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
        values
          ($1, $2, $3, 'email', $4, now(), now(), now())
      $sql$
      using gen_random_uuid()::text,
            demo_uid,
            jsonb_build_object('sub', demo_uid::text, 'email', demo_email, 'email_verified', true),
            demo_uid::text;
    end if;
  end if;
end $$;

-- Verify (expect exactly one confirmed row):
select u.email,
       u.email_confirmed_at is not null as confirmed,
       i.provider
  from auth.users u
  left join auth.identities i on i.user_id = u.id and i.provider = 'email'
 where u.email = 'demo@isufst.edu.ph';
