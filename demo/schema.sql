-- Structure only; contains no data. Requires the pg_trgm extension.


create table if not exists "access_log" (
  "id" bigint not null,
  "at" timestamp with time zone default now() not null,
  "person_id" uuid,
  "email" text,
  "action" text not null,
  "actor" text,
  "detail" text
);

create table if not exists "access_tokens" (
  "token" text not null,
  "person_id" uuid not null,
  "purpose" text not null,
  "approver_email" text,
  "expires_at" timestamp with time zone not null,
  "created_at" timestamp with time zone default now() not null,
  "used_at" timestamp with time zone
);

create table if not exists "account_business" (
  "hr_id" text not null,
  "industry" text[] default '{}'::text[] not null,
  "hq_city" text,
  "project_countries" text[] default '{}'::text[] not null,
  "ticker" text,
  "stage" text,
  "study_level" text,
  "lead_project" text,
  "market_cap" text,
  "market_cap_ccy" text,
  "market_cap_amount" numeric,
  "enterprise_value" text,
  "ev_ccy" text,
  "ev_amount" numeric,
  "cash" text,
  "cash_ccy" text,
  "cash_amount" numeric,
  "cash_runway_months" text,
  "employees" text,
  "financials_as_of" date,
  "last_raise" text,
  "raise_type" text,
  "loaded_at" timestamp with time zone default now() not null,
  "sector" text[] default '{}'::text[] not null,
  "project_country_names" text[] default '{}'::text[] not null,
  "commodity" text[] default '{}'::text[] not null
);

create table if not exists "account_government" (
  "hr_id" text not null,
  "entity_kind" text,
  "mandate_focus" text[] default '{}'::text[] not null,
  "loaded_at" timestamp with time zone default now() not null
);

create table if not exists "account_intermediary" (
  "hr_id" text not null,
  "intermediary_type" text,
  "sector_focus" text[] default '{}'::text[] not null,
  "loaded_at" timestamp with time zone default now() not null,
  "sector" text[] default '{}'::text[] not null,
  "commodity" text[] default '{}'::text[] not null
);

create table if not exists "account_investor" (
  "hr_id" text not null,
  "investor_type" text[] default '{}'::text[] not null,
  "invests_in" text[] default '{}'::text[] not null,
  "invests_in_countries" text[] default '{}'::text[] not null,
  "invests_via" text[] default '{}'::text[] not null,
  "invests_via_basis" text,
  "aum_range" text,
  "aum_usd" numeric,
  "aum_basis" text,
  "cheque_size" text,
  "cheque_size_basis" text,
  "holds_hr_companies" text[] default '{}'::text[] not null,
  "loaded_at" timestamp with time zone default now() not null,
  "sector" text[] default '{}'::text[] not null,
  "commodity" text[] default '{}'::text[] not null,
  "invests_in_country_names" text[] default '{}'::text[] not null
);

create table if not exists "accounts" (
  "hr_id" text not null,
  "name" text not null,
  "domain" text,
  "segment" text not null,
  "type" text,
  "note" text,
  "contact_count" integer default 0 not null,
  "no_contact" boolean default false not null,
  "reachable_contact" boolean default false not null,
  "included" boolean default false not null,
  "owner" text[] default '{}'::text[] not null,
  "in_mailchimp" text,
  "countries" text[] default '{}'::text[] not null,
  "website" text,
  "loaded_at" timestamp with time zone default now() not null,
  "country_names" text[] default '{}'::text[] not null,
  "search_text" text,
  "company_linkedin" text
);

create table if not exists "app_people" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "email" text not null,
  "kind" text not null,
  "state" text not null,
  "role" text default ''::text not null,
  "reason" text,
  "password_hash" text,
  "requested_at" timestamp with time zone default now() not null,
  "decided_at" timestamp with time zone,
  "decided_by" text,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "last_sign_in_at" timestamp with time zone
);

create table if not exists "contact_emails" (
  "email" text not null,
  "contact_id" text not null,
  "is_primary" boolean default false not null,
  "status" text,
  "loaded_at" timestamp with time zone default now() not null
);

create table if not exists "contact_name_fixes" (
  "hr_id" text not null,
  "old_name" text not null,
  "new_name" text,
  "why" text not null,
  "fixed_at" timestamp with time zone default now() not null
);

