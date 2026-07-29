# Auto Bingo — Streetview Roadtrip Bingo

Een single-page webapp om een auto-bingo te spelen langs een echte route. Jij
plant een route in Google Maps en kiest markante plekken langs de weg (via
Street View). Medespelers krijgen een bingokaart met die plekken en kunnen ze
onderweg scoren — maar alleen als ze **binnen 1 km** van de plek zijn, door op
een knop te drukken of een foto te maken.

Geen server nodig: alles draait client-side, data staat in `localStorage` van
de browser.

## Gebruiken

Open `index.html` in een browser (of host de map ergens statisch, bv. GitHub
Pages / Netlify / Vercel). Voor geolocatie werkt de meeste browsers alleen
over **HTTPS** (of `localhost`), dus test lokaal via een simpele static
server:

```bash
cd auto-bingo
python3 -m http.server 8000
# open http://localhost:8000
```

### 1. Google Maps API-sleutel

Om een route te maken heb je een eigen Google Cloud API-sleutel nodig met de
volgende API's aangezet:

- Maps JavaScript API
- Places API
- Geocoding API
- Street View Static API

Zet de sleutel in het scherm "API-sleutel" — hij wordt alleen lokaal
opgeslagen in `localStorage` en gaat verder nergens heen dan rechtstreeks naar
Google. Beperk de sleutel in de Cloud Console tot jouw domein (HTTP referrer
restrictie) om misbruik te voorkomen.

Spelers die alleen een gedeelde link openen om mee te spelen hebben **geen**
sleutel nodig (ze zien dan alleen de naam van elke plek in plaats van een
Street View-foto).

### 2. Route en bingokaart maken

1. "+ Nieuwe route" → geef een naam, vertrekpunt en bestemming, kies een
   kaartgrootte (3×3 t/m 6×6).
2. Klik "Route plannen" om de route te tekenen.
3. Klik op de kaart, of zoek een plek via het zoekveld, om een markant punt
   toe te voegen. Je krijgt een interactieve Street View-weergave waarin je
   kunt draaien/kantelen tot je het gewenste aanzicht van de plek hebt, en een
   naam kunt invullen.
4. Herhaal tot je precies zoveel elementen hebt als de kaartgrootte vereist
   (bv. 25 voor een 5×5 kaart), en sla de route op.

### 3. Spelen

Vanaf het routedetailscherm: "▶ Spelen" opent de bingokaart. De app houdt via
GPS bij hoe ver je van elke plek bent. Zodra je binnen 1 km bent, licht het
vakje op en kun je het scoren:

- **Meld** — een druk op de knop registreert dat je de plek gezien hebt.
- **Maak foto** — opent de camera en slaat een (verkleinde) foto als bewijs
  op, telt ook als score.

Volle rijen, kolommen of diagonalen worden gemarkeerd; bij een volledige kaart
verschijnt een melding.

### 4. Delen met medespelers

Vanaf het routedetailscherm: "🔗 Deel speel-link" genereert een link met de
bingokaart erin gecodeerd. Stuur die naar medespelers (bv. via WhatsApp) — zij
kunnen hem direct openen, of plakken op het startscherm onder "Route ontvangen
via link?". Elke speler houdt zijn eigen voortgang lokaal bij, dus iedereen
kan onafhankelijk scoren op dezelfde kaart.

## Beperkingen / bekende afwegingen

- Alles is client-side; er is geen gedeelde/live voortgang tussen spelers op
  afstand — elke speler speelt zijn eigen kopie van de bingokaart.
- Foto's worden alleen lokaal in de browser bewaard (in `localStorage`), niet
  geüpload.
- Zeer grote kaarten (6×6) geven een langere deel-link.
