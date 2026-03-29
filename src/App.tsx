import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function getSignals() {
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('Error fetching signals:', error);
    return [];
  }
  return data || [];
}

// Types
interface Signal {
  id: string;
  signal_tier: 'high' | 'medium';
  ticker: string;
  event_type: string;
  monitoring_type: 'portfolio' | 'universe';
  original_source: string;
  original_link: string;
  original_pub_date: string;
  created_at: string;
  headline: string;
  what_happened: string;
  why_it_matters: string;
  historical_precedent: string;
  sector_context: string;
  watch_for_next: string;
  source: string;
  confidence: string;
  confidence_reason: string;
  perplexity_citations: string;
  guid: string;
}

interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 2) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getNextScanTime(): string {
  // Get current time in IST (UTC+5:30)
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);

  const day = ist.getUTCDay(); // 0=Sun, 1=Mon...6=Sat
  const hours = ist.getUTCHours();
  const mins = ist.getUTCMinutes();
  const totalMins = hours * 60 + mins;

  const isWeekend = day === 0 || day === 6;

  // Market hours: 9:15 AM – 3:30 PM IST (555 – 930 mins)
  const marketOpen = 9 * 60 + 15;   // 555
  const marketClose = 15 * 60 + 30; // 930

  // Post-market: 3:30 PM – 11:30 PM IST (930 – 1410 mins)
  const postMarketClose = 23 * 60 + 30; // 1410

  if (isWeekend) {
    // 4-hour intervals on weekends
    const nextHour = Math.ceil((totalMins + 1) / 240) * 240;
    const minsUntil = nextHour - totalMins;
    if (minsUntil >= 60) return `${Math.floor(minsUntil / 60)}h ${minsUntil % 60}m`;
    return `${minsUntil}m`;
  }

  if (totalMins >= marketOpen && totalMins < marketClose) {
    // Market hours — 15 min intervals
    const nextQuarter = Math.ceil((totalMins + 1) / 15) * 15;
    const minsUntil = nextQuarter - totalMins;
    return `${minsUntil}m`;
  }

  if (totalMins >= marketClose && totalMins < postMarketClose) {
    // Post-market — 1 hour intervals
    const nextHour = Math.ceil((totalMins + 1) / 60) * 60;
    const minsUntil = nextHour - totalMins;
    if (minsUntil >= 60) return `1h`;
    return `${minsUntil}m`;
  }

  // Outside all windows (pre-market or late night)
  if (totalMins < marketOpen) {
    const minsUntil = marketOpen - totalMins;
    if (minsUntil >= 60) return `${Math.floor(minsUntil / 60)}h ${minsUntil % 60}m`;
    return `${minsUntil}m`;
  }

  // After 11:30 PM — next scan at market open next day
  const minsUntilMidnight = 24 * 60 - totalMins;
  const minsUntilOpen = minsUntilMidnight + marketOpen;
  return `${Math.floor(minsUntilOpen / 60)}h ${minsUntilOpen % 60}m`;
}

const MAX_PORTFOLIO_SIZE = 30;
const DEFAULT_PORTFOLIO = ['HDFCBANK', 'INFY', 'TCS', 'ZOMATO'];