create table if not exists "contact_notes" (
  "id" uuid default gen_random_uuid() not null,
  "contact_id" text not null,
  "body" text not null,
  "author" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "contacts" (
  "hr_id" text not null,
  "account_id" text,
  "full_name" text,
  "job_title" text,
  "email" text not null,
  "best_email" text,
  "domain" text,
  "segment" text not null,
  "role" text,
  "note" text,
  "owner" text[] default '{}'::text[] not null,
  "countries" text[] default '{}'::text[] not null,
  "replied" boolean default false not null,
  "in_mailchimp" boolean default false not null,
  "email_verified" boolean default false not null,
  "best_email_status" text,
  "loaded_at" timestamp with time zone default now() not null,
  "country_names" text[] default '{}'::text[] not null,
  "search_text" text,
  "full_name_raw" text,
  "segment_raw" text,
  "person_location" text
);

create table if not exists "deal_contacts" (
  "deal_id" uuid not null,
  "contact_id" text not null,
  "added_by" text,
  "added_at" timestamp with time zone default now() not null,
  "drafted_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "replied_at" timestamp with time zone,
  "sender" text,
  "conversation_id" text,
  "sent_source" text,
  "replied_source" text
);

create table if not exists "deal_documents" (
  "id" uuid default gen_random_uuid() not null,
  "deal_id" uuid not null,
  "name" text not null,
  "storage_path" text not null,
  "content_type" text,
  "bytes" bigint not null,
  "uploaded_at" timestamp with time zone default now() not null
);

create table if not exists "deal_drafts" (
  "id" uuid default gen_random_uuid() not null,
  "deal_id" uuid not null,
  "contact_id" text not null,
  "mailbox" text not null,
  "graph_id" text,
  "conversation_id" text,
  "subject" text,
  "template" text,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  "sent_at" timestamp with time zone
);

create table if not exists "deal_revisions" (
  "id" uuid default gen_random_uuid() not null,
  "deal_id" uuid not null,
  "documents" text[] default '{}'::text[] not null,
  "changes" jsonb default '[]'::jsonb not null,
  "gaps" text[] default '{}'::text[] not null,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "deal_target_removals" (
  "deal_id" uuid not null,
  "account_id" text not null,
  "removed_by" text,
  "removed_at" timestamp with time zone default now() not null
);

create table if not exists "deal_verdicts" (
  "deal_id" uuid not null,
  "account_id" text not null,
  "verdict" text not null,
  "decided_at" timestamp with time zone default now() not null,
  "source" text not null,
  "evidence" text,
  "contact_id" text,
  "message_id" text,
  "recorded_by" text not null
);

create table if not exists "deals" (
  "id" uuid default gen_random_uuid() not null,
  "reference" text,
  "title" text not null,
  "company_id" text,
  "summary" text,
  "raise_terms" text,
  "status" text default 'Live'::text not null,
  "document_url" text,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "sector" text,
  "countries" text,
  "raising" text,
  "valuation" text,
  "stage" text,
  "website" text,
  "closing" text,
  "highlights" text[],
  "document_name" text,
  "document_text" text,
  "written_at" timestamp with time zone,
  "draft_model" text,
  "draft_gaps" text[],
  "teaser" jsonb,
  "teaser_at" timestamp with time zone,
  "teaser_model" text,
  "teaser_image" text,
  "teaser_image_2" text
);

create table if not exists "email_templates" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "subject" text not null,
  "body" text not null,
  "sort" integer default 100 not null,
  "archived" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "kind" text default 'first'::text not null
);

create table if not exists "mail_events" (
  "message_id" text not null,
  "contact_id" text not null,
  "direction" text not null,
  "mailbox" text not null,
  "occurred_at" timestamp with time zone not null,
  "conversation_id" text,
  "subject" text,
  "seen_at" timestamp with time zone default now() not null,
  "read_at" timestamp with time zone
);

create table if not exists "mail_sync_state" (
  "mailbox" text not null,
  "folder" text not null,
  "last_seen" timestamp with time zone,
  "last_run_at" timestamp with time zone,
  "last_ok_at" timestamp with time zone,
  "last_error" text
);

create table if not exists "mail_sync_unmatched" (
  "message_id" text not null,
  "direction" text not null,
  "mailbox" text not null,
  "address" text,
  "contact_id" text not null,
  "occurred_at" timestamp with time zone,
  "subject" text,
  "reason" text not null,
  "seen_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone
);

create table if not exists "mailchimp_members" (
  "email" text not null,
  "name" text,
  "company" text,
  "status" text,
  "audiences" text[] default '{}'::text[] not null,
  "tags" text[] default '{}'::text[] not null,
  "signup_date" date,
  "last_changed" date,
  "rating" integer,
  "source" text,
  "contact_id" text,
  "loaded_at" timestamp with time zone default now() not null
);

create table if not exists "new_arrivals" (
  "email" text not null,
  "display_name" text,
  "domain" text,
  "mailboxes" text[] default '{}'::text[] not null,
  "inbound" integer default 0 not null,
  "outbound" integer default 0 not null,
  "first_seen" timestamp with time zone default now() not null,
  "last_seen" timestamp with time zone default now() not null,
  "processed_at" timestamp with time zone,
  "processed_run" text
);

alter table access_log add constraint "access_log_pkey" PRIMARY KEY (id);
alter table access_tokens add constraint "access_tokens_pkey" PRIMARY KEY (token);
alter table account_business add constraint "account_business_pkey" PRIMARY KEY (hr_id);
alter table account_government add constraint "account_government_pkey" PRIMARY KEY (hr_id);
alter table account_intermediary add constraint "account_intermediary_pkey" PRIMARY KEY (hr_id);
alter table account_investor add constraint "account_investor_pkey" PRIMARY KEY (hr_id);
alter table accounts add constraint "accounts_pkey" PRIMARY KEY (hr_id);
alter table app_people add constraint "app_people_pkey" PRIMARY KEY (id);
alter table contact_emails add constraint "contact_emails_pkey" PRIMARY KEY (email);
alter table contact_name_fixes add constraint "contact_name_fixes_pkey" PRIMARY KEY (hr_id);
alter table contact_notes add constraint "contact_notes_pkey" PRIMARY KEY (id);
alter table contacts add constraint "contacts_pkey" PRIMARY KEY (hr_id);
alter table deal_contacts add constraint "deal_contacts_pkey" PRIMARY KEY (deal_id, contact_id);
alter table deal_documents add constraint "deal_documents_pkey" PRIMARY KEY (id);
alter table deal_drafts add constraint "deal_drafts_pkey" PRIMARY KEY (id);
alter table deal_revisions add constraint "deal_revisions_pkey" PRIMARY KEY (id);
alter table deal_target_removals add constraint "deal_target_removals_pkey" PRIMARY KEY (deal_id, account_id);
alter table deal_verdicts add constraint "deal_verdicts_pkey" PRIMARY KEY (deal_id, account_id);
alter table deals add constraint "deals_pkey" PRIMARY KEY (id);
alter table email_templates add constraint "email_templates_pkey" PRIMARY KEY (id);
alter table mail_events add constraint "mail_events_pkey" PRIMARY KEY (message_id, contact_id, direction);
alter table mail_sync_state add constraint "mail_sync_state_pkey" PRIMARY KEY (mailbox, folder);
alter table mail_sync_unmatched add constraint "mail_sync_unmatched_pkey" PRIMARY KEY (contact_id, direction, reason);
alter table mailchimp_members add constraint "mailchimp_members_pkey" PRIMARY KEY (email);
alter table new_arrivals add constraint "new_arrivals_pkey" PRIMARY KEY (email);
alter table app_people add constraint "app_people_email_key" UNIQUE (email);
alter table deals add constraint "deals_reference_key" UNIQUE (reference);
alter table access_log add constraint "access_log_person_id_fkey" FOREIGN KEY (person_id) REFERENCES app_people(id) ON DELETE SET NULL;
alter table access_tokens add constraint "access_tokens_person_id_fkey" FOREIGN KEY (person_id) REFERENCES app_people(id) ON DELETE CASCADE;
alter table account_business add constraint "account_business_hr_id_fkey" FOREIGN KEY (hr_id) REFERENCES accounts(hr_id) ON DELETE CASCADE;
alter table account_government add constraint "account_government_hr_id_fkey" FOREIGN KEY (hr_id) REFERENCES accounts(hr_id) ON DELETE CASCADE;
alter table account_intermediary add constraint "account_intermediary_hr_id_fkey" FOREIGN KEY (hr_id) REFERENCES accounts(hr_id) ON DELETE CASCADE;
alter table account_investor add constraint "account_investor_hr_id_fkey" FOREIGN KEY (hr_id) REFERENCES accounts(hr_id) ON DELETE CASCADE;
alter table contact_emails add constraint "contact_emails_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(hr_id) ON DELETE CASCADE;
alter table contact_notes add constraint "contact_notes_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(hr_id) ON DELETE CASCADE;
alter table contacts add constraint "contacts_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(hr_id) ON DELETE SET NULL;
alter table deal_contacts add constraint "deal_contacts_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(hr_id) ON DELETE CASCADE;
alter table deal_contacts add constraint "deal_contacts_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
alter table deal_documents add constraint "deal_documents_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
alter table deal_drafts add constraint "deal_drafts_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
alter table deal_revisions add constraint "deal_revisions_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
alter table deal_target_removals add constraint "deal_target_removals_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(hr_id);
alter table deal_target_removals add constraint "deal_target_removals_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
alter table deal_verdicts add constraint "deal_verdicts_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
alter table deals add constraint "deals_company_id_fkey" FOREIGN KEY (company_id) REFERENCES accounts(hr_id) ON DELETE SET NULL;
alter table mailchimp_members add constraint "mailchimp_members_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(hr_id) ON DELETE SET NULL;
alter table access_tokens add constraint "access_tokens_purpose_check" CHECK ((purpose = ANY (ARRAY['set-password'::text, 'reset'::text, 'decide'::text])));
alter table app_people add constraint "app_people_kind_check" CHECK ((kind = ANY (ARRAY['microsoft'::text, 'password'::text])));
alter table app_people add constraint "app_people_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'active'::text, 'declined'::text, 'revoked'::text])));
alter table deal_verdicts add constraint "deal_verdicts_verdict_check" CHECK ((verdict = ANY (ARRAY['Accepted'::text, 'Passed'::text])));
alter table email_templates add constraint "email_templates_kind_check" CHECK ((kind = ANY (ARRAY['first'::text, 'follow'::text])));
alter table mail_events add constraint "mail_events_direction_check" CHECK ((direction = ANY (ARRAY['out'::text, 'in'::text])));

CREATE INDEX new_arrivals_pending ON public.new_arrivals USING btree (last_seen) WHERE (processed_at IS NULL);
CREATE INDEX new_arrivals_domain ON public.new_arrivals USING btree (domain);
CREATE INDEX deal_revisions_deal_idx ON public.deal_revisions USING btree (deal_id, created_at DESC);
CREATE INDEX facet_counts_idx ON public.facet_counts USING btree (segment, key);
CREATE INDEX facet_coverage_idx ON public.facet_coverage USING btree (segment);
CREATE INDEX contacts_owner_idx ON public.contacts USING gin (owner);
CREATE INDEX contacts_countries_idx ON public.contacts USING gin (countries);
CREATE INDEX contacts_name_sort_idx ON public.contacts USING btree (segment, full_name, hr_id);
CREATE INDEX contacts_fts_idx ON public.contacts USING gin (to_tsvector('simple'::regconfig, ((((((COALESCE(full_name, ''::text) || ' '::text) || COALESCE(email, ''::text)) || ' '::text) || COALESCE(job_title, ''::text)) || ' '::text) || COALESCE(domain, ''::text))));
CREATE INDEX contact_emails_contact_idx ON public.contact_emails USING btree (contact_id);
CREATE INDEX contacts_segment_idx ON public.contacts USING btree (segment);
CREATE INDEX contacts_role_idx ON public.contacts USING btree (role);
CREATE INDEX contacts_account_idx ON public.contacts USING btree (account_id);
CREATE INDEX contacts_domain_idx ON public.contacts USING btree (domain);
CREATE INDEX contacts_status_idx ON public.contacts USING btree (best_email_status);
CREATE INDEX contacts_replied_idx ON public.contacts USING btree (replied) WHERE replied;
CREATE INDEX contacts_mailchimp_idx ON public.contacts USING btree (in_mailchimp) WHERE in_mailchimp;
CREATE INDEX contact_emails_trgm_idx ON public.contact_emails USING gin (email gin_trgm_ops);
CREATE INDEX accounts_segment_idx ON public.accounts USING btree (segment);
CREATE INDEX accounts_type_idx ON public.accounts USING btree (type);
CREATE INDEX accounts_domain_idx ON public.accounts USING btree (domain);
CREATE INDEX accounts_reachable_idx ON public.accounts USING btree (reachable_contact) WHERE reachable_contact;
CREATE INDEX accounts_included_idx ON public.accounts USING btree (included) WHERE included;
CREATE INDEX accounts_owner_idx ON public.accounts USING gin (owner);
CREATE INDEX accounts_countries_idx ON public.accounts USING gin (countries);
CREATE INDEX accounts_name_sort_idx ON public.accounts USING btree (segment, name, hr_id);
CREATE INDEX accounts_fts_idx ON public.accounts USING gin (to_tsvector('simple'::regconfig, ((((COALESCE(name, ''::text) || ' '::text) || COALESCE(domain, ''::text)) || ' '::text) || COALESCE(website, ''::text))));
CREATE INDEX inv_type_idx ON public.account_investor USING gin (investor_type);
CREATE INDEX inv_sector_idx ON public.account_investor USING gin (invests_in);
CREATE INDEX inv_countries_idx ON public.account_investor USING gin (invests_in_countries);
CREATE INDEX inv_via_idx ON public.account_investor USING gin (invests_via);
CREATE INDEX inv_aum_idx ON public.account_investor USING btree (aum_range);
CREATE INDEX inv_aum_amt_idx ON public.account_investor USING btree (aum_usd DESC NULLS LAST);
CREATE INDEX biz_industry_idx ON public.account_business USING gin (industry);
CREATE INDEX biz_projects_idx ON public.account_business USING gin (project_countries);
CREATE INDEX biz_stage_idx ON public.account_business USING btree (stage);
CREATE INDEX biz_ticker_idx ON public.account_business USING btree (ticker);
CREATE INDEX inter_type_idx ON public.account_intermediary USING btree (intermediary_type);
CREATE INDEX inter_sector_idx ON public.account_intermediary USING gin (sector_focus);
CREATE INDEX gov_kind_idx ON public.account_government USING btree (entity_kind);
CREATE INDEX gov_focus_idx ON public.account_government USING gin (mandate_focus);
CREATE INDEX mc_status_idx ON public.mailchimp_members USING btree (status);
CREATE INDEX mc_contact_idx ON public.mailchimp_members USING btree (contact_id);
CREATE INDEX mc_audiences_idx ON public.mailchimp_members USING gin (audiences);
CREATE INDEX deals_status_idx ON public.deals USING btree (status);
CREATE INDEX deals_company_idx ON public.deals USING btree (company_id);
CREATE INDEX deal_contacts_c_idx ON public.deal_contacts USING btree (contact_id);
CREATE INDEX deal_contacts_sent_idx ON public.deal_contacts USING btree (contact_id, sent_at DESC NULLS LAST);
CREATE INDEX contact_notes_c_idx ON public.contact_notes USING btree (contact_id, created_at DESC);
CREATE INDEX inv_invests_names_idx ON public.account_investor USING gin (invests_in_country_names);
CREATE INDEX biz_sector_split_idx ON public.account_business USING gin (sector);
CREATE INDEX biz_project_names_idx ON public.account_business USING gin (project_country_names);
CREATE INDEX accounts_country_names_idx ON public.accounts USING gin (country_names);
CREATE INDEX contacts_country_names_idx ON public.contacts USING gin (country_names);
CREATE INDEX inv_sector_split_idx ON public.account_investor USING gin (sector);
CREATE INDEX inv_commodity_idx ON public.account_investor USING gin (commodity);
CREATE INDEX inter_sector_split_idx ON public.account_intermediary USING gin (sector);
CREATE INDEX inter_commodity_idx ON public.account_intermediary USING gin (commodity);
CREATE INDEX biz_commodity_idx ON public.account_business USING gin (commodity);
CREATE INDEX contacts_search_trgm_idx ON public.contacts USING gin (search_text gin_trgm_ops);
CREATE INDEX accounts_search_trgm_idx ON public.accounts USING gin (search_text gin_trgm_ops);
CREATE INDEX deals_created_idx ON public.deals USING btree (created_at DESC);
CREATE INDEX deal_contacts_conv_idx ON public.deal_contacts USING btree (contact_id, conversation_id) WHERE (conversation_id IS NOT NULL);
CREATE INDEX mail_events_contact_idx ON public.mail_events USING btree (contact_id, occurred_at DESC);
CREATE INDEX mail_events_conv_idx ON public.mail_events USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);
CREATE INDEX app_people_state_idx ON public.app_people USING btree (state, requested_at DESC);
CREATE INDEX access_tokens_person_idx ON public.access_tokens USING btree (person_id, purpose);
CREATE INDEX deal_drafts_deal_idx ON public.deal_drafts USING btree (deal_id, contact_id);
CREATE INDEX deal_drafts_conv_idx ON public.deal_drafts USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);
CREATE INDEX deal_documents_deal_idx ON public.deal_documents USING btree (deal_id);
CREATE UNIQUE INDEX email_templates_name_idx ON public.email_templates USING btree (name);
CREATE INDEX contact_facet_counts_idx ON public.contact_facet_counts USING btree (segment, key);
CREATE INDEX contact_facet_coverage_idx ON public.contact_facet_coverage USING btree (segment);
CREATE INDEX deal_verdicts_account_idx ON public.deal_verdicts USING btree (account_id);

