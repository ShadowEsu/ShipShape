-- The daily run moves a batch of stored files it couldn't remove (one key under a policy or lock) to
-- the back of the queue, so the paths behind it still get their turn (review #16). That is an update
-- of queued_at by the service role, which 0028 gave select and delete only.
grant update (queued_at) on app.storage_cleanup to service_role;
