# Opportunity Radar — AI Market Signal Detection for Indian Retail Investors

> **ET GenAI Hackathon 2026 — Problem Statement #6: AI for the Indian Investor**

Opportunity Radar is an AI-powered signal-finder for India's 14 crore retail investors. It monitors NSE/BSE filings, insider trades, bulk deals, corporate announcements and financial news every 15 minutes — and surfaces only verified, actionable signals. Not summaries. Not noise. Signals.

---

## The Problem

India's retail investors are making high-stakes decisions based on WhatsApp forwards and Telegram tips — with no verification, no context, no accountability. Real market moves (insider trades, promoter buys, management exits) happen before the crowd hears about them.

## The Solution

Opportunity Radar monitors 5 live data sources simultaneously, applies a 5-step AI signal detection framework, and delivers verified signals directly to the investor's dashboard — with source citations, historical precedent, sector context and a specific trigger to watch for next.

---

## Architecture
```
Triggers (15min / 1hr / 4hr)
        ↓
5 Data Sources:
Google News RSS · ET Markets RSS · NSE Insider Trades · NSE Bulk Deals · Nifty 500 List
        ↓
Parse + Deduplicate
        ↓
Portfolio Filter (2-tier: Portfolio stocks vs Nifty 500 Universe)
        ↓
Keyword Filter (High + Medium signal keywords)
        ↓
GUID Check (Supabase deduplication)
        ↓
Perplexity API (fetch original article + research enrichment)
        ↓
GPT-4o (5-step signal detection framework)
        ↓
Quality Gates (auto-downgrade hallucinated signals)
        ↓
Supabase (signals table + processed_guids)
        ↓
React Frontend (live signal feed + Radar AI chat)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Workflow Automation | n8n Cloud |
| Research Enrichment | Perplexity AI (sonar model) |
| Signal Detection | OpenAI GPT-4o |
| Database | Supabase (PostgreSQL) |
| Frontend | React + Vite + Tailwind CSS |
| Deployment | Bolt.new |

---

## Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/MayurJunghare/Opportunity_Radar.git
cd Opportunity_Radar
```

### 2. Frontend Setup
```bash
cd frontend
npm install
```

Create a `.env` file in the `frontend/` folder:
```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Run the development server:
```bash
npm run dev
```

### 3. Supabase Setup

Run these SQL queries in your Supabase SQL Editor:
```sql
-- Signals table
create table signals (
  id text primary key default gen_random_uuid()::text,
  signal_tier text, ticker text, event_type text, headline text,
  what_happened text, why_it_matters text, historical_precedent text,
  sector_context text, watch_for_next text, source text,
  confidence text, confidence_reason text, monitoring_type text,
  original_link text, original_source text, original_pub_date text,
  perplexity_citations text, processed_at timestamptz default now(),
  guid text unique, created_at timestamptz default now()
);

-- Deduplication table
create table processed_guids (
  guid text primary key,
  processed_at timestamptz default now()
);

-- Portfolio table
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id text default 'default',
  ticker text not null,
  added_at timestamptz default now()
);

-- Enable RLS
alter table signals enable row level security;
alter table portfolios enable row level security;

create policy "Public read signals" on signals for select to anon using (true);
create policy "Public read portfolios" on portfolios for select to anon using (true);
create policy "Public insert portfolios" on portfolios for insert to anon with check (true);
create policy "Public delete portfolios" on portfolios for delete to anon using (true);
```

### 4. n8n Workflow Setup

1. Sign up at [n8n.io](https://n8n.io) (cloud or self-hosted)
2. Go to **Workflows → Import**
3. Upload `n8n/workflow.json`
4. Add the following credentials in n8n:
   - **Supabase** — Project URL + Service Role Key
   - **Perplexity API** — API Key from [perplexity.ai](https://perplexity.ai)
   - **OpenAI** — API Key from [platform.openai.com](https://platform.openai.com)
5. Update the Supabase URL in the `Fetch Portfolio from Supabase` node
6. Activate the workflow

### 5. API Keys Required

| Service | Where to get it |
|---|---|
| Supabase | Project Settings → API |
| Perplexity AI | perplexity.ai/settings/api |
| OpenAI | platform.openai.com/api-keys |

---

## Live Demo

🔗 [Open in Bolt](https://bolt.new/~/sb1-awhpn43p)

---

## Signal Detection — How It Works

Every item passes through a 5-step GPT-4o analysis:

1. **Routine or Unusual?** — Filters out AGMs, minor dividends, routine results
2. **Exact Delta** — Extracts specific numbers, names, percentages
3. **Historical Precedent** — Verifies via Perplexity, never invented
4. **Sector Context** — Isolated event or sector-wide?
5. **Watch Trigger** — One specific future event to monitor

**Output fields:** `signal_tier · ticker · headline · what_happened · why_it_matters · historical_precedent · sector_context · watch_for_next · source · confidence · confidence_reason`

---

## Two-Tier Monitoring

| Tier | Stocks | Signals Passed |
|---|---|---|
| Portfolio | Your added tickers | All signals |
| Universe | Nifty 500 | High + Medium only |

---

## Impact Model

At 1% adoption across India's 14 crore demat accounts:

- **93 lakh person-hours saved** every single day
- **₹310 Crore daily time value** recovered from manual market scanning
- Retail investors get the same information advantage as institutional players

---

## Submission

Built for **ET GenAI Hackathon 2026**
Problem Statement **#6 — AI for the Indian Investor**

---

## Author

**Mayur Junghare** — AI Generalist