create or replace view "account_facets" as
 SELECT a.hr_id,
    a.segment,
    a.country_names AS f_country,
        CASE
            WHEN a.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text]) THEN COALESCE(i.investor_type, '{}'::text[])
            WHEN a.segment = 'Intermediaries'::text THEN
            CASE
                WHEN it.intermediary_type IS NULL THEN '{}'::text[]
                ELSE ARRAY[it.intermediary_type]
            END
            WHEN a.segment = 'Government/Strategic'::text THEN
            CASE
                WHEN g.entity_kind IS NULL THEN '{}'::text[]
                ELSE ARRAY[g.entity_kind]
            END
            WHEN a.segment = 'Business'::text THEN COALESCE(b.sector, '{}'::text[])
            ELSE '{}'::text[]
        END AS f_type,
    COALESCE(i.sector, it.sector, g.mandate_focus, '{}'::text[]) AS f_sector,
    COALESCE(i.commodity, it.commodity, b.commodity, '{}'::text[]) AS f_commodity,
        CASE
            WHEN i.aum_range IS NULL THEN '{}'::text[]
            ELSE ARRAY[i.aum_range]
        END AS f_aum,
    COALESCE(i.invests_via, '{}'::text[]) AS f_via,
    COALESCE(i.invests_in_country_names, '{}'::text[]) AS f_invests_in,
        CASE
            WHEN b.stage IS NULL THEN '{}'::text[]
            ELSE ARRAY[b.stage]
        END AS f_stage,
    COALESCE(b.project_country_names, '{}'::text[]) AS f_project,
    a.segment AS view
   FROM accounts a
     LEFT JOIN account_investor i ON i.hr_id = a.hr_id
     LEFT JOIN account_intermediary it ON it.hr_id = a.hr_id
     LEFT JOIN account_business b ON b.hr_id = a.hr_id
     LEFT JOIN account_government g ON g.hr_id = a.hr_id;

