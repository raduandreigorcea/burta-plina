# Gramaje completate manual

Pune aici câte un fișier `.json` pentru fiecare lanț la care meniul nu conține gramajul
(de exemplu Burger King). Valorile se iau din informațiile nutriționale oficiale ale lanțului.

```json
{
  "match": ["burger king"],
  "items": {
    "Whopper": 270,
    "Cartofi prăjiți porție medie": 116
  }
}
```

- `match`: bucăți din numele localului (fără diacritice, litere mici sau mari – nu contează).
- `items`: numele produsului exact ca în aplicație → grame pentru o bucată.
  Diacriticele, majusculele și simbolurile (™, ®) sunt ignorate la potrivire.

Valorile din exemplul de mai sus sunt doar ilustrative, nu date reale.
Fișierele sunt citite la fiecare cerere în modul dezvoltare, deci nu trebuie repornit serverul.
