-- rint:migration
-- objective: Expose the rint schema to Supabase PostgREST so the engine can read/write MVP tables
-- risk: medium; updates PostgREST exposed schemas for authenticator role
-- rollback: remove rint from authenticator.pgrst.db_schemas, then notify pgrst to reload config and schema

begin;

do $$
declare
  merged_schemas text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    raise exception 'Cannot expose rint schema because PostgREST authenticator role was not found';
  end if;

  with raw_settings as (
    select setting
    from pg_roles roles
    cross join lateral unnest(coalesce(roles.rolconfig, array[]::text[])) as role_config(setting)
    where roles.rolname = 'authenticator'
      and setting like '%pgrst.db_schemas=%'

    union all

    select setting
    from pg_db_role_setting settings
    left join pg_roles roles on roles.oid = settings.setrole
    left join pg_database databases on databases.oid = settings.setdatabase
    cross join lateral unnest(coalesce(settings.setconfig, array[]::text[])) as db_role_config(setting)
    where (roles.rolname = 'authenticator' or settings.setrole = 0)
      and (databases.datname = current_database() or settings.setdatabase = 0)
      and setting like '%pgrst.db_schemas=%'
  ),
  required_schemas as (
    select schema_name, ordinal
    from unnest(array['public', 'graphql_public', 'rint']) with ordinality as required(schema_name, ordinal)
  ),
  configured_schemas as (
    select trim(schema_value) as schema_name, 1000 + ordinal as ordinal
    from raw_settings
    cross join lateral string_to_table(
      regexp_replace(setting, '^"?pgrst\.db_schemas"?=', ''),
      ','
    ) with ordinality as configured(schema_value, ordinal)
    where trim(schema_value) <> ''
  ),
  merged as (
    select schema_name, min(ordinal) as first_seen
    from (
      select schema_name, ordinal
      from required_schemas

      union all

      select schema_name, ordinal
      from configured_schemas
    ) schemas
    where schema_name <> ''
    group by schema_name
  )
  select string_agg(schema_name, ',' order by first_seen)
  into merged_schemas
  from merged;

  execute format('alter role authenticator set pgrst.db_schemas to %L', merged_schemas);
end;
$$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

commit;