create or replace view "contact_activity" as
 SELECT contact_id,
    max(occurred_at) FILTER (WHERE direction = 'out'::text) AS last_emailed_at,
    max(occurred_at) FILTER (WHERE direction = 'in'::text) AS last_reply_at,
    count(*) FILTER (WHERE direction = 'out'::text) AS emails_sent,
    count(*) FILTER (WHERE direction = 'in'::text) AS replies_received,
    (array_agg(mailbox ORDER BY occurred_at DESC) FILTER (WHERE direction = 'out'::text))[1] AS last_emailed_by
   FROM mail_events
  GROUP BY contact_id;

create materialized view if not exists "contact_facet_counts" as
 WITH unpivoted AS (
         SELECT c.hr_id,
            c.segment,
            'country'::text AS key,
            af.f_country AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'type'::text AS key,
            af.f_type AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'sector'::text AS key,
            af.f_sector AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'commodity'::text AS key,
            af.f_commodity AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'aum'::text AS key,
            af.f_aum AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'via'::text AS key,
            af.f_via AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'invests_in'::text AS key,
            af.f_invests_in AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'stage'::text AS key,
            af.f_stage AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'project'::text AS key,
            af.f_project AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        )
 SELECT unpivoted.segment,
    unpivoted.key,
    value.value,
    (count(DISTINCT unpivoted.hr_id))::integer AS n
   FROM unpivoted,
    LATERAL unnest(unpivoted.vals) value(value)
  WHERE ((value.value IS NOT NULL) AND (value.value <> ''::text))
  GROUP BY unpivoted.segment, unpivoted.key, value.value;;

