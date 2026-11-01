-- Archiving takes a document off passport links for good (review W14-3).
--
-- Before: archiving changed only documents.status, and passport_open/passport_file filter
-- status = 'active' when a link is read. So an archived document dropped out of every link only while
-- it stayed archived; restoring it put it back on every link still open, for up to 90 days, with no
-- warning, while the document page said it "isn't shared". Now the archive itself removes the
-- document from every link, and a restore adds it to none.
--
-- The trigger runs as its owner (security definer): signed-in users have no delete right on
-- share_link_documents, and only this archive path removes rows. It touches only rows of the document
-- being archived, in that document's own workspace (share_link_documents.org_id is the document's, by
-- the document_in_org trigger of 0003).

create function app.unshare_archived() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from app.share_link_documents sd where sd.document_id = new.id and sd.org_id = new.org_id;
  return null;
end
$$;

create trigger documents_unshare_archived after update of status on app.documents
for each row when (new.status = 'archived' and old.status is distinct from new.status)
execute function app.unshare_archived();

-- Documents archived before this migration come off their links the same way.
delete from app.share_link_documents sd using app.documents d where d.id = sd.document_id and d.status = 'archived';
