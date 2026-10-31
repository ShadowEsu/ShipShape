-- Owners and admins can rename their workspace (policy org_rename, 0001), and the name is what people
-- outside it see on its passport links, signature requests and Collect pages. A rename goes into the
-- workspace history like every other change, with who did it.
create function app.audit_workspace_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    perform app.audit_write(new.id, (select auth.uid()), 'workspace.renamed', new.id);
  end if;
  return null;
end
$$;

create trigger organizations_audit after update of name on app.organizations
  for each row execute function app.audit_workspace_rename();