function App() {
  const [portfolio, setPortfolio] = useState<string[]>(DEFAULT_PORTFOLIO);
  const [portfolioLoaded, setPortfolioLoaded] = useState(false);
  const [newTicker, setNewTicker] = useState('');
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<'all' | 'high' | 'medium'>('all');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [showLimitError, setShowLimitError] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [nextScan, setNextScan] = useState<string>(getNextScanTime());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── LOAD PORTFOLIO FROM SUPABASE ON STARTUP ──
  useEffect(() => {
    const loadPortfolio = async () => {
      try {
        const { data, error } = await supabase
          .from('portfolios')
          .select('ticker')
          .eq('user_id', 'default')
          .order('added_at', { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
          const tickers = data.map((row: { ticker: string }) => row.ticker);
          setPortfolio(tickers);
        }
      } catch (err) {
        console.error('Failed to load portfolio from Supabase:', err);
      } finally {
        setPortfolioLoaded(true);
      }
    };

    loadPortfolio();
  }, []);

  // ── FETCH SIGNALS ──
  const fetchSignals = async () => {
    const data = await getSignals();
    setSignals(data);
    setLastUpdated(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── UPDATE NEXT SCAN COUNTDOWN every minute ──
  useEffect(() => {
    const interval = setInterval(() => {
      setNextScan(getNextScanTime());
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const filteredSignals = signals.filter(signal => {
    const tierMatch = tierFilter === 'all' || signal.signal_tier === tierFilter;
    const eventMatch = eventFilter === 'all' || signal.event_type?.toLowerCase().includes(eventFilter.toLowerCase());
    return tierMatch && eventMatch;
  });

  const portfolioSignals = filteredSignals.filter(signal =>
    portfolio.includes(signal.ticker)
  );
  const marketAlerts = filteredSignals.filter(signal =>
    !portfolio.includes(signal.ticker)
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // ── ADD TICKER ──
  const addTicker = async () => {
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker) return;
    if (portfolio.includes(ticker)) return;
    if (portfolio.length >= MAX_PORTFOLIO_SIZE) {
      setShowLimitError(true);
      setTimeout(() => setShowLimitError(false), 3000);
      return;
    }

    setPortfolio([...portfolio, ticker]);
    setNewTicker('');

    try {
      const { error } = await supabase
        .from('portfolios')
        .upsert(
          { user_id: 'default', ticker },
          { onConflict: 'user_id,ticker' }
        );
      if (error) throw error;
    } catch (err) {
      console.error('Failed to save ticker to Supabase:', err);
    }
  };

  // ── REMOVE TICKER ──
  const removeTicker = async (ticker: string) => {
    setPortfolio(portfolio.filter(t => t !== ticker));

    try {
      const { error } = await supabase
        .from('portfolios')
        .delete()
        .eq('user_id', 'default')
        .eq('ticker', ticker);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to remove ticker from Supabase:', err);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMessage = chatInput;
    setMessages([...messages, { role: 'user', content: userMessage }]);
    setChatInput('');
    setIsTyping(true);

    setTimeout(() => {
      setIsTyping(false);
      const lowerMsg = userMessage.toLowerCase();
      let response = '';

      const highSignals = signals.filter(s => s.signal_tier === 'high');
      const portfolioSigs = signals.filter(s => portfolio.includes(s.ticker));

      if (lowerMsg.includes('portfolio') || lowerMsg.includes('summarise') || lowerMsg.includes('summarize')) {
        if (portfolioSigs.length === 0) {
          response = `No signals detected for your portfolio stocks (${portfolio.join(', ')}) in the last 24 hours. Markets are being monitored every 15 minutes.`;
        } else {
          response = `${portfolioSigs.length} signal(s) for your portfolio: ${portfolioSigs.map(s => `${s.ticker} — ${s.headline}`).join(' | ')}`;
        }
      } else if (lowerMsg.includes('high') || lowerMsg.includes('urgent')) {
        if (highSignals.length === 0) {
          response = 'No HIGH tier signals detected in the current monitoring window. All portfolio stocks appear stable.';
        } else {
          response = `${highSignals.length} HIGH signal(s): ${highSignals.map(s => `${s.ticker}: ${s.headline}`).join(' | ')}`;
        }
      } else if (lowerMsg.includes('insider')) {
        const insiderSigs = signals.filter(s => s.event_type?.toLowerCase().includes('insider'));
        response = insiderSigs.length > 0
          ? `${insiderSigs.length} insider trade signal(s) detected: ${insiderSigs.map(s => `${s.ticker} — ${s.headline}`).join(' | ')}`
          : 'No insider trading signals detected in the current monitoring window.';
      } else if (lowerMsg.includes('bulk')) {
        const bulkSigs = signals.filter(s => s.event_type?.toLowerCase().includes('bulk'));
        response = bulkSigs.length > 0
          ? `${bulkSigs.length} bulk deal signal(s): ${bulkSigs.map(s => `${s.ticker} — ${s.headline}`).join(' | ')}`
          : 'No bulk deal signals in current window.';
      } else {
        response = signals.length > 0
          ? `Currently tracking ${signals.length} signal(s). ${highSignals.length} high priority, ${portfolioSigs.length} portfolio alerts. Last updated: ${lastUpdated}.`
          : 'Pipeline is active and monitoring. No signals detected yet — check back after market hours.';
      }

      setMessages(prev => [...prev, { role: 'ai', content: response }]);
    }, 1200);
  };

  const handleHintClick = (hint: string) => {
    setChatInput(hint);
  };

  const handleGoLive = () => {
    if (webhookUrl.trim()) {
      setIsLive(true);
    }
  };

  const highCount = signals.filter(s => s.signal_tier === 'high').length;
  const mediumCount = signals.filter(s => s.signal_tier === 'medium').length;
  const portfolioAlerts = signals.filter(s => portfolio.includes(s.ticker)).length;
  const universeAlerts = signals.filter(s => !portfolio.includes(s.ticker)).length;

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>

      {/* LOADING OVERLAY */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
          <div className="text-center">
            <div className="w-8 h-8 rounded-full mx-auto mb-4" style={{ border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }}></div>
            <p className="font-dm-mono text-sm" style={{ color: 'var(--t3)' }}>Loading signals...</p>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="h-28 flex items-center justify-between px-12 sticky top-0 z-50" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-8">
          <div className="w-14 h-14 rounded-full flex items-center justify-center relative" style={{ border: '1px solid var(--acc-bdr)', backgroundColor: 'var(--acc-dim)' }}>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-11 h-11 rounded-full" style={{ border: '1px solid var(--acc-bdr)', opacity: 0.4 }}></div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full" style={{ border: '1px solid var(--acc-bdr)', opacity: 0.6 }}></div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full" style={{ border: '1px solid var(--acc-bdr)', opacity: 0.8 }}></div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center" style={{ animation: 'radarSweep 2s linear infinite' }}>
              <div className="absolute w-0.5 h-5" style={{ background: 'linear-gradient(to top, var(--accent), transparent)', transformOrigin: 'bottom center', bottom: '50%', left: '50%', marginLeft: '-1px' }}></div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }}></div>
            </div>
          </div>
          <div className="font-syne text-[40px] font-extrabold" style={{ color: 'var(--accent)' }}>OpportunityRadar</div>
          <div className="font-dm-mono text-[18px]" style={{ color: 'var(--t3)' }}>Indian Market Intelligence</div>
        </div>
        <div className="flex items-center gap-10">
          <div className="flex items-center gap-4 px-6 py-2.5 rounded-full" style={{ backgroundColor: 'var(--acc-dim)', border: '1px solid var(--acc-bdr)' }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }}></div>
            <span className="font-dm-mono text-[11px]" style={{ color: 'var(--accent)' }}>MONITORING ET MARKETS · NSE · BSE · SEBI</span>
          </div>
          <div className="w-px h-7" style={{ backgroundColor: 'var(--border)' }}></div>
          <span className="font-dm-mono text-[11px]" style={{ color: 'var(--t3)' }}>
            Updated: {lastUpdated || '—'}
          </span>
          <button onClick={fetchSignals} className="px-3 py-1.5 rounded-md font-dm-mono text-[11px] transition-all" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--t2)', cursor: 'pointer' }}>↻</button>
        </div>
      </header>

      {/* PORTFOLIO BAR */}
      <div className="h-14 flex items-center gap-3 px-6 relative" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        {showLimitError && (
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-4 py-2 rounded-lg z-50 shadow-lg" style={{ backgroundColor: 'var(--high-bg)', border: '1px solid var(--high-bdr)', animation: 'fadeInUp 0.3s ease' }}>
            <span className="font-dm-mono text-[11px]" style={{ color: 'var(--high)' }}>Portfolio limit reached. Maximum {MAX_PORTFOLIO_SIZE} stocks allowed.</span>
          </div>
        )}
        <span className="font-dm-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--t3)' }}>PORTFOLIO</span>

        {!portfolioLoaded ? (
          <span className="font-dm-mono text-[10px]" style={{ color: 'var(--t3)' }}>Loading portfolio...</span>
        ) : (
          <div className="flex gap-1.5 flex-wrap">
            {portfolio.map(ticker => (
              <div key={ticker} className="flex items-center gap-2 px-3 py-1 rounded font-dm-mono text-xs font-medium" style={{ backgroundColor: 'var(--acc-dim)', border: '1px solid var(--acc-bdr)', color: 'var(--accent)' }}>
                {ticker}
                <button onClick={() => removeTicker(ticker)} className="transition-colors" style={{ color: 'var(--t3)' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--high)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}>×</button>
              </div>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2.5">
          <input
            type="text"
            value={newTicker}
            onChange={e => setNewTicker(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && addTicker()}
            placeholder="Add ticker..."
            disabled={portfolio.length >= MAX_PORTFOLIO_SIZE}
            className="w-40 px-3.5 py-1.5 rounded-md font-dm-mono text-xs outline-none transition-all"
            style={{ backgroundColor: portfolio.length >= MAX_PORTFOLIO_SIZE ? 'var(--surface)' : 'var(--card)', border: '1px solid var(--border)', color: portfolio.length >= MAX_PORTFOLIO_SIZE ? 'var(--t3)' : 'var(--t1)', cursor: portfolio.length >= MAX_PORTFOLIO_SIZE ? 'not-allowed' : 'text' }}
            onFocus={e => e.target.style.borderColor = portfolio.length >= MAX_PORTFOLIO_SIZE ? 'var(--border)' : 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
          <button onClick={addTicker} disabled={portfolio.length >= MAX_PORTFOLIO_SIZE} className="px-3.5 py-1.5 rounded-md font-dm-mono text-[11px] transition-all" style={{ backgroundColor: portfolio.length >= MAX_PORTFOLIO_SIZE ? 'var(--surface)' : 'var(--acc-dim)', border: '1px solid var(--acc-bdr)', color: portfolio.length >= MAX_PORTFOLIO_SIZE ? 'var(--t3)' : 'var(--accent)', cursor: portfolio.length >= MAX_PORTFOLIO_SIZE ? 'not-allowed' : 'pointer', opacity: portfolio.length >= MAX_PORTFOLIO_SIZE ? 0.5 : 1 }}>+ Add</button>
          <span className="font-dm-mono text-[10px]" style={{ color: portfolio.length >= MAX_PORTFOLIO_SIZE ? 'var(--high)' : 'var(--t3)' }}>{portfolio.length}/{MAX_PORTFOLIO_SIZE} stocks</span>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex flex-1 overflow-hidden">

        {/* SIDEBAR */}
        <aside className="w-[220px] overflow-y-auto py-5 flex-shrink-0" style={{ backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)' }}>
          <div className="mb-4">
            <div className="px-4 mb-2 font-dm-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--t3)' }}>SIGNAL TIER</div>
            {(['all', 'high', 'medium'] as const).map(tier => (
              <button key={tier} onClick={() => setTierFilter(tier)} className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer transition-all" style={{ color: tierFilter === tier ? 'var(--t1)' : 'var(--t2)', backgroundColor: tierFilter === tier ? 'rgba(0,212,170,0.06)' : 'transparent', borderLeft: tierFilter === tier ? '2px solid var(--accent)' : '2px solid transparent' }}>
                <span className="font-dm-sans text-[13px] capitalize">{tier === 'all' ? 'All signals' : tier}</span>
                <span className="px-2 py-0.5 rounded-full font-dm-mono text-[10px]" style={{ backgroundColor: tier === 'high' ? 'var(--high-bg)' : tier === 'medium' ? 'var(--med-bg)' : 'rgba(255,255,255,0.06)', color: tier === 'high' ? 'var(--high)' : tier === 'medium' ? 'var(--med)' : 'var(--t2)', border: tier === 'high' ? '1px solid var(--high-bdr)' : tier === 'medium' ? '1px solid var(--med-bdr)' : 'none' }}>
                  {tier === 'all' ? signals.length : tier === 'high' ? highCount : mediumCount}
                </span>
              </button>
            ))}
          </div>

          <div className="mx-4 my-4" style={{ height: '1px', backgroundColor: 'var(--border)' }}></div>

          <div className="mb-4">
            <div className="px-4 mb-2 font-dm-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--t3)' }}>EVENT TYPE</div>
            {[
              { label: 'All', value: 'all', icon: '◈' },
              { label: 'Filings', value: 'filing', icon: '◎' },
              { label: 'Insider', value: 'insider_trade', icon: '◉' },
              { label: 'Bulk Deals', value: 'bulk_deal', icon: '◆' },
              { label: 'Results', value: 'results', icon: '▣' },
              { label: 'News', value: 'news', icon: '◐' },
            ].map(({ label, value, icon }) => {
              const isActive = eventFilter === value;
              return (
                <button key={label} onClick={() => setEventFilter(value)} className="w-full flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-all" style={{ color: isActive ? 'var(--t1)' : 'var(--t2)', backgroundColor: isActive ? 'rgba(0,212,170,0.06)' : 'transparent', borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent' }}>
                  <span className="font-dm-mono" style={{ color: 'var(--t3)' }}>{icon}</span>
                  <span className="font-dm-sans text-[13px]">{label}</span>
                </button>
              );
            })}
          </div>

          <div className="mx-4 my-4" style={{ height: '1px', backgroundColor: 'var(--border)' }}></div>

          {/* TODAY'S ACTIVITY */}
          <div>
            <div className="px-4 mb-2 font-dm-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--t3)' }}>TODAY'S ACTIVITY</div>
            <div className="flex justify-between px-4 py-2">
              <span className="font-dm-sans text-xs" style={{ color: 'var(--t2)' }}>Signals detected</span>
              <span className="font-dm-mono text-[13px] font-medium" style={{ color: 'var(--t1)' }}>{signals.length}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="font-dm-sans text-xs" style={{ color: 'var(--t2)' }}>Portfolio alerts</span>
              <span className="font-dm-mono text-[13px] font-medium" style={{ color: 'var(--accent)' }}>{portfolioAlerts}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="font-dm-sans text-xs" style={{ color: 'var(--t2)' }}>Universe alerts</span>
              <span className="font-dm-mono text-[13px] font-medium" style={{ color: 'var(--med)' }}>{universeAlerts}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="font-dm-sans text-xs" style={{ color: 'var(--t2)' }}>Next scan</span>
              <span className="font-dm-mono text-[13px] font-medium" style={{ color: 'var(--t1)' }}>{nextScan}</span>
            </div>
          </div>
        </aside>

        {/* SIGNAL FEED */}
        <main className="flex-1 overflow-y-auto p-5 relative">
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #1e2d3d 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-syne text-base font-semibold" style={{ color: 'var(--t1)' }}>Signal Feed</h2>
              <div className="flex items-center gap-3">
                <span className="font-dm-mono text-[11px] mr-3" style={{ color: 'var(--t3)' }}>{filteredSignals.length} signals</span>
                <button onClick={fetchSignals} className="px-3.5 py-1.5 rounded-md font-dm-mono text-[11px] transition-all" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--t2)' }}>↻ Refresh</button>
              </div>
            </div>



            {/* EMPTY STATE */}
            {!loading && signals.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="font-dm-mono text-5xl mb-4" style={{ color: 'var(--t3)' }}>◈</div>
                <p className="font-dm-sans text-sm mb-2" style={{ color: 'var(--t3)' }}>No signals detected yet</p>
                <p className="font-dm-mono text-xs" style={{ color: 'var(--t3)' }}>Pipeline monitors every 15 min during market hours</p>
              </div>
            )}

            {/* PORTFOLIO SIGNALS */}
            {portfolioSignals.length > 0 && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }}></div>
                  <h3 className="font-dm-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>PORTFOLIO SIGNALS</h3>
                  <span className="font-dm-mono text-[10px]" style={{ color: 'var(--t3)' }}>{portfolioSignals.length} {portfolioSignals.length === 1 ? 'signal' : 'signals'}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }}></div>
                  <span className="px-2 py-0.5 rounded-full font-dm-mono text-[10px]" style={{ backgroundColor: 'rgba(0,212,170,0.1)', border: '1px solid rgba(0,212,170,0.25)', color: 'var(--accent)' }}>{portfolioSignals.length}</span>
                </div>
                {portfolioSignals.map((signal, idx) => (
                  <SignalCard key={signal.id} signal={signal} idx={idx} expanded={expandedSignal === signal.id} onToggle={() => setExpandedSignal(expandedSignal === signal.id ? null : signal.id)} />
                ))}
              </>
            )}

            {/* DIVIDER */}
            {portfolioSignals.length > 0 && marketAlerts.length > 0 && (
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }}></div>
                <span className="font-dm-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--t3)' }}>● BROADER MARKET</span>
                <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }}></div>
              </div>
            )}

            {/* MARKET ALERTS */}
            {marketAlerts.length > 0 && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--high)', animation: 'pulse 2s ease-in-out infinite' }}></div>
                  <h3 className="font-dm-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--high)' }}>MARKET ALERTS</h3>
                  <span className="font-dm-mono text-[10px]" style={{ color: 'var(--t3)' }}>Broader market signals</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }}></div>
                  <span className="px-2 py-0.5 rounded-full font-dm-mono text-[10px]" style={{ backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--high)' }}>{marketAlerts.length}</span>
                </div>
                {marketAlerts.map((signal, idx) => (
                  <SignalCard key={signal.id} signal={signal} idx={idx} expanded={expandedSignal === signal.id} onToggle={() => setExpandedSignal(expandedSignal === signal.id ? null : signal.id)} />
                ))}
              </>
            )}
          </div>
        </main>

        {/* CHAT PANEL */}
        <div className="w-[380px] flex flex-col flex-shrink-0" style={{ backgroundColor: 'var(--surface)', borderLeft: '1px solid var(--border)' }}>
          <div className="h-10 flex items-center justify-between px-6 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="font-dm-mono text-[13px] font-medium" style={{ color: 'var(--accent)' }}>◈ Radar AI</span>
            <span className="font-dm-mono text-[10px]" style={{ color: 'var(--t3)' }}>Portfolio-aware · Source-cited</span>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-3 flex flex-col gap-2">
            {messages.length === 0 && (
              <div className="text-center mt-4">
                <p className="font-dm-sans text-[13px]" style={{ color: 'var(--t3)' }}>Ask Radar about market signals, portfolio insights, or specific tickers</p>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className="px-3.5 py-2" style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: msg.role === 'user' ? 'var(--acc-dim)' : 'var(--card)', border: msg.role === 'user' ? '1px solid var(--acc-bdr)' : '1px solid var(--border)', borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px' }}>
                {msg.role === 'ai' && <div className="font-dm-mono text-[9px] mb-1" style={{ color: 'var(--accent)' }}>Radar AI</div>}
                <p className="font-dm-sans text-[13px] leading-relaxed" style={{ color: msg.role === 'user' ? 'var(--t1)' : 'var(--t2)' }}>{msg.content}</p>
              </div>
            ))}
            {isTyping && (
              <div className="px-3.5 py-2" style={{ alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px 12px 12px 2px' }}>
                <div className="font-dm-mono text-[9px] mb-1" style={{ color: 'var(--accent)' }}>Radar AI</div>
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--t3)', animation: `bounce 0.6s ease-in-out ${i * 0.2}s infinite` }}></div>
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="flex-shrink-0 px-6 py-1.5 flex flex-wrap gap-2">
            {['→ Summarise my portfolio signals', '→ Show high priority signals', '→ Insider trades today', '→ Large bulk deals this week'].map(hint => (
              <button key={hint} onClick={() => handleHintClick(hint.replace('→ ', ''))} className="px-3.5 py-1 rounded-full font-dm-sans text-xs transition-all" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--t2)' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--border-hi)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>{hint}</button>
            ))}
          </div>
          <div className="flex-shrink-0 px-6 py-2.5 flex gap-2.5" style={{ borderTop: '1px solid var(--border)' }}>
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSendMessage()} placeholder="Ask Radar about your portfolio..." className="flex-1 px-4 py-2.5 rounded-lg font-dm-sans text-[13px] outline-none transition-all" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--t1)' }} onFocus={e => e.target.style.borderColor = 'var(--accent)'} onBlur={e => e.target.style.borderColor = 'var(--border)'} />
            <button onClick={handleSendMessage} className="px-5 py-2.5 rounded-lg font-dm-mono text-xs font-semibold transition-opacity" style={{ backgroundColor: 'var(--accent)', color: '#070b0f' }} onMouseEnter={e => e.currentTarget.style.opacity = '0.85'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>Ask →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Signal Card Component
function SignalCard({ signal, idx, expanded, onToggle }: { signal: Signal; idx: number; expanded: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle} className="mb-3 rounded-[10px] cursor-pointer transition-all" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderLeft: `3px solid ${signal.signal_tier === 'high' ? 'var(--high)' : 'var(--med)'}`, animation: `fadeInUp 0.3s ease ${idx * 0.05}s both` }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--card-hover)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--card)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}>
      <div className="px-5 py-4">
        {/* CARD HEADER */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 rounded font-dm-mono text-[9px] font-semibold uppercase tracking-wide" style={{ backgroundColor: signal.signal_tier === 'high' ? 'var(--high-bg)' : 'var(--med-bg)', border: `1px solid ${signal.signal_tier === 'high' ? 'var(--high-bdr)' : 'var(--med-bdr)'}`, color: signal.signal_tier === 'high' ? 'var(--high)' : 'var(--med)' }}>
              {signal.signal_tier === 'high' ? '● HIGH' : '◐ MED'}
            </span>
            <span className="font-dm-mono text-sm font-semibold tracking-wide" style={{ color: 'var(--accent)' }}>{signal.ticker}</span>
            <span className="px-2 py-0.5 rounded font-dm-mono text-[10px]" style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--t2)' }}>{signal.event_type?.toUpperCase()}</span>
            <span className="px-1.5 py-0.5 rounded font-dm-mono text-[9px]" style={{ border: '1px solid var(--border)', color: 'var(--t3)' }}>
              {signal.original_source && !signal.original_source.startsWith('http')
                ? signal.original_source
                : signal.source?.includes('ET Markets') ? 'ET Markets'
                : signal.source?.includes('Google') ? 'Google News'
                : signal.source?.includes('NSE') ? 'NSE'
                : 'NSE'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-dm-mono text-[11px]" style={{ color: 'var(--t3)' }}>{timeAgo(signal.created_at)}</span>
            <span className="font-dm-mono text-lg transition-transform" style={{ color: 'var(--t3)', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
          </div>
        </div>

        {/* HEADLINE */}
        <div className="mt-2.5">
          <h3 className="font-dm-sans text-[15px] font-medium leading-relaxed" style={{ color: 'var(--t1)' }}>{signal.headline}</h3>
        </div>

        {/* EXPANDED CONTENT */}
        {expanded && (
          <div className="mt-3.5 pt-3.5" style={{ borderTop: '1px solid var(--border)' }}>

            {signal.what_happened && (
              <div className="mb-3.5">
                <div className="font-dm-mono text-[10px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--t3)' }}>WHAT HAPPENED</div>
                <p className="font-dm-sans text-[13px] leading-relaxed" style={{ color: 'var(--t1)' }}>{signal.what_happened}</p>
              </div>
            )}

            {signal.why_it_matters && (
              <div className="mb-3.5">
                <div className="font-dm-mono text-[10px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--t3)' }}>WHY IT MATTERS</div>
                <p className="font-dm-sans text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>{signal.why_it_matters}</p>
              </div>
            )}

            {signal.historical_precedent && (
              <div className="mb-3.5">
                <div className="font-dm-mono text-[10px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--t3)' }}>HISTORICAL PRECEDENT</div>
                <p className="font-dm-sans text-[13px] italic leading-relaxed" style={{ color: 'var(--t2)' }}>{signal.historical_precedent}</p>
              </div>
            )}

            {signal.sector_context && (
              <div className="mb-3.5">
                <div className="font-dm-mono text-[10px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--t3)' }}>SECTOR CONTEXT</div>
                <p className="font-dm-sans text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>{signal.sector_context}</p>
              </div>
            )}

            {signal.watch_for_next && (
              <div className="mb-3.5 flex gap-3 px-4 py-3 rounded-md" style={{ backgroundColor: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderLeft: '3px solid var(--med)' }}>
                <span className="text-[15px] flex-shrink-0 mt-0.5" style={{ color: 'var(--med)' }}>◎</span>
                <div>
                  <div className="font-dm-mono text-[10px] mb-1" style={{ color: 'var(--med)' }}>WATCH FOR NEXT</div>
                  <p className="font-dm-sans text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>{signal.watch_for_next}</p>
                </div>
              </div>
            )}

            {signal.confidence_reason && (
              <div className="mb-3.5">
                <div className="font-dm-mono text-[10px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--t3)' }}>CONFIDENCE REASON</div>
                <p className="font-dm-sans text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>{signal.confidence_reason}</p>
              </div>
            )}

            {/* CITATIONS */}
            {signal.perplexity_citations && (
              <div className="mb-3.5">
                <div className="font-dm-mono text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: 'var(--t3)' }}>SOURCES</div>
                <div className="flex flex-wrap gap-1.5">
                  {signal.perplexity_citations.split(', ').filter(u => u.startsWith('http')).map((url, i) => {
                    let hostname = url;
                    try { hostname = new URL(url).hostname.replace('www.', ''); } catch {}
                    return (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="font-dm-mono text-[10px] px-2 py-0.5 rounded transition-all"
                        style={{ backgroundColor: 'var(--acc-dim)', border: '1px solid var(--acc-bdr)', color: 'var(--accent)', textDecoration: 'none' }}>
                        [{i + 1}] {hostname}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* FOOTER ROW */}
            <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                {signal.original_link && (
                  <a href={signal.original_link} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="font-dm-mono text-[10px] px-2.5 py-1 rounded-md transition-all"
                    style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--t2)', textDecoration: 'none' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--t1)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hi)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--t2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
                    Read original →
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: signal.confidence === 'high' ? 'var(--accent)' : 'var(--med)' }}></div>
                <span className="font-dm-mono text-[10px]" style={{ color: 'var(--t3)' }}>
                  Confidence: {signal.confidence}
                </span>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

export default App;