-- The outbox took addresses of at most 200 characters, but sign-in (Cognito) accepts any valid
-- address, up to 254 (RFC 5321's limit). The daily reminders go out in one transaction, so a single
-- owner or admin with a 201-254 character address failed the whole run, for every workspace, every
-- day. The outbox now takes any address sign-in can produce.
alter table app.outbox drop constraint outbox_to_email_check;
alter table app.outbox add constraint outbox_to_email_check check (length(to_email) <= 254);
