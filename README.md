# Fastidrift

Selaimessa pyörivä driftipeli osoitteessa `/drift/`. Ei latauksia, ei asennusta,
ei ulkoisia riippuvuuksia ajon aikana - Three.js on paketoitu mukaan ja kaikki
tekstuurit, automallit ja äänet generoidaan koodista.

## Pelin idea

Aja kulmia, kerää pisteitä, osta parempi auto. Pisteet kertyvät sarjan aikana
"pankkiin" ja lyödään lukkoon vasta kun oikaiset. Seinään ajo tai spinni vie
keräämättömät pisteet - riski vastaan palkkio on koko pelin ydin.

Pisteitä tuottavat:

- **kulma kertaa nopeus** - jyrkkä kulma kovassa vauhdissa maksaa eniten
- **kerroin** joka kasvaa sarjan pituuden mukaan (x1 - x10)
- **suunnanvaihdot** kesken sarjan
- **klipsipisteet** (keltaiset renkaat) joiden läpi ajetaan driftissä
- **seinän vieressä** ajaminen kapeilla radoilla

## Sisältö

**Autot:** Aurum S550 (ilmainen supersedan), Sturmwind GT (etumoottorinen
V8-kupee), Falke 900 RS (takamoottori), Apex F-01 (avopyöräinen formula) ja
Chimera W16 (hyperauto). Nimet ja mallit ovat omia; muotoilu on tunnistettavaa
autotyyppiä, ei minkään valmistajan kopio. Jokaisella oma vääntökäyrä,
välitykset, painojakauma ja ohjauskulma.

**Renkaat:** kesken ajon voi vaihtaa driftirenkaiden ja kisarenkaiden välillä
(`T`). Ero on mitattu: 35 % ohjausta ja täysi kaasu antaa driftirenkailla 89
asteen kulman ja vauhti romahtaa, kisarenkailla auto pysyy 4,5 asteessa ja
kiihtyy 189 km/h:iin. Vaihto lyö kesken olevan sarjan lukkoon, joten
kisarenkaille ei voi vaihtaa juuri ennen pisteiden korjaamista.

**Radat:** Satamalaituri (avoin harjoituskenttä), Teollisuusrata (aika-ajo),
Vuoristolasku (kapea alamäki hämärässä) ja Talviratapiha (yö, lumi, puolet
pidosta).

**Talli:** kahdeksan osaluokkaa (moottori, ahdin, renkaat, alusta, kulmasarja,
kevennys, jarrut, tasauspyörästö), vapaat säädöt sekä maalaamo.

## Fysiikka

Ajoneuvo on tasossa liikkuva jäykkä kappale, jota simuloidaan 250 Hz:n
aliaskelilla:

- **Rengasmalli** yhdistetylle luistolle: pitkittäis- ja sivuttaisluisto
  normalisoidaan omilla huippuarvoillaan, ja voima haetaan yhdeltä käyrältä
  luistovektorin pituuden mukaan. Kylläisenä renkaalle jää noin 74 % pidosta -
  juuri se luku ratkaisee, onko drifti hallittava.
- **Kuormansiirto** pituus- ja sivusuunnassa, kallistusjako säädettävissä.
- **Voimansiirto**: vääntökäyrä, välitykset, kytkin (kytkinpotku toimii),
  kierrosrajoitin ja luistonestollinen tasauspyörästö.
- **Alusta**: kitka, korkeus ja kaltevuus näytteistetään radan ruudukosta,
  joten alamäki oikeasti vetää autoa eteenpäin.
- **Törmäys** tarkistetaan jokaisen fysiikan aliaskeleen jälkeen, ei kerran
  ruudussa. Siksi auto ei livahda seinän läpi vaikka ruudunpäivitys sakkaisi.

Ohjauksen merkistä: oikeakätisessä Y-ylös -koordinaatistossa +Z:aan katsovan
kappaleen paikallinen +X osoittaa sen vasemmalle. Fysiikka on johdonmukainen
tässä kehyksessä ja peilisymmetrinen, joten pelaajan ohjaus käännetään kerran
`vehicle.js`:n `step()`-metodissa. Älä kumoa sitä käymättä koko kehystä läpi.

Arvot on mitattu simuloimalla: Aurum S550 kiihtyy nollasta sataan 7,7 sekunnissa
ja kulkee 284 km/h. Tallin lukemat eivät ole arvioita vaan ajetaan samalla
fysiikalla kuin itse peli.

## Ohjaus

| Näppäin | Toiminto |
| --- | --- |
| `W` / `↑` | Kaasu |
| `S` / `↓` | Jarru, paikallaan peruutus |
| `A` `D` | Ohjaus |
| `Väli` | Käsijarru |
| `Shift` | Kytkin |
| `Q` `E` | Vaihteet manuaalilla |
| `T` | Renkaat: drift / kisapito |
| `C` | Kamera |
| `R` | Palauta radalle |
| `Esc` | Tauko |

Peliohjain toimii suoraan (liipaisimet, olkanapit), samoin kosketusnäyttö.

## Grafiikka

Renderöinti menee jälkikäsittelypinon läpi: `RenderPass` -> hehku -> sävykartoitus
-> värikorjaus. Hehku lasketaan lineaarisessa HDR-tilassa kynnyksellä 1.0, joten
vain aidot valonlähteet hehkuvat eikä koko kuva sumene. Värikorjaus tekee
vinjetin, kylläisyyden, kontrastin ja nopeussumennuksen, joka alkaa 90 km/h:ssa
ja venyttää ruudun reunoja kohti keskustaa.

Auringon varjokamera seuraa autoa tiukalla 44 metrin rajauksella, joten sama
varjokartta antaa terävän reunan juuri siellä missä pelaaja katsoo. Taivas ja
ympäristökartta johdetaan samasta 2048x1024 canvas-kuvasta, joten maalipinta
heijastaa täsmälleen sitä taivasta joka ruudulla näkyy.

## Tekninen rakenne

```
drift/
  index.html         käyttöliittymän runko
  style.css          ulkoasu
  vendor/            Three.js ja jälkikäsittely (paketoitu, ei CDN-riippuvuutta)
  js/
    main.js          renderöinti, kamerat, ajologiikka, mittaristo
    vehicle.js       ajoneuvofysiikka
    cars.js          autokatalogi, osat ja niistä johdettu speksi
    tracks.js        ratageometria, pinnan näytteistys, törmäykset
    carmodel.js      auton 3D-malli poikkileikkauksista
    scoring.js       driftin pisteytys
    fx.js            savu, jarrutusjäljet, kipinät, sää
    audio.js         moottori- ja rengasäänet WebAudiolla
    input.js         näppäimistö, peliohjain, kosketus
    postfx.js        hehku, värikorjaus, nopeussumennus
    ui.js            valikot, talli, asetukset
    save.js          tallennus localStorageen
```

Edistyminen tallentuu vain selaimen localStorageen; mitään ei lähetetä
palvelimelle.

## Kesken

Avoin kaupunkimaailma liikenteineen on seuraava iso pala, eikä sitä ole vielä
aloitettu.
