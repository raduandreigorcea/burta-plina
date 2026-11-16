"use client";

import { useEffect, useId, useRef, useState } from "react";
import { chainOfVenue, resolveChain, suggestChains } from "@/lib/chains";
import { ChainBadge, PlatformBadge } from "./brand";
import type { PlatformOutcome, PlatformSearch } from "@/lib/service";
import { AlertIcon, CheckIcon, CloseIcon, PlusIcon, ExternalIcon, PinIcon, SearchIcon, SpinnerIcon, TagIcon } from "./icons";
import { PLATFORM_NAMES, type Basket, type BudgetMode, type BudgetScope, type PlatformId, type SidesRule, type Venue } from "@/lib/types";

interface Loc {
  lat: number;
  lon: number;
  label: string;
}

const ALL_PLATFORMS = Object.keys(PLATFORM_NAMES) as PlatformId[];
const lei = (bani: number) => (bani / 100).toFixed(2).replace(".", ",") + " lei";
const grams = (g: number) => (g >= 1000 ? (g / 1000).toFixed(2).replace(".", ",") + " kg" : Math.round(g) + " g");
const km = (m?: number) => (m == null ? "" : m < 1000 ? `, la ${m} m` : `, la ${(m / 1000).toFixed(1).replace(".", ",")} km`);
const rate = (leiPer100g: number) => leiPer100g.toFixed(2).replace(".", ",") + " lei";

