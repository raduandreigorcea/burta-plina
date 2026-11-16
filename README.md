# Cât mai multă mâncare

Alegi un fast-food și un buget; aplicația compară Wolt, Glovo și Bolt Food și îți spune de unde și ce să
comanzi ca să primești cele mai multe grame de mâncare.

## Pornire

```
npm install
npm run dev        # interfața web, http://localhost:3000
npm run cli -- "mcdonalds" 50 [lat] [lon]   # verificare rapidă din terminal
npm test           # teste (fără rețea)
npm run audit -- kfc "burger king"   # ce crede aplicația despre meniul live: cele mai „ieftine” produse și coșurile
npm run snapshot   # salvează din nou meniurile reale din tests/menus/ (apoi `npx vitest run -u` și citești diff-ul)
```

Lanțurile cunoscute (cele din lista care apare când scrii) sunt în `src/lib/chains.ts`. Pentru fiecare,
`tests/menus/` ține un meniu real salvat, iar testele verifică pe el coșurile rezultate: dacă o schimbare
strică un lanț, se vede în `tests/__snapshots__/`.

## Cum funcționează

- `src/lib/platforms/wolt.ts` – endpoint-urile JSON folosite de wolt.com (meniu, taxe la adresa ta, reduceri).
- `src/lib/platforms/glovo.ts` – paginile publice glovoapp.com (meniu, taxe afișate pe oraș).
- `src/lib/weight.ts` – extrage gramajul din numele/descrierea produsului.
- `src/lib/optimizer.ts` – knapsack: maxim de grame în buget, cu taxe și praguri incluse.
  Implicit intră doar feluri principale (burgeri, pui, meniuri). Cartofii, băutura și sosul se
  cer din butoane; atunci coșul le conține sigur, separat sau printr-un meniu care le include.
  La fel salata și desertul: câte una, cea care iese cel mai bine, și se numără la grame.
  Cartofii sunt limitați la o porție pentru fiecare fel principal (nachos și cartofii „loaded”
  sunt tot garnituri). Chiflele, toppingurile, chipsurile, supele, produsele vegane/plant-based
  și meniurile pentru copii nu intră în coș. Sosurile mari (dip de 200 g) sunt tot sosuri.
- Bucățile glazurate („5 buc. Voodoo Nuggets”) se numără la gramajul celor simple.
- La meniuri contează doar mâncarea (sandviș + cartofi), fără băutură și sos.
- `npx vite-node scripts/dump.ts "kfc"` – listează fiecare produs cu tipul și gramajul citit.
- `data/weights/` – gramaje completate manual pentru lanțurile care nu le afișează.

## Limitări

- Sursele sunt neoficiale și se pot schimba oricând; de folosit personal, cu trafic mic.
- Bolt Food: meniul și taxa de livrare vin din API-ul web neoficial (`deliveryuser.live.boltsvc.net`);
  taxa de servicii și suprataxa de coș mic nu sunt publice și nu sunt incluse. Linkurile merg doar pentru București.
- Ofertele legate de cont (utilizatori noi, Wolt+, Glovo Prime, coduri promo) nu intră în calcul.
- Glovo: taxa de livrare e cea afișată pe oraș (la adresa ta poate fi cu 1–2 lei mai mare). Taxa de
  servicii și suprataxa de coș mic nu sunt publice; sunt cele citite dintr-un coș real (`glovo.ts`).
- Produsele fără gramaj în meniu sunt excluse (apar listate în rezultat).