create materialized view if not exists "contact_facet_coverage" as
 WITH unpivoted AS (
         SELECT c.hr_id,
            c.segment,
            'country'::text AS key,
            af.f_country AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'type'::text AS key,
            af.f_type AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'sector'::text AS key,
            af.f_sector AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'commodity'::text AS key,
            af.f_commodity AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'aum'::text AS key,
            af.f_aum AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'via'::text AS key,
            af.f_via AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'invests_in'::text AS key,
            af.f_invests_in AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'stage'::text AS key,
            af.f_stage AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        UNION ALL
         SELECT c.hr_id,
            c.segment,
            'project'::text AS key,
            af.f_project AS vals
           FROM (contacts c
             JOIN account_facets af ON ((af.hr_id = c.account_id)))
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
        ), totals AS (
         SELECT c.segment,
            (count(*))::integer AS segment_total
           FROM contacts c
          WHERE ((c.segment = ANY (ARRAY['Investors'::text, 'Family Offices'::text, 'High Net Worth'::text, 'Intermediaries'::text, 'Business'::text, 'Government/Strategic'::text])) AND (c.best_email_status IS DISTINCT FROM 'invalid'::text))
          GROUP BY c.segment
        )
 SELECT t.segment,
    u.key,
    (count(DISTINCT u.hr_id) FILTER (WHERE (COALESCE(array_length(u.vals, 1), 0) > 0)))::integer AS have,
    t.segment_total
   FROM (totals t
     JOIN unpivoted u ON ((u.segment = t.segment)))
  GROUP BY t.segment, u.key, t.segment_total;;