/** A number that runs up to its value the way a scale readout settles. */
function Settle({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    const from = current.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now: number) {
      const t = still ? 1 : Math.min(1, Math.max(0, (now - t0) / 700));
      current.current = from + (value - from) * (1 - Math.pow(1 - t, 3));
      setShown(current.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

/** The fast-food field: free text, with the known chains offered while typing ("mec" -> McDonald's). */
function ChainInput({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const all = suggestChains(value);
  // Nothing to offer once the text is already the chain's name.
  const hits = all.length === 1 && all[0].name === value.trim() ? [] : all;
  const shown = open && hits.length > 0;
  const at = Math.min(active, hits.length - 1);
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };
  return (
    <div className="field combo">
      <label htmlFor={id}>Fast-food</label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown ? `${id}-${at}` : undefined}
        autoComplete="off"
        value={value}
        placeholder="ex. mec, KFC"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!shown) return setOpen(true);
            setActive((at + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Enter") {
            // With the list open, Enter takes the highlighted chain and searches for it.
            const name = shown && value.trim() ? hits[at].name : resolveChain(value);
            pick(name);
            onSubmit(name);
          }
        }}
      />
      {shown && (
        <ul className="comboList" id={`${id}-list`} role="listbox">
          {hits.map((c, i) => (
            <li
              key={c.name}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === at}
              // mousedown, not click: the input must not lose focus first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c.name);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <ChainBadge chain={c} size={24} />
              <span>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function load<T>(key: string, dflt: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : dflt;
  } catch {
    return dflt;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: settings just won't persist
  }
}

export default function Home() {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [address, setAddress] = useState("");
  const [geoHits, setGeoHits] = useState<Loc[]>([]);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState("");

  const [query, setQuery] = useState("");
  const [budgetLei, setBudgetLei] = useState("50");
  const [scope, setScope] = useState<BudgetScope>("total");
  const [mode, setMode] = useState<BudgetMode>("hard");
  const [tolerancePct, setTolerancePct] = useState("10");
  const [maxPerItem, setMaxPerItem] = useState("3");
  const [includeDrinks, setIncludeDrinks] = useState(false);
  const [wantFries, setWantFries] = useState(false);
  const [includeSauces, setIncludeSauces] = useState(false);
  const [includeGuessed, setIncludeGuessed] = useState(false);
  const [wantSalad, setWantSalad] = useState(false);
  const [wantDessert, setWantDessert] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searches, setSearches] = useState<PlatformSearch[]>([]);
  const [chosen, setChosen] = useState<Partial<Record<PlatformId, Venue>>>({});
  const [results, setResults] = useState<PlatformOutcome[] | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [usedScope, setUsedScope] = useState<BudgetScope>("total");

  useEffect(() => {
    // Restore saved settings after hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoc(load<Loc | null>("food.loc", null));
    const s = load<Record<string, string | boolean>>("food.settings", {});
    if (typeof s.query === "string") setQuery(s.query);
    if (typeof s.budgetLei === "string") setBudgetLei(s.budgetLei);
    if (s.scope === "food" || s.scope === "total") setScope(s.scope);
    if (s.mode === "flex" || s.mode === "hard") setMode(s.mode);
    if (typeof s.tolerancePct === "string") setTolerancePct(s.tolerancePct);
    if (typeof s.maxPerItem === "string") setMaxPerItem(s.maxPerItem);
    if (typeof s.includeDrinks === "boolean") setIncludeDrinks(s.includeDrinks);
    if (typeof s.wantFries === "boolean") setWantFries(s.wantFries);
    if (typeof s.includeSauces === "boolean") setIncludeSauces(s.includeSauces);
    if (typeof s.includeGuessed === "boolean") setIncludeGuessed(s.includeGuessed);
    if (typeof s.wantSalad === "boolean") setWantSalad(s.wantSalad);
    if (typeof s.wantDessert === "boolean") setWantDessert(s.wantDessert);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const pickLoc = (l: Loc) => {
    setLoc(l);
    save("food.loc", l);
    setGeoHits([]);
    setGeoError("");
  };

  async function geocode() {
    setGeoBusy(true);
    setGeoError("");
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Eroare la căutarea adresei.");
      if (data.results.length === 0) setGeoError("Nu am găsit adresa. Încearcă și cu orașul.");
      else if (data.results.length === 1) pickLoc(data.results[0]);
      else setGeoHits(data.results);
    } catch (e) {
      setGeoError((e as Error).message);
    } finally {
      setGeoBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setGeoError("Browserul nu oferă locația.");
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const { latitude: lat, longitude: lon } = p.coords;
        // Show the street address; fall back to coordinates if the lookup fails.
        let label = `Locația mea (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
        try {
          const res = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
          const data = await res.json();
          if (res.ok && data.label) label = `${data.label} (locația mea)`;
        } catch {
          // keep the coordinates label
        }
        pickLoc({ lat, lon, label });
        setGeoBusy(false);
      },
      () => {
        setGeoError("Nu am primit acces la locație.");
        setGeoBusy(false);
      },
    );
  }

  const options = (excludeNames: string[]) => ({
    budget: Math.round(parseFloat(budgetLei.replace(",", ".")) * 100),
    scope,
    mode,
    tolerancePct: Number(tolerancePct),
    maxPerItem: Number(maxPerItem),
    includeDrinks,
    wantFries,
    includeSauces,
    includeGuessed,
    // Fries and other fried sides only when asked for: then at most one per main dish.
    sides: (wantFries ? "balanced" : "none") as SidesRule,
    wantSalad,
    wantDessert,
    excludeNames,
  });

  async function runOptimize(venues: Venue[], excludeNames: string[]) {
    if (!loc) return;
    const res = await fetch("/api/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venues, lat: loc.lat, lon: loc.lon, options: options(excludeNames) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Eroare la calcul.");
    setResults(data.results);
    // The cards describe the calculation that was run, not the form as it is now.
    if (data.options?.scope === "food" || data.options?.scope === "total") setUsedScope(data.options.scope);
  }

  async function go(typed: string = query) {
    if (!loc) return setError("Alege mai întâi locația de livrare.");
    if (!typed.trim()) return setError("Scrie numele fast-food-ului.");
    // "mec" searches for McDonald's; the field shows what was searched.
    const query = resolveChain(typed);
    setQuery(query);
    setBusy(true);
    setError("");
    setResults(null);
    save("food.settings", { query, budgetLei, scope, mode, tolerancePct, maxPerItem, includeDrinks, includeSauces, includeGuessed, wantSalad, wantDessert, wantFries });
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&lat=${loc.lat}&lon=${loc.lon}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Eroare la căutare.");
      const found: PlatformSearch[] = data.platforms;
      setSearches(found);
      const pick: Partial<Record<PlatformId, Venue>> = {};
      for (const p of found) if (p.venues[0]) pick[p.platform] = p.venues[0];
      setChosen(pick);
      // Exclusions belong to one restaurant; a new search starts clean.
      const q = query.trim().toLowerCase();
      const keep = q === searchedQuery ? excluded : [];
      setExcluded(keep);
      setSearchedQuery(q);
      const venues = Object.values(pick) as Venue[];
      if (venues.length === 0) {
        setResults([]);
        return;
      }
      await runOptimize(venues, keep);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rerun(venues: Venue[], excludeNames: string[]) {
    if (venues.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await runOptimize(venues, excludeNames);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function changeVenue(platform: PlatformId, id: string) {
    const v = searches.find((s) => s.platform === platform)?.venues.find((x) => x.id === id);
    if (!v) return;
    const next = { ...chosen, [platform]: v };
    setChosen(next);
    void rerun(Object.values(next) as Venue[], excluded);
  }

  function setExclusions(next: string[]) {
    setExcluded(next);
    void rerun(Object.values(chosen) as Venue[], next);
  }
  const excludeItem = (name: string) => {
    if (!excluded.includes(name)) setExclusions([...excluded, name]);
  };
  const restoreItem = (name: string) => setExclusions(excluded.filter((n) => n !== name));

  const winner = results?.find((r) => r.result?.best);
  const runnerUp = results?.find((r) => r !== winner && r.result?.best);
  let verdict = "";
  if (winner?.result?.best && runnerUp?.result?.best) {
    const a = winner.result.best;
    const b = runnerUp.result.best;
    const w = PLATFORM_NAMES[winner.platform];
    const o = PLATFORM_NAMES[runnerUp.platform];
    if (a.grams > b.grams) verdict = `${w} îți dă cu ${grams(a.grams - b.grams)} mai mult decât ${o}.`;
    else if (a.cost.counted < b.cost.counted)
      verdict = `Aceeași cantitate ca pe ${o}, dar cu ${lei(b.cost.counted - a.cost.counted)} mai ieftin pe ${w}.`;
    else verdict = `${w} și ${o} ies la fel.`;
  }
  const searched = searches.map((s) => s.platform);
  const notImplemented = ALL_PLATFORMS.filter((p) => !searched.includes(p));

  return (
    <main>
      <h1>Cât mai multă mâncare</h1>
      <p className="sub">Alegi fast-food-ul și bugetul; îți spun de pe ce aplicație și ce să comanzi ca să iasă cele mai multe grame.</p>

      <div className="bench">
      <div className="ticket">
      <section className="ticketPart">
        <label className="field">
          <span>Adresa de livrare</span>
          <div className="inline">
            <input
              type="text"
              value={address}
              placeholder="ex. Str. Lipscani 10, București"
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && address.trim().length >= 3 && geocode()}
            />
            <button onClick={geocode} disabled={geoBusy || address.trim().length < 3}>
              <SearchIcon /> Caută
            </button>
            <button className="iconBtn" onClick={useMyLocation} disabled={geoBusy} title="Folosește locația mea" aria-label="Folosește locația mea">
              {geoBusy ? <SpinnerIcon size={18} /> : <PinIcon size={18} />}
            </button>
          </div>
        </label>
        {geoHits.length > 0 && (
          <div className="hits">
            {geoHits.map((h) => (
              <button key={`${h.lat},${h.lon}`} onClick={() => pickLoc(h)}>
                {h.label}
              </button>
            ))}
          </div>
        )}
        {geoError && <div className="error">{geoError}</div>}
        <div className="muted withIcon">
          <PinIcon size={14} />
          <span>{loc ? `Livrare la: ${loc.label}` : "Nicio locație aleasă încă."}</span>
        </div>
      </section>

      <section className="ticketPart">
        <div className="row">
          <ChainInput value={query} onChange={setQuery} onSubmit={(name) => !busy && go(name)} />
          <label className="field budget">
            <span>Buget (lei)</span>
            <input type="number" min={1} step={1} value={budgetLei} onChange={(e) => setBudgetLei(e.target.value)} />
          </label>
        </div>

        <div className="row">
          <div className="field">
            <span className="muted">Bugetul acoperă</span>
            <div className="seg">
              <button aria-pressed={scope === "total"} onClick={() => setScope("total")}>Total cu taxe</button>
              <button aria-pressed={scope === "food"} onClick={() => setScope("food")}>Doar mâncarea</button>
            </div>
          </div>
          <div className="field">
            <span className="muted">Limită</span>
            <div className="seg">
              <button aria-pressed={mode === "hard"} onClick={() => setMode("hard")}>Fixă</button>
              <button aria-pressed={mode === "flex"} onClick={() => setMode("flex")}>Flexibil</button>
            </div>
          </div>
        </div>

        <div className="row">
          <label className="field">
            <span>Maxim bucăți din același produs</span>
            <input type="number" min={1} max={20} value={maxPerItem} onChange={(e) => setMaxPerItem(e.target.value)} />
          </label>
          {mode === "flex" && (
            <label className="field">
              <span>Cât pot depăși (%)</span>
              <input type="number" min={0} max={50} value={tolerancePct} onChange={(e) => setTolerancePct(e.target.value)} />
            </label>
          )}
        </div>

        <div className="field">
          <span className="muted">Coșul trebuie să conțină</span>
          <div className="toggles">
            <button aria-pressed={wantFries} onClick={() => setWantFries(!wantFries)}>
              {wantFries ? <CheckIcon /> : <PlusIcon />} Cartofi
            </button>
            <button aria-pressed={includeDrinks} onClick={() => setIncludeDrinks(!includeDrinks)}>
              {includeDrinks ? <CheckIcon /> : <PlusIcon />} Băutură
            </button>
            <button aria-pressed={includeSauces} onClick={() => setIncludeSauces(!includeSauces)}>
              {includeSauces ? <CheckIcon /> : <PlusIcon />} Sos
            </button>
            <button aria-pressed={wantSalad} onClick={() => setWantSalad(!wantSalad)}>
              {wantSalad ? <CheckIcon /> : <PlusIcon />} Salată
            </button>
            <button aria-pressed={wantDessert} onClick={() => setWantDessert(!wantDessert)}>
              {wantDessert ? <CheckIcon /> : <PlusIcon />} Desert
            </button>
          </div>
          <div className="muted">
            Câte una din fiecare; cartofi cel puțin o porție, cel mult una la fiecare fel principal. Salata și desertul se numără la grame, băutura și sosul nu. Dacă un meniu (combo) iese mai bine decât produsele luate separat, îl primești pe acela.
          </div>
        </div>

        <div className="field">
          <span className="muted">Calcul</span>
          <div className="toggles">
            <button aria-pressed={includeGuessed} onClick={() => setIncludeGuessed(!includeGuessed)}>
              {includeGuessed ? <CheckIcon /> : <PlusIcon />} Gramaje nesigure
            </button>
          </div>
          <div className="muted">
            Ia în calcul și produsele cu gramajul ghicit dintr-o descriere cu mai multe cifre; poate fi greșit (marcate cu ?).
          </div>
        </div>

        <button className="primary" onClick={() => go()} disabled={busy}>
          {busy ? <><SpinnerIcon /> Caut…</> : "Găsește cea mai bună comandă"}
        </button>
        {error && <div className="error">{error}</div>}
      </section>
      </div>

      <div className="results" aria-live="polite">
      {!results && (
        <p className="blank">
          {busy ? "Cântăresc meniurile de pe fiecare aplicație…" : "Aici apare comanda cu cele mai multe grame, pentru fiecare aplicație de livrare."}
        </p>
      )}

      {results && results.length === 0 && <div className="sticker">Nu am găsit „{searchedQuery}” cu livrare la adresa ta pe nicio platformă. Verifică numele sau încearcă alt fast-food.</div>}

      {results && excluded.length > 0 && (
        <div className="chips">
          <span className="muted">Fără:</span>
          {excluded.map((n) => (
            <button key={n} className="chip" onClick={() => restoreItem(n)} disabled={busy} title="Pune produsul înapoi în calcul">
              {n} <CloseIcon size={12} />
            </button>
          ))}
          {excluded.length > 1 && (
            <button className="chip ghost" onClick={() => setExclusions([])} disabled={busy}>
              Șterge tot
            </button>
          )}
        </div>
      )}

      {verdict && <p className="verdict">{verdict}</p>}
      {verdict && (winner?.platform === "glovo" || winner?.platform === "bolt") && usedScope === "total" && (
        <p className="muted offGrid">
          {winner.platform === "glovo"
            ? "Atenție: la Glovo taxa de livrare e cea afișată pe oraș; la adresa ta poate fi cu 1–2 lei mai mare."
            : "Atenție: la Bolt Food taxa de servicii e estimată din două comenzi reale (între 40 și 120 lei) și garanția pentru sticle nu e inclusă."}
        </p>
      )}

      {results?.map((r) => (
        <ResultCard
          key={r.platform}
          r={r}
          isWinner={r === winner}
          scope={usedScope}
          venues={searches.find((s) => s.platform === r.platform)?.venues ?? []}
          onVenue={(id) => changeVenue(r.platform, id)}
          busy={busy}
          onExclude={excludeItem}
        />
      ))}

      {results &&
        searches
          .filter((s) => !results.some((r) => r.platform === s.platform))
          .map((s) => (
            <div className="sticker" key={s.platform}>
              <h2><PlatformBadge platform={s.platform} /> {PLATFORM_NAMES[s.platform]}</h2>
              <div className="muted">{s.error ? `Eroare: ${s.error}` : "Niciun local găsit cu livrare la adresa ta."}</div>
            </div>
          ))}

      {results && notImplemented.length > 0 && (
        <p className="muted offGrid">
          Încă neinclus în comparație: {notImplemented.map((p) => PLATFORM_NAMES[p]).join(", ")}.
        </p>
      )}
      </div>
      </div>
    </main>
  );
}

function BasketView({ b, scope, onExclude, busy, showRate }: { b: Basket; scope: BudgetScope; onExclude: (name: string) => void; busy: boolean; showRate?: boolean }) {
  const c = b.cost;
  return (
    <>
      <table>
        <tbody>
          {b.lines.map((l) => (
            <tr key={l.itemId}>
              <td>
                {l.qty}× {l.name}
                {l.units !== l.qty && <span className="muted"> (primești {l.units})</span>}
                {l.includes && (
                  <span className="muted">
                    {" "}(cu {[l.includes.fries && "cartofi", l.includes.drink && "băutură", l.includes.sauce && "sos"].filter(Boolean).join(", ")})
                  </span>
                )}
                {l.weightUncertain &&
                  (l.weightSource === "other-platform" ? (
                    <span className="muted" title="Gramaj preluat de la același produs de pe altă platformă"> ~</span>
                  ) : l.weightSource === "derived" ? (
                    <span className="muted" title="Gramaj calculat: sandvișul plus cartofii din meniu"> ~</span>
                  ) : (
                    <span className="muted" title="Gramaj nesigur, ghicit dintr-o descriere cu mai multe cifre"> ?</span>
                  ))}
              </td>
              <td className="num">{l.kind === "drink" ? `${Math.round(l.lineGrams)} ml` : l.kind === "sauce" ? "" : grams(l.lineGrams)}</td>
              <td className="num">
                {l.originalPrice != null && <span className="strike">{lei(l.originalPrice * l.qty)}</span>}
                {lei(l.lineTotal)}
              </td>
              <td className="act">
                <button className="rm" onClick={() => onExclude(l.name)} disabled={busy} title="Nu vreau produsul ăsta" aria-label={`Scoate ${l.name} din calcul`}>
                  <CloseIcon size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="costs">
        <tbody>
          <tr><td>Produse</td><td className="num">{lei(c.subtotal)}</td></tr>
          {c.discount > 0 && <tr><td>Reducere coș</td><td className="num">−{lei(c.discount)}</td></tr>}
          <tr><td>Livrare</td><td className="num">{lei(c.deliveryFee)}</td></tr>
          {c.serviceFee > 0 && <tr><td>Taxă de servicii</td><td className="num">{lei(c.serviceFee)}</td></tr>}
          {c.smallOrderFee > 0 && <tr><td>Suprataxă coș mic</td><td className="num">{lei(c.smallOrderFee)}</td></tr>}
          <tr className="total"><td>Total de plată</td><td className="num">{lei(c.total)}</td></tr>
        </tbody>
      </table>
      {showRate && (
        <div className="muted">
          {rate(b.leiPer100g)} / 100 g{scope === "food" ? " (fără taxe)" : " (cu taxe)"}
        </div>
      )}
    </>
  );
}

function ResultCard({ r, isWinner, scope, venues, onVenue, busy, onExclude }: { r: PlatformOutcome; isWinner: boolean; scope: BudgetScope; venues: Venue[]; onVenue: (id: string) => void; busy: boolean; onExclude: (name: string) => void }) {
  const best = r.result?.best;
  const stretch = r.result?.stretch;
  return (
    <section className={`sticker${isWinner ? " winner" : ""}`}>
      <div className="stickerHead">
        <div className="stickerTitle">
          {(() => {
            const chain = chainOfVenue(r.venue.name);
            return chain ? <ChainBadge chain={chain} size={44} /> : null;
          })()}
          <div>
          <h2><PlatformBadge platform={r.platform} /> {PLATFORM_NAMES[r.platform]}</h2>
          <a className="venue" href={r.venue.url} target="_blank" rel="noreferrer">{r.venue.name} <ExternalIcon size={14} /></a>
          </div>
        </div>
        {isWinner && <div className="stamp">Cea mai multă mâncare</div>}
      </div>

      {best && (
        <dl className="readout">
          <div className="weight">
            <dt>Greutate</dt>
            <dd>
              {/* Keep the unit fixed while the number runs, so the readout does not jump. */}
              <Settle value={best.grams} format={(n) => (best.grams >= 1000 ? (n / 1000).toFixed(2).replace(".", ",") + " kg" : Math.round(n) + " g")} />
            </dd>
          </div>
          <div>
            <dt>Preț la 100 g</dt>
            <dd>{rate(best.leiPer100g)}</dd>
          </div>
          <div>
            <dt>{scope === "food" ? "Doar mâncarea" : "Total cu taxe"}</dt>
            <dd>{lei(best.cost.counted)}</dd>
          </div>
        </dl>
      )}

      {venues.length > 1 && (
        <label className="field">
          <span>Local</span>
          <select value={r.venue.id} onChange={(e) => onVenue(e.target.value)} disabled={busy}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}{km(v.distanceM)}{v.online === false ? " (închis)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {r.error && <div className="error withIcon"><AlertIcon /><span>Eroare: {r.error}</span></div>}
      {!r.error && !best && <div className="error">{r.result?.reason ?? "Nicio variantă."}</div>}
      {best && <BasketView b={best} scope={scope} onExclude={onExclude} busy={busy} />}

      {stretch && best && (
        <div className="stretch">
          <strong>
            Cu {lei(stretch.cost.counted - best.cost.counted)} în plus: {grams(stretch.grams)} (+{grams(stretch.grams - best.grams)})
          </strong>
          <BasketView b={stretch} scope={scope} onExclude={onExclude} busy={busy} showRate />
        </div>
      )}

      {(r.offers?.length || r.notes?.length) ? (
        <ul className="notes">
          {r.offers?.map((o) => <li key={o}><TagIcon size={14} /><span>{o}</span></li>)}
          {r.notes?.map((n) => <li key={n} className="warnNote"><AlertIcon size={14} /><span>{n}</span></li>)}
        </ul>
      ) : null}

      {r.stats && (
        <details>
          <summary>
            {r.stats.usable} din {r.stats.items} produse luate în calcul
            {r.missingWeight?.length ? `, ${r.missingWeight.length} fără gramaj sigur` : ""}
          </summary>
          {r.missingWeight?.length ? <p>Fără gramaj sigur (excluse): {r.missingWeight.join("; ")}</p> : null}
        </details>
      )}
    </section>
  );
}
