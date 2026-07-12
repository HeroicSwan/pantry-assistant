# Final security review

Reviewed boundaries include authentication, session resolution, organization/location scope, suspended membership, ledger immutability, reservations, forecast snapshots, consent, provider webhooks, controlled assistant tools, proposal confirmation, exports, secrets, and error mapping.

Critical protections:

- Server operations authorize independently through effective permissions.
- Database, Twilio, OpenAI, and cron secrets never use public environment variables.
- SMS eligibility is derived from the latest consent event; opt-outs block retries and future sends.
- Provider events and inbound IDs are deduplicated; terminal message contents are immutable.
- The assistant has no arbitrary SQL/tool execution and no autonomous message or inventory mutation.
- Proposals are scoped, expire, carry state fingerprints, and execute once.
- CSV cells beginning with formula operators are neutralized.
- Forecast, audit, ledger, provider-event, tool-run, and export histories preserve evidence.

The application uses trusted server-only PostgreSQL rather than Supabase RLS. Production risk therefore depends on keeping all database credentials server-only and maintaining complete service/repository scoping. Live provider configuration and external penetration testing remain deployment responsibilities.