create materialized view if not exists "facet_counts" as
 WITH unpivoted AS (
         SELECT account_facets.hr_id,
            account_facets.segment,
            'country'::text AS key,
            account_facets.f_country AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'type'::text AS key,
            account_facets.f_type AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'sector'::text AS key,
            account_facets.f_sector AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'commodity'::text AS key,
            account_facets.f_commodity AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'aum'::text AS key,
            account_facets.f_aum AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'via'::text AS key,
            account_facets.f_via AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'invests_in'::text AS key,
            account_facets.f_invests_in AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'stage'::text AS key,
            account_facets.f_stage AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'project'::text AS key,
            account_facets.f_project AS vals
           FROM account_facets
        )
 SELECT unpivoted.segment,
    unpivoted.key,
    v.v AS value,
    (count(*))::integer AS n
   FROM (unpivoted
     CROSS JOIN LATERAL unnest(unpivoted.vals) v(v))
  WHERE (v.v <> 'N/A'::text)
  GROUP BY unpivoted.segment, unpivoted.key, v.v;;

create materialized view if not exists "facet_coverage" as
 WITH unpivoted AS (
         SELECT account_facets.hr_id,
            account_facets.segment,
            'country'::text AS key,
            account_facets.f_country AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'type'::text AS key,
            account_facets.f_type AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'sector'::text AS key,
            account_facets.f_sector AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'commodity'::text AS key,
            account_facets.f_commodity AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'aum'::text AS key,
            account_facets.f_aum AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'via'::text AS key,
            account_facets.f_via AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'invests_in'::text AS key,
            account_facets.f_invests_in AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'stage'::text AS key,
            account_facets.f_stage AS vals
           FROM account_facets
        UNION ALL
         SELECT account_facets.hr_id,
            account_facets.segment,
            'project'::text AS key,
            account_facets.f_project AS vals
           FROM account_facets
        )
 SELECT segment,
    key,
    (count(*) FILTER (WHERE (vals <> '{}'::text[])))::integer AS have,
    (count(*))::integer AS segment_total
   FROM unpivoted
  GROUP BY segment, key;;

