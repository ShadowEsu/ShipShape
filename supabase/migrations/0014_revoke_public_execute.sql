-- Security F2-1: 0001's `alter default privileges in schema app revoke execute on functions from
-- public` does nothing (per-schema defaults can only add to the global ones), so every function
-- created without its own revoke has been executable by PUBLIC, audit_write among them: a member
-- could write a hash-valid history row into any workspace. Revoke it from every app function now,
-- and by default for functions the migration role creates from here on. Roles keep the explicit
-- grants each migration gives them.

alter default privileges revoke execute on functions from public;

do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'app'::regnamespace loop
    execute format('revoke execute on function %s from public', f);
  end loop;
end
$$;
