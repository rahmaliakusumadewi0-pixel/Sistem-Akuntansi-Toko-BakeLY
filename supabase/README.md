# Supabase setup for BakeLY

Restore a paused Supabase project before opening its SQL Editor. In an existing
project, run `upgrade_accounting.sql` once to add recipes, production costing,
stock receipts, and sale cancellation while preserving existing records. For a
new demo project, run `schema.sql` instead.

After the migration succeeds, use the Project URL and publishable (or legacy
anon) key in the app's connection settings. Never use a `service_role` or
secret key in the browser.

The no-login demo grants the `anon` role access to shared sample data. Anyone
with the project URL and public key can view or change that demo data. Do not
use this configuration for real customer, financial, or other private records.
